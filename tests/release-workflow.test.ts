import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.ts";
import { createApp } from "../server/app.ts";
async function run(fn: (c: any) => Promise<void>) {
  const db = openDatabase(":memory:");
  const put = (m: string, id: number, d: any) =>
    db
      .prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)")
      .run(m, id, JSON.stringify({ id, name: m + id, ...d }));
  for (const [m, id] of [
    ["scene", 99001],
    ["scene", 99002],
    ["layerScene", 99003],
    ["routerSceneList", 99004],
    ["rulesGroup", 99005],
  ] as const)
    put(m, id, {});
  put("rulePage", 99006, { name: "流程规则", expression: "riskScore > 0.9" });
  put("decisionList", 99007, { name: "原始决策" });
  put("decisionList", 99008, { name: "新决策" });
  const scopes = [
    ["g", "rulesGroup", 99005],
    ["a", "scene", 99001],
    ["b", "scene", 99002],
    ["c", "layerScene", 99003],
    ["t", "graphTemplate", 99003],
    ["r", "routerSceneList", 99004],
  ] as const;
  for (const [id, m, parent] of scopes)
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      id,
      m,
      parent,
      99006,
      99005,
      m === "layerScene" ? "node1" : "",
      JSON.stringify({
        id,
        ruleId: 99006,
        groupId: 99005,
        status: "生效",
        decisionId: 99007,
        decision: "原始决策",
        priority: 1,
        updatedAt: "2026-11-19T00:00:00Z",
      }),
    );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const req = async (p: string, m = "GET", body?: any) => {
    const r = await fetch(base + p, {
      method: m,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const task = async () => {
    const r = await req("/entities/release%2Flist", "POST", {
      name: "发布流程验证",
      phase: "实验",
      status: "待启动",
      progress: 0,
      localChanges: [],
    });
    return r.data.id;
  };
  const action = (id: number, action: string, extra: any = {}) =>
    req("/releases/" + id + "/workflow/action", "POST", { action, ...extra });
  const begin = async (id: number) => {
    const c = (await req("/releases/" + id + "/experiment-config")).data.config;
    return req("/releases/" + id + "/experiment-config/start", "POST", c);
  };
  const config = (mode = 1) => ({
    deployMode: mode,
    description: "发布流程验证",
    urgentReason: mode === 0 ? "紧急风险处置" : "",
    grayEnabled: true,
    approver: "demo",
    notifyUsers: ["tester"],
    stages: [
      { grayRate: 10, grayTime: mode === 0 ? 1 : 10 },
      { grayRate: 50, grayTime: mode === 0 ? 1 : 10 },
      { grayRate: 100, grayTime: 0 },
    ],
  });
  const policies = () =>
    db
      .prepare(
        "SELECT data FROM source_configs WHERE group_id=99005 ORDER BY id",
      )
      .all()
      .map((r: any) => JSON.parse(r.data));
  try {
    await fn({ db, put, req, task, action, begin, config, policies });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
}
test("normal release advances configured percentages and synchronizes every scene, node, router and template atomically", () =>
  run(async ({ req, task, begin, config, action, policies }: any) => {
    const id = await task();
    assert.equal(
      (
        await req("/groups/99005/rules/g?changeTaskId=" + id, "PUT", {
          decisionId: 99008,
          status: "标记",
        })
      ).status,
      200,
    );
    await begin(id);
    const c = config();
    const path = "/releases/" + id + "/gray-config";
    assert.equal((await req(path, "PUT", c)).status, 200);
    assert.equal((await action(id, "审批通过")).status, 409);
    assert.equal((await req(path + "/submit", "POST", c)).status, 200);
    assert.equal((await req(path + "/submit", "POST", c)).status, 409);
    assert.equal(
      (await req("/entities/rulePage/99006?changeTaskId=" + id, "DELETE"))
        .status,
      409,
    );
    assert.equal((await action(id, "启动灰度")).status, 409);
    assert.equal((await action(id, "审批通过")).status, 200);
    assert.equal((await action(id, "启动灰度")).data.progress, 10);
    assert.ok(policies().every((r: any) => r.decisionId === 99007));
    assert.equal((await action(id, "下一步")).data.progress, 50);
    assert.ok(policies().every((r: any) => r.decisionId === 99007));
    const done = await action(id, "下一步");
    assert.equal(done.status, 200);
    assert.equal(done.data.phase, "完成");
    assert.equal(policies().length, 6);
    assert.ok(
      policies().every(
        (r: any) => r.decisionId === 99008 && r.status === "标记",
      ),
    );
    assert.equal((await action(id, "下一步")).status, 409);
    assert.equal(
      (await req("/releases/" + id + "/workflow")).data.canRollback,
      true,
    );
    assert.equal((await action(id, "回滚")).status, 200);
    assert.ok(
      policies().every(
        (r: any) => r.decisionId === 99007 && r.status === "生效",
      ),
    );
    assert.equal((await action(id, "回滚")).status, 409);
  }));
test("gray validation enforces ordinary and emergency limits and normal release requires an experiment", () =>
  run(async ({ req, task, config }: any) => {
    const id = await task();
    await req("/entities/rulePage/99006?changeTaskId=" + id, "PUT", {
      name: "规则修改",
    });
    const c = config(),
      path = "/releases/" + id + "/gray-config";
    for (const patch of [
      {
        stages: [
          { grayRate: 20, grayTime: 10 },
          { grayRate: 60, grayTime: 10 },
          { grayRate: 100 },
        ],
      },
      {
        stages: [
          { grayRate: 10, grayTime: 9 },
          { grayRate: 50, grayTime: 10 },
          { grayRate: 100 },
        ],
      },
      {
        stages: [
          { grayRate: 10, grayTime: 10 },
          { grayRate: 61, grayTime: 10 },
          { grayRate: 100 },
        ],
      },
      { approver: "" },
      { description: "" },
      { notifyUsers: ["bad id"] },
    ])
      assert.equal((await req(path, "PUT", { ...c, ...patch })).status, 400);
    assert.equal((await req(path + "/submit", "POST", c)).status, 409);
    const emergency = config(0);
    assert.equal((await req(path, "PUT", emergency)).status, 200);
    assert.equal(
      (await req(path, "PUT", { ...emergency, urgentReason: "" })).status,
      400,
    );
    assert.equal(
      (
        await req(path, "PUT", {
          ...emergency,
          stages: [
            { grayRate: 10, grayTime: 0 },
            { grayRate: 50, grayTime: 1 },
            { grayRate: 100 },
          ],
        })
      ).status,
      400,
    );
  }));
test("emergency full release skips experiments but requires approval before publication and supports rollback", () =>
  run(async ({ req, task, action, config }: any) => {
    const id = await task();
    await req("/entities/rulePage/99006?changeTaskId=" + id, "DELETE");
    const c = { ...config(0), grayEnabled: false };
    const path = "/releases/" + id + "/gray-config";
    assert.equal((await req(path + "/submit", "POST", c)).status, 200);
    assert.equal((await req("/entities/rulePage/99006")).status, 200);
    assert.equal((await action(id, "启动灰度")).status, 409);
    await action(id, "审批通过");
    const done = await action(id, "启动灰度");
    assert.equal(done.data.progress, 100);
    assert.equal((await req("/entities/rulePage/99006")).status, 404);
    const published = (await req("/releases/" + id + "/workflow")).data;
    assert.equal(published.affected.scene.length, 4);
    assert.equal(published.affected.rule[0].name, "流程规则");
    assert.equal(published.publicationSummary.configurationCount, 6);
    await action(id, "回滚");
    assert.equal((await req("/entities/rulePage/99006")).status, 200);
    assert.equal(
      (await req("/source/configs/layerScene/99003")).data.items.length,
      1,
    );
  }));
test("withdrawal, rejection, stop and restart preserve drafts and do not leak publication", () =>
  run(async ({ req, task, begin, config, action, policies }: any) => {
    const id = await task();
    await req("/groups/99005/rules/g?changeTaskId=" + id, "DELETE");
    await begin(id);
    const path = "/releases/" + id + "/gray-config",
      c = config();
    await req(path + "/submit", "POST", c);
    assert.equal((await action(id, "撤回")).status, 200);
    assert.equal((await req(path)).data.isEditable, true);
    await req(path + "/submit", "POST", c);
    assert.equal((await action(id, "审批驳回")).status, 400);
    assert.equal(
      (await action(id, "审批驳回", { reason: "观察时间调整" })).status,
      200,
    );
    assert.equal((await req(path)).data.isEditable, true);
    await req(path + "/submit", "POST", c);
    await action(id, "审批通过");
    await action(id, "启动灰度");
    await action(id, "中止");
    assert.equal((await action(id, "下一步")).status, 409);
    assert.equal(policies().length, 6);
    assert.equal((await action(id, "重启")).status, 200);
    assert.equal((await action(id, "下一步")).data.progress, 50);
    assert.equal((await action(id, "下一步")).data.progress, 100);
    assert.equal(policies().length, 0);
  }));
test("final-stage conflicts roll back all configuration writes and retain prior gray progress", () =>
  run(async ({ req, task, config, action, db, policies }: any) => {
    const id = await task();
    await req("/entities/rulePage/99006?changeTaskId=" + id, "PUT", {
      name: "待发布规则",
    });
    await req("/groups/99005/rules/g?changeTaskId=" + id, "PUT", {
      decisionId: 99008,
    });
    const c = config(0);
    await req("/releases/" + id + "/gray-config/submit", "POST", c);
    await action(id, "审批通过");
    await action(id, "启动灰度");
    await action(id, "下一步");
    db.prepare(
      "UPDATE source_configs SET data=json_set(data,'$.priority',99) WHERE id='g'",
    ).run();
    const failed = await action(id, "下一步");
    assert.equal(failed.status, 409);
    assert.equal((await req("/entities/rulePage/99006")).data.name, "流程规则");
    assert.ok(policies().every((r: any) => r.decisionId === 99007));
    assert.equal(
      (await req("/releases/" + id + "/workflow")).data.task.progress,
      50,
    );
  }));
test("stopped experiments restart through experiment configuration without bypassing the experiment gate", () =>
  run(async ({ req, task, begin, config, action }: any) => {
    const id = await task();
    await req("/entities/rulePage/99006?changeTaskId=" + id, "PUT", {
      name: "测试修改",
    });
    await begin(id);
    assert.equal((await action(id, "中止实验")).status, 200);
    assert.equal((await action(id, "重启")).data.phase, "实验");
    assert.equal(
      (await req("/releases/" + id + "/gray-config/submit", "POST", config()))
        .status,
      409,
    );
    assert.equal((await begin(id)).status, 200);
  }));
test("mounts added before publication are synchronized and retained in the publication impact summary", () =>
  run(async ({ req, task, config, action, db, put, policies }: any) => {
    const id = await task();
    await req("/groups/99005/rules/g?changeTaskId=" + id, "PUT", {
      decisionId: 99008,
    });
    await req("/releases/" + id + "/gray-config/submit", "POST", config(0));
    put("scene", 99009, { name: "新增挂载场景" });
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      "new",
      "scene",
      99009,
      99006,
      99005,
      "",
      JSON.stringify({
        id: "new",
        ruleId: 99006,
        groupId: 99005,
        status: "生效",
        decisionId: 99007,
        decision: "原始决策",
      }),
    );
    await action(id, "审批通过");
    await action(id, "启动灰度");
    await action(id, "下一步");
    await action(id, "下一步");
    assert.equal(policies().length, 7);
    assert.ok(policies().every((r: any) => r.decisionId === 99008));
    const result = (await req("/releases/" + id + "/workflow")).data;
    assert.equal(result.publicationSummary.configurationCount, 7);
    assert.ok(result.affected.scene.some((s: any) => s.id === 99009));
    await action(id, "回滚");
    assert.ok(policies().every((r: any) => r.decisionId === 99007));
  }));
test("source experiment and gray archives remain read-only through every workflow entry", () =>
  run(async ({ req, put, db, config }: any) => {
    put("release/list", 99999, {
      name: "来源归档",
      sourceImported: true,
      phase: "完成",
      status: "已完成",
    });
    db.prepare("INSERT INTO source_archives VALUES(?,?,?,?)").run(
      "release",
      99999,
      "",
      JSON.stringify({
        basic: { deployMode: 0 },
        experimentResults: [
          {
            trafficSourceType: "0",
            statistics: {
              labData: { hitCount: 2, requestCount: 10, hitRate: 0.2 },
            },
          },
        ],
        grayStages: [],
      }),
    );
    const data = (await req("/releases/99999/workflow")).data;
    assert.equal(data.isSource, true);
    assert.equal(data.experimentResults[0].statistics.labData.hitCount, 2);
    assert.equal(data.canRollback, false);
    assert.equal(
      (await req("/releases/99999/gray-config", "PUT", config(0))).status,
      409,
    );
    assert.equal(
      (await req("/releases/99999/gray-config/submit", "POST", config(0)))
        .status,
      409,
    );
    assert.equal(
      (await req("/releases/99999/workflow/action", "POST", { action: "中止" }))
        .status,
      409,
    );
  }));
test("mixed rule-definition and group-policy publication rolls back correctly with independent direct scene references", () =>
  run(async ({ req, task, config, action, db }: any) => {
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      "independent",
      "scene",
      99002,
      99006,
      0,
      "",
      JSON.stringify({
        id: "independent",
        ruleId: 99006,
        status: "生效",
        decisionId: 99007,
        decision: "原始决策",
      }),
    );
    const id = await task();
    await req("/entities/rulePage/99006?changeTaskId=" + id, "PUT", {
      expression: "riskScore > 0.1",
    });
    await req("/groups/99005/rules/g?changeTaskId=" + id, "PUT", {
      decisionId: 99008,
    });
    await req("/releases/" + id + "/gray-config/submit", "POST", config(0));
    await action(id, "审批通过");
    await action(id, "启动灰度");
    await action(id, "下一步");
    assert.equal((await action(id, "下一步")).status, 200);
    assert.equal(
      (await req("/entities/rulePage/99006")).data.expression,
      "riskScore > 0.1",
    );
    assert.equal(
      JSON.parse(
        db
          .prepare("SELECT data FROM source_configs WHERE id='independent'")
          .get().data,
      ).decisionId,
      99007,
    );
    const independentBefore = db
      .prepare("SELECT data FROM source_configs WHERE id='independent'")
      .get().data;
    db.prepare(
      "UPDATE source_configs SET data=json_set(data,'$.priority',77) WHERE id='independent'",
    ).run();
    assert.equal((await action(id, "回滚")).status, 409);
    assert.equal(
      (await req("/entities/rulePage/99006")).data.expression,
      "riskScore > 0.1",
    );
    assert.ok(
      db
        .prepare("SELECT data FROM source_configs WHERE group_id=99005")
        .all()
        .every((x: any) => JSON.parse(x.data).decisionId === 99008),
    );
    db.prepare("UPDATE source_configs SET data=? WHERE id='independent'").run(
      independentBefore,
    );
    const rollback = await action(id, "回滚");
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    assert.equal(
      (await req("/entities/rulePage/99006")).data.expression,
      "riskScore > 0.9",
    );
  }));

test("publishing a single scene binding preserves other groups using the same rule and supports legacy scene-rule IDs", () =>
  run(async ({ req, db, task, config, action }: any) => {
    const r = db.prepare("SELECT * FROM source_configs WHERE id='a'").get();
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      "other",
      r.scene_module,
      r.scene_id,
      r.rule_id,
      999,
      "",
      JSON.stringify({ ...JSON.parse(r.data), id: "other", groupId: 999 }),
    );
    const legacy = db
      .prepare(
        "INSERT INTO scene_rules(scene_module,scene_id,rule_id,status) VALUES('scene',99001,99006,'标记')",
      )
      .run().lastInsertRowid;
    const id = await task();
    assert.equal(
      (
        await req("/source/config/a?changeTaskId=" + id, "PUT", {
          status: "离线",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req("/scene-rules/" + legacy + "?changeTaskId=" + id, "PUT", {
          status: "离线",
        })
      ).status,
      200,
    );
    assert.ok(
      Array.isArray(
        (await req("/entities/rulePage/99006/versions?changeTaskId=" + id)).data
          .items,
      ),
    );
    await req("/releases/" + id + "/gray-config/submit", "POST", {
      ...config(0),
      grayEnabled: false,
    });
    await action(id, "审批通过");
    assert.equal((await action(id, "启动灰度")).data.status, "已完成");
    const list = async () =>
      Object.fromEntries(
        (await req("/scenes/scene/99001/rules")).data.items.map((v: any) => [
          v.id,
          v.status,
        ]),
      );
    assert.deepEqual(await list(), {
      a: "离线",
      other: "生效",
      [legacy]: "离线",
    });
    assert.equal((await action(id, "回滚")).status, 200);
    assert.deepEqual(await list(), {
      a: "生效",
      other: "生效",
      [legacy]: "标记",
    });
  }));
