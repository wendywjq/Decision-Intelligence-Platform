import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.ts";
import { groupRules, GroupRuleError } from "../server/group-rules.ts";
import { createApp } from "../server/app.ts";
function setup() {
  const db = openDatabase(":memory:");
  for (const [module, id] of [
    ["rulesGroup", 91001],
    ["rulesGroup", 91002],
    ["scene", 92001],
    ["scene", 92002],
    ["layerScene", 92003],
    ["rulePage", 93001],
    ["rulePage", 93002],
    ["rulePage", 93003],
  ] as const)
    db.prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)").run(
      module,
      id,
      JSON.stringify({ id, name: module + id, expression: "riskScore > 0.9" }),
    );
  const config = (
    id: string,
    module: string,
    parent: number,
    group: number,
    rule: number,
    status: any,
    node = "",
  ) =>
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      id,
      module,
      parent,
      rule,
      group,
      node,
      JSON.stringify({
        id,
        ruleId: rule,
        groupId: group,
        status,
        decision: "通过",
        priority: 1,
        updatedAt: "2026-11-19T00:00:00Z",
      }),
    );
  config("member", "rulesGroup", 91001, 91001, 93001, "标记");
  config("a", "scene", 92001, 91001, 93001, "离线");
  config("b", "scene", 92002, 91001, 93001, "标记");
  config("c", "layerScene", 92003, 91001, 93001, "离线", "node-a");
  const g = groupRules(db);
  return { db, g, config };
}
test("group add only accepts offline or mark and synchronizes every scene and graph node", () => {
  const { db, g } = setup();
  try {
    for (const status of ["生效", 64, "灰度", "停用"])
      assert.throws(
        () => g.add(91001, { ruleId: 93002, status }),
        GroupRuleError,
      );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) n FROM source_configs WHERE rule_id=93002")
          .get() as any
      ).n,
      0,
    );
    const added = g.add(91001, {
      ruleId: 93002,
      status: 32,
      decision: "人工复核",
    });
    assert.equal(added.synced, 3);
    const rows = db
      .prepare(
        "SELECT data FROM source_configs WHERE group_id=91001 AND rule_id=93002",
      )
      .all() as any[];
    assert.equal(rows.length, 4);
    for (const r of rows) assert.equal(JSON.parse(r.data).status, "标记");
    g.update(91001, added.id, { status: "离线", decision: "拒绝" });
    for (const r of db
      .prepare("SELECT data FROM source_configs WHERE rule_id=93002")
      .all() as any[])
      assert.equal(JSON.parse(r.data).decision, "拒绝");
  } finally {
    db.close();
  }
});
test("one effective scene, including another group or direct binding, blocks all direct changes", () => {
  const { db, g, config } = setup();
  try {
    config(
      "template-only",
      "graphTemplate",
      94001,
      91001,
      93001,
      "生效",
      "template-node",
    );
    assert.equal(g.list(91001).find((r) => r.ruleId === 93001).locked, false);
    config("external", "scene", 92002, 0, 93001, "生效");
    assert.equal(g.list(91001).find((r) => r.ruleId === 93001).locked, true);
    for (const remove of [false, true])
      assert.throws(
        () =>
          g.update(
            91001,
            "member",
            { status: "离线", decision: "拒绝" },
            remove,
          ),
        (e: any) => e.status === 409 && e.details.code === "GROUP_RULE_IN_USE",
      );
    assert.equal(
      JSON.parse(
        (
          db
            .prepare("SELECT data FROM source_configs WHERE id='a'")
            .get() as any
        ).data,
      ).decision,
      "通过",
    );
    db.prepare("DELETE FROM source_configs WHERE id='external'").run();
    g.update(91001, "member", { status: "离线", decision: "人工复核" });
    assert.equal(g.list(91001).find((r) => r.ruleId === 93001).locked, false);
  } finally {
    db.close();
  }
});
test("deleting last member preserves mounts, and future additions synchronize through nested groups", () => {
  const { db, g } = setup();
  try {
    db.prepare(
      "INSERT INTO rule_group_mounts VALUES(91001,'rulesGroup',91002,'')",
    ).run();
    db.prepare(
      "INSERT INTO rule_group_mounts VALUES(91002,'scene',92002,'nested')",
    ).run();
    db.prepare(
      "INSERT INTO rule_group_mounts VALUES(91002,'rulesGroup',91001,'')",
    ).run();
    g.update(91001, "member", {}, true);
    const r = g.add(91001, { ruleId: 93003, status: "离线" });
    assert.ok(r.synced >= 4);
    assert.ok(
      db
        .prepare(
          "SELECT 1 FROM source_configs WHERE group_id=91001 AND rule_id=93003 AND scene_id=92003 AND node_id='node-a'",
        )
        .get(),
    );
    assert.ok(
      db
        .prepare(
          "SELECT 1 FROM source_configs WHERE group_id=91001 AND rule_id=93003 AND scene_id=92002 AND node_id='nested'",
        )
        .get(),
    );
  } finally {
    db.close();
  }
});
test("HTTP guards legacy source edits; strategy changes remain pending until final publication", async () => {
  const { db, config } = setup();
  config("effective", "scene", 92001, 91001, 93001, "生效");
  const legacy = db
    .prepare(
      "INSERT INTO scene_rules(scene_module,scene_id,rule_id,status,decision,priority) VALUES('rulesGroup',91001,93002,'标记','通过',1)",
    )
    .run();
  config("legacy-effective", "scene", 92002, 91001, 93002, 64);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const req = async (path: string, method = "GET", body?: any) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal(
      (
        await req("/scenes/rulesGroup/91001/rules", "POST", {
          ruleId: 93003,
          status: "生效",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/scene-rules/" + legacy.lastInsertRowid, "PUT", {
          status: "离线",
          decision: "拒绝",
        })
      ).status,
      409,
    );
    assert.equal(
      (await req("/scene-rules/" + legacy.lastInsertRowid, "DELETE")).status,
      409,
    );
    assert.equal(
      (await req("/source/config/member", "PUT", { decision: "拒绝" })).status,
      409,
    );
    assert.equal(
      (await req("/groups/91001/rules/member", "DELETE")).status,
      409,
    );
    const before = JSON.parse(
      (
        db
          .prepare("SELECT data FROM source_configs WHERE id='member'")
          .get() as any
      ).data,
    );
    const release = await req(
      "/entities/" + encodeURIComponent("release/list"),
      "POST",
      {
        name: "规则组变更测试",
        phase: "实验",
        status: "待启动",
        progress: 0,
        localChanges: [
          {
            objectType: "规则组策略",
            groupId: 91001,
            configId: "member",
            ruleId: 93001,
            action: "修改",
            before,
            after: { status: "生效", decision: "拒绝" },
          },
        ],
      },
    );
    const path = "/releases/" + release.data.id + "/advance";
    await req(path, "POST", { action: "实验" });
    await req(path, "POST", { action: "审批" });
    for (let i = 0; i < 3; i++) await req(path, "POST", { action: "下一步" });
    assert.equal(
      JSON.parse(
        (
          db
            .prepare("SELECT data FROM source_configs WHERE id='member'")
            .get() as any
        ).data,
      ).decision,
      "通过",
    );
    assert.equal((await req(path, "POST", { action: "下一步" })).status, 200);
    for (const r of db
      .prepare(
        "SELECT data FROM source_configs WHERE group_id=91001 AND rule_id=93001",
      )
      .all() as any[])
      assert.equal(JSON.parse(r.data).decision, "拒绝");
    assert.equal(
      (await req("/references/rule/93001")).data.items.filter(
        (r: any) => r.scene_module === "scene",
      ).length,
      3,
    );
    assert.equal((await req(path, "POST", { action: "回滚" })).status, 200);
    assert.equal(
      JSON.parse(
        (
          db
            .prepare("SELECT data FROM source_configs WHERE id='member'")
            .get() as any
        ).data,
      ).decision,
      "通过",
    );
    const deletion = await req(
      "/entities/" + encodeURIComponent("release/list"),
      "POST",
      {
        name: "删除配置并回滚",
        phase: "实验",
        status: "待启动",
        progress: 0,
        localChanges: [
          {
            objectType: "规则组策略",
            groupId: 91001,
            configId: "member",
            action: "删除",
            before,
            after: {},
          },
        ],
      },
    );
    const deletePath = "/releases/" + deletion.data.id + "/advance";
    await req(deletePath, "POST", { action: "实验" });
    await req(deletePath, "POST", { action: "审批" });
    for (let i = 0; i < 4; i++)
      await req(deletePath, "POST", { action: "下一步" });
    assert.equal(
      db.prepare("SELECT 1 FROM source_configs WHERE id='member'").get(),
      undefined,
    );
    assert.equal(
      (await req(deletePath, "POST", { action: "回滚" })).status,
      200,
    );
    assert.ok(
      db.prepare("SELECT 1 FROM source_configs WHERE id='member'").get(),
    );
    const tested = await req("/rule-drafts/test", "POST", {
      expression: "riskScore > 0.9",
      input: { riskScore: 0.95 },
      expected: true,
    });
    assert.equal(tested.data.passed, true);
    const failed = await req("/groups/91001/create-rule", "POST", {
      rule: { name: "must rollback", expression: "riskScore > 0.9" },
      config: { status: "生效" },
    });
    assert.equal(failed.status, 400);
    assert.equal(
      db
        .prepare(
          "SELECT 1 FROM entities WHERE module='rulePage' AND json_extract(data,'$.name')='must rollback'",
        )
        .get(),
      undefined,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
