import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  const newRule = await request("/entities/rulePage", "POST", {
    name: "独立关联规则",
    expression: "riskScore > 0.9",
  });
  const ruleId = newRule.data.id;
  const path = "/scenes/scene/" + created.data.id + "/rules";
  assert.equal((await request(path, "POST", { ruleId: 999999 })).status, 404);
  const r = await request(path, "POST", { ruleId, status: "标记" });
  assert.equal(r.status, 201);
  assert.equal((await request(path, "POST", { ruleId })).status, 409);
  assert.equal(
    (await request("/scene-rules/" + r.data.id, "PUT", { status: "灰度" }))
      .status,
    409,
  );
  await request("/scene-rules/" + r.data.id, "PUT", {
    status: "离线",
    decision: "拒绝",
    priority: 7,
  });
  assert.equal((await request(path)).data.items[0].status, "离线");
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

test("ID deep links match exactly even when other IDs share the digits", async () => {
  const created = await request("/entities/rulesGroup", "POST", {
    name: "ID collision 1",
    sourceId: "reference-3503",
  });
  const id = created.data.id;
  const exact = await request("/entities/rulesGroup?id=" + id);
  assert.equal(exact.data.total, 1);
  assert.equal(exact.data.items[0].id, id);
  const partial = await request(
    "/entities/rulesGroup?id=" + String(id).slice(0, -1),
  );
  assert.ok(
    partial.data.items.every(
      (r: any) => String(r.id) === String(id).slice(0, -1),
    ),
  );
  const unrelated = await request("/entities/rulesGroup?id=3503");
  assert.ok(
    unrelated.data.items.every(
      (r: any) => r.id === 3503 || String(r.sourceId) === "3503",
    ),
  );
});

test("fuse form persists schedules, thresholds and notification settings", async () => {
  const values = {
    name: "测试熔断",
    type: "分层场景熔断",
    sceneId: "34214",
    ruleId: "2443974",
    decision: "187",
    status: "启用",
    action: "人工熔断",
    times: [
      { start: "2026-11-18T10:00", end: "2026-11-19T10:00", holiday: "否" },
    ],
    conditions: [
      {
        minutes: 1,
        metric: "规则命中量",
        fn: "绝对量",
        operator: ">=",
        threshold: 100,
      },
    ],
    recipients: ["场景负责人"],
  };
  const saved = await request("/entities/rulesFuseList", "POST", values);
  assert.equal(saved.status, 201);
  const loaded = await request("/entities/rulesFuseList/" + saved.data.id);
  assert.deepEqual(loaded.data.times, values.times);
  assert.deepEqual(loaded.data.conditions, values.conditions);
  assert.deepEqual(loaded.data.recipients, values.recipients);
});

test("precise search matches a whole ID or name while fuzzy search retains substring behavior", async () => {
  const saved = await request("/entities/scene", "POST", {
    name: "精确搜索回归示例",
  });
  const exact = await request(
    "/entities/scene?q=" +
      encodeURIComponent("精确搜索回归示例") +
      "&searchMode=exact",
  );
  assert.equal(exact.data.total, 1);
  assert.equal(exact.data.items[0].id, saved.data.id);
  const short = await request(
    "/entities/scene?q=" + encodeURIComponent("搜索回归") + "&searchMode=exact",
  );
  assert.equal(short.data.total, 0);
  const fuzzy = await request(
    "/entities/scene?q=" + encodeURIComponent("搜索回归"),
  );
  assert.equal(fuzzy.data.total, 1);
});

test("large catalog SQL paging preserves literal search, metadata filters and exact ID links", async () => {
  const row = await request("/entities/rulePage", "POST", {
    name: "分页_%_引用'内容",
    enName: "catalog_literal_unique",
    tags: ["特征关联测试"],
    status: "离线",
    sourceId: 90909091,
  });
  const query = async (values: Record<string, string>) =>
    request("/entities/rulePage?" + new URLSearchParams(values));
  const literal = await query({ q: "_%_引用'", pageSize: "1" });
  assert.equal(literal.data.total, 1);
  assert.equal(literal.data.items[0].id, row.data.id);
  const exact = await query({ id: "90909091" });
  assert.equal(exact.data.items[0].id, row.data.id);
  const filtered = await query({ tags: "特征关联测试", status: "离线" });
  assert.equal(filtered.data.total, 1);
  const absent = await query({ q: "catalog_literal_unique", status: "生效" });
  assert.equal(absent.data.total, 0);
  const all = await query({ pageSize: "1", page: "1" });
  const second = await query({ pageSize: "1", page: "2" });
  assert.ok(all.data.total > 1);
  assert.notEqual(all.data.items[0].id, second.data.items[0].id);
  const injected = await query({ ["name') OR 1=1 --"]: "anything" });
  assert.equal(injected.status, 200);
  assert.equal(injected.data.total, 0);
});

test("test packages persist and execute in a nested rule, including exact image contents", async () => {
  await request("/rule-test-packages/bag/70001", "PUT", {
    entries: ["金桂", "木樨"],
  });
  const image = "data:image/png;base64,YWJj";
  await request("/rule-test-packages/picture/70002", "PUT", {
    entries: [image],
  });
  const child = await request("/entities/rulePage", "POST", {
    name: "测试词条",
    expression: 'hitKeywordBag(item,"70001")',
  });
  const expression =
    'any_hitRule(texts,"' +
    child.data.id +
    '","item") && hitPictureBag(image,"70002")';
  for (const [texts, picture, expected] of [
    [
      ["桂花", "金桂树"],
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      true,
    ],
    [["桂花"], image, false],
    [["木樨"], "other-image", false],
  ]) {
    const r = await request("/rule-drafts/test", "POST", {
      expression,
      input: { texts, image: picture },
      expected,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.actual, expected);
    assert.equal(r.data.passed, true);
  }
  const missing = await request("/rule-drafts/test", "POST", {
    expression: 'hitKeywordBag(text,"0000")',
    input: { text: "0000" },
  });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /缺少词包/);
  assert.equal(
    (await request("/source/rule-packages?q=70001")).data.items[0].value,
    "70001",
  );
});

test(
  "AviatorScript runs scripts in imported subrules and maps target features over lists",
  { skip: !existsSync(new URL("../data/aviator/java-path", import.meta.url)) },
  async () => {
    const expression =
      "##exp - 5\nlet total=0; for n in scores { total=total+n; } return total>3;";
    const child = await request("/entities/rulePage", "POST", {
      name: "累计分数",
      expression: JSON.stringify({ expression }),
    });
    for (const [groups, expected] of [
      [[[1, 3]], true],
      [[[1, 2]], false],
    ]) {
      const r = await request("/rule-drafts/test", "POST", {
        expression: 'any_hitRule(groups,"' + child.data.id + '","scores")',
        input: { groups },
        expected,
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.actual, expected);
    }
    const target = await request("/entities/featureService", "POST", {
      name: "本地衍生",
      type: "衍生特征",
      featureDefinition: { type: 1, expression: "return score * 2;" },
    });
    const r = await request("/feature-logic/map-test", "POST", {
      targetId: target.data.id,
      param: "score",
      source: "scores",
      input: { scores: [2, 3] },
    });
    assert.deepEqual(r.data.value, [4, 6]);
  },
);
