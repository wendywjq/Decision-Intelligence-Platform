import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, evaluateExpression } from "../server/app.ts";
import { openDatabase } from "../server/db.ts";
import type { Server } from "node:http";
const dir = mkdtempSync(join(tmpdir(), "zeus-test-"));
const dbPath = join(dir, "test.sqlite");
const db = openDatabase(dbPath);
let server: Server;
let base = "";
before(async () => {
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = "http://127.0.0.1:" + (server.address() as any).port;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
async function request(path: string, method = "GET", body?: any) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
test("seed data is paginated and filtered on server", async () => {
  const r = await request("/entities/scene?q=审核&pageSize=1");
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 1);
  assert.ok(r.data.total >= 1);
});
test("CRUD survives reopening database; versions restore prior content", async () => {
  let r = await request("/entities/scene", "POST", {
    name: "持久化测试",
    owner: "tester",
  });
  assert.equal(r.status, 201);
  const id = r.data.id;
  await request("/entities/scene/" + id, "PUT", {
    name: "更新名称",
    owner: "tester",
  });
  const versions = await request("/entities/scene/" + id + "/versions");
  assert.equal(versions.data.items[0].data.name, "持久化测试");
  await request(
    "/entities/scene/" + id + "/restore/" + versions.data.items[0].id,
    "POST",
  );
  const other = openDatabase(dbPath);
  const row = other
    .prepare("SELECT data FROM entities WHERE module=? AND id=?")
    .get("scene", id) as any;
  assert.equal(JSON.parse(row.data).name, "持久化测试");
  other.close();
  const copied = await request("/entities/scene/" + id + "/copy", "POST");
  assert.equal(copied.data.name, "持久化测试_copy");
  await request("/entities/scene/" + id, "DELETE");
  assert.equal((await request("/entities/scene/" + id)).status, 404);
});
test("creation rejects invalid and unknown modules", async () => {
  assert.equal(
    (await request("/entities/scene", "POST", { name: " " })).status,
    400,
  );
  assert.equal(
    (await request("/entities/unknown", "POST", { name: "test" })).status,
    404,
  );
});
test("scene rule relation validates rule and prevents duplicate binding", async () => {
  const created = await request("/entities/scene", "POST", {
    name: "关联测试",
  });
  const path = "/scenes/scene/" + created.data.id + "/rules";
  assert.equal((await request(path, "POST", { ruleId: 999999 })).status, 404);
  const r = await request(path, "POST", { ruleId: 20001, status: "标记" });
  assert.equal(r.status, 201);
  assert.equal((await request(path, "POST", { ruleId: 20001 })).status, 409);
  await request("/scene-rules/" + r.data.id, "PUT", {
    status: "灰度",
    decision: "拒绝",
    priority: 7,
  });
  assert.equal((await request(path)).data.items[0].status, "灰度");
  await request("/scene-rules/" + r.data.id, "DELETE");
  assert.equal((await request(path)).data.items.length, 0);
});
test("rule tests evaluate actual input and persist pass/fail records", async () => {
  const hit = await request("/rules/20001/test", "POST", {
    input: { riskScore: 0.95 },
    expected: true,
  });
  assert.equal(hit.data.actual, true);
  assert.equal(hit.data.passed, true);
  const miss = await request("/rules/20001/test", "POST", {
    input: { riskScore: 0.1 },
    expected: true,
  });
  assert.equal(miss.data.actual, false);
  assert.equal(miss.data.passed, false);
  assert.ok((await request("/rules/20001/tests")).data.items.length >= 2);
  assert.equal(
    (await request("/rules/20001/test", "POST", { input: "not json" })).status,
    400,
  );
});
test("expression evaluator rejects arbitrary code and missing variables", () => {
  assert.equal(
    evaluateExpression("riskScore > 0.9", { riskScore: 0.95 }),
    true,
  );
  assert.equal(
    evaluateExpression("count >= 100 && blocked == true", {
      count: 120,
      blocked: true,
    }),
    true,
  );
  assert.throws(() => evaluateExpression("process.exit(0)", {}));
  assert.throws(() => evaluateExpression("riskScore > 0.9", {}));
});
test("release enforces sequential approval and gray progress", async () => {
  const r = await request("/entities/release%2Flist", "POST", {
    name: "发布测试",
    phase: "实验",
    progress: 0,
  });
  const path = "/releases/" + r.data.id + "/advance";
  assert.equal((await request(path, "POST", { action: "下一步" })).status, 409);
  await request(path, "POST", { action: "实验" });
  await request(path, "POST", { action: "审批" });
  for (let i = 0; i < 4; i++) await request(path, "POST", { action: "下一步" });
  const final = await request("/entities/release%2Flist/" + r.data.id);
  assert.equal(final.data.phase, "完成");
  assert.equal(final.data.progress, 100);
});
test("settings and graph edits persist and audit is recorded", async () => {
  await request("/settings/test", "PUT", { field: "riskScore" });
  assert.equal((await request("/settings/test")).data.field, "riskScore");
  await request("/entities/layerScene/30001", "PUT", {
    name: "测试画布",
    nodes: [{ id: "a", data: { label: "开始" }, position: { x: 1, y: 2 } }],
    edges: [],
  });
  assert.equal(
    (await request("/entities/layerScene/30001")).data.nodes[0].id,
    "a",
  );
  assert.ok((await request("/audit")).data.items.length > 0);
});

test("all catalog modules expose a list endpoint and tab records stay isolated", async () => {
  const { modules } = await import("../src/catalog.ts");
  for (const module of modules) {
    const response = await request(
      "/entities/" + encodeURIComponent(module.key),
    );
    assert.equal(response.status, 200, module.key);
    assert.ok(Array.isArray(response.data.items), module.key);
  }
  await request("/entities/layerScene", "POST", {
    name: "示例分层模版",
    view: "模版列表",
  });
  const template = await request(
    "/entities/layerScene?view=" + encodeURIComponent("模版列表"),
  );
  assert.equal(template.data.items[0].name, "示例分层模版");
  const scenes = await request(
    "/entities/layerScene?view=" + encodeURIComponent("场景列表"),
  );
  assert.ok(scenes.data.items.every((r: any) => r.name !== "示例分层模版"));
});
test("scene filters use rule associations, not missing fields", async () => {
  const response = await request(
    "/entities/scene?ruleId=20001&decision=" + encodeURIComponent("人工审核"),
  );
  assert.ok(response.data.total >= 1);
  assert.equal(
    evaluateExpression("a == true || b == true && c == true", {
      a: true,
      b: false,
      c: false,
    }),
    true,
  );
});
