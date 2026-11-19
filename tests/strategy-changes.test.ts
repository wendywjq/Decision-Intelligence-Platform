import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/db.ts";
import {
  compileConditionLogic,
  evaluateRuleExpression,
} from "../src/rule-logic.ts";
import { riskTagTree, tagDescendants } from "../src/risk-tags.ts";
function fixture() {
  const db = openDatabase(":memory:");
  const put = (m: string, id: number, data: any) =>
    db
      .prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)")
      .run(m, id, JSON.stringify({ id, name: m + id, ...data }));
  for (const id of [98001, 98002]) put("scene", id, { sourceImported: true });
  put("layerScene", 98003, {});
  put("rulesGroup", 98004, {});
  put("rulePage", 98005, {
    name: "测试风险规则",
    enName: "risk_rule",
    expression: "riskScore > 0.9",
    refCount: 12,
    status: "就绪",
  });
  put("rulePage", 98006, { name: "未引用规则", expression: "riskScore < 0.1" });
  put("decisionList", 98007, { name: "人工复核" });
  put("decisionList", 98008, { name: "拒绝" });
  put("tag", 98100, { name: "一级风险", type: "风险标签", parentId: 0 });
  put("tag", 98101, { name: "二级风险", type: "风险标签", parentId: 98100 });
  db.prepare("INSERT INTO source_archives VALUES(?,?,?,?)").run(
    "rule",
    98005,
    "",
    JSON.stringify({
      logic: {
        name: "risk_rule",
        expression: "riskScore > 0.9",
        ruleConditions: [],
      },
      catalogInfo: {
        refCount: 12,
        riskTagInfo: { 98101: "二级风险" },
        decisionDistribution: [{ decisionId: 98007, ratio: 100 }],
      },
    }),
  );
  const conf = (
    id: string,
    m: string,
    parent: number,
    status: string,
    group = 98004,
  ) =>
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      id,
      m,
      parent,
      98005,
      group,
      m === "layerScene" ? "node1" : "",
      JSON.stringify({
        id,
        ruleId: 98005,
        rule_id: 98005,
        groupId: group,
        status,
        decisionId: 98007,
        decision: "人工复核",
        priority: 1,
        updatedAt: "2026-11-19T00:00:00Z",
        modifier: "demo",
      }),
    );
  conf("g", "rulesGroup", 98004, "标记");
  conf("a", "scene", 98001, "生效");
  conf("b", "scene", 98002, "标记");
  conf("c", "layerScene", 98003, "标记");
  const server = createApp(db).listen(0, "127.0.0.1");
  return { db, server, put };
}
async function run(fn: (ctx: any) => Promise<void>) {
  const { db, server, put } = fixture();
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const req = async (path: string, method = "GET", body?: any) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  const task = async (name = "变更测试") =>
    (
      await req("/entities/" + encodeURIComponent("release/list"), "POST", {
        name,
        phase: "实验",
        status: "待启动",
        progress: 0,
        localChanges: [],
      })
    ).data.id;
  const publish = async (id: number) => {
    await req("/releases/" + id + "/advance", "POST", { action: "实验" });
    await req("/releases/" + id + "/advance", "POST", { action: "审批" });
    let r: any;
    for (let i = 0; i < 4; i++)
      r = await req("/releases/" + id + "/advance", "POST", {
        action: "下一步",
      });
    return r;
  };
  try {
    await fn({ db, req, task, publish, put });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
}
test("numbered logic accepts nested OR/AND, negation and repeated conditions without eval", () => {
  const e = compileConditionLogic("1&&(2||4)||3", [
    "a > 1",
    "b == 2",
    "c == true",
    "d < 4",
  ]);
  assert.equal(evaluateRuleExpression(e, { a: 2, b: 0, c: false, d: 2 }), true);
  assert.equal(
    evaluateRuleExpression(e, { a: 0, b: 2, c: false, d: 8 }),
    false,
  );
  assert.equal(
    evaluateRuleExpression(
      compileConditionLogic("!1||2&&(!1||2)", ["a > 1", "b == 2"]),
      { a: 2, b: 2 },
    ),
    true,
  );
  for (const v of ["1&&(2", "5", "0", "1;process.exit()", "1 2"])
    assert.throws(() => compileConditionLogic(v, ["a > 1", "b == 2"]));
});
test("active rules cannot be edited, deleted, restored or adjusted through ordinary policy endpoints", () =>
  run(async ({ req, db }: any) => {
    for (const [path, method, body] of [
      [
        "/entities/rulePage/98005",
        "PUT",
        { name: "非法修改", expression: "riskScore < 0.1" },
      ],
      ["/entities/rulePage/98005", "DELETE"],
      ["/source/config/a", "PUT", { status: "离线" }],
      ["/source/config/a", "DELETE"],
      ["/source/config/b", "PUT", { priority: 9 }],
      ["/policy-configs/batch", "POST", { ids: ["b", "a"], action: "删除" }],
    ] as any[]) {
      const r = await req(path, method, body);
      assert.equal(r.status, 409, path);
    }
    assert.equal(
      (await req("/entities/rulePage/98005")).data.name,
      "测试风险规则",
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM source_configs WHERE rule_id=98005")
        .get().n,
      4,
    );
    assert.equal(
      (
        await req("/entities/rulePage/98005?changeTaskId=invalid", "PUT", {
          name: "wrong",
        })
      ).status,
      400,
    );
    assert.equal(
      (await req("/entities/rulePage/98005?changeTaskId=999999", "DELETE"))
        .status,
      404,
    );
  }));
test("rule drafts isolate tasks, publish to every scene, update raw definitions, and roll back atomically", () =>
  run(async ({ req, task, publish }: any) => {
    const id = await task(),
      other = await task("隔离任务");
    assert.equal(
      (
        await req("/entities/rulePage/98005?changeTaskId=" + id, "PUT", {
          name: "变更后的规则",
          expression: "riskScore > 0.3",
        })
      ).status,
      200,
    );
    assert.equal(
      (await req("/entities/rulePage/98005")).data.expression,
      "riskScore > 0.9",
    );
    assert.equal(
      (await req("/entities/rulePage/98005?changeTaskId=" + other)).data
        .expression,
      "riskScore > 0.9",
    );
    assert.equal(
      (await req("/entities/rulePage/98005?changeTaskId=" + id)).data
        .expression,
      "riskScore > 0.3",
    );
    assert.equal(
      (await req("/source/archive/rule/98005?changeTaskId=" + id)).data.logic
        .expression,
      "riskScore > 0.3",
    );
    assert.equal((await publish(id)).status, 200);
    for (const scene of [98001, 98002])
      assert.equal(
        (await req("/source/configs/scene/" + scene)).data.items[0].rule.name,
        "变更后的规则",
      );
    assert.equal(
      (await req("/source/archive/rule/98005")).data.logic.expression,
      "riskScore > 0.3",
    );
    assert.equal(
      (
        await req("/entities/rulePage/98005?changeTaskId=" + id, "PUT", {
          name: "任务冻结",
        })
      ).status,
      409,
    );
    assert.equal(
      (await req("/releases/" + id + "/advance", "POST", { action: "回滚" }))
        .status,
      200,
    );
    assert.equal(
      (await req("/entities/rulePage/98005")).data.expression,
      "riskScore > 0.9",
    );
  }));
test("scenario edits stay scoped; group changes synchronize all inherited instances only after publication", () =>
  run(async ({ req, task, publish }: any) => {
    const id = await task();
    await req("/source/config/a?changeTaskId=" + id, "PUT", {
      decisionId: 98008,
      status: "标记",
      priority: 9,
    });
    assert.equal(
      (await req("/source/configs/scene/98001")).data.items[0].decision,
      "人工复核",
    );
    assert.equal(
      (await req("/source/configs/scene/98001?changeTaskId=" + id)).data
        .items[0].decision,
      "拒绝",
    );
    assert.equal((await publish(id)).status, 200);
    assert.equal(
      (await req("/source/configs/scene/98001")).data.items[0].decision,
      "拒绝",
    );
    assert.equal(
      (await req("/source/configs/scene/98002")).data.items[0].decision,
      "人工复核",
    );
    const gid = await task("规则组变更");
    await req("/groups/98004/rules/g?changeTaskId=" + gid, "PUT", {
      decisionId: 98008,
      status: "离线",
    });
    assert.equal(
      (await req("/source/configs/layerScene/98003?changeTaskId=" + gid)).data
        .items[0].decision,
      "拒绝",
    );
    assert.equal((await publish(gid)).status, 200);
    for (const scene of [98001, 98002])
      assert.equal(
        (await req("/source/configs/scene/" + scene)).data.items[0].status,
        "离线",
      );
    assert.equal(
      (await req("/source/configs/layerScene/98003")).data.items[0].decision,
      "拒绝",
    );
  }));
test("deleting an effective rule removes all bindings at publication and restores them on rollback", () =>
  run(async ({ req, task, publish, db }: any) => {
    const id = await task();
    await req("/entities/rulePage/98005?changeTaskId=" + id, "DELETE");
    assert.equal((await req("/entities/rulePage/98005")).status, 200);
    assert.equal(
      (await req("/entities/rulePage/98005?changeTaskId=" + id)).data
        .pendingAction,
      "删除",
    );
    assert.equal((await publish(id)).status, 200);
    assert.equal((await req("/entities/rulePage/98005")).status, 404);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM source_configs WHERE rule_id=98005")
        .get().n,
      0,
    );
    assert.equal(
      (await req("/releases/" + id + "/advance", "POST", { action: "回滚" }))
        .status,
      200,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM source_configs WHERE rule_id=98005")
        .get().n,
      4,
    );
  }));
test("risk tag parent filtering and source decision distribution are displayed from actual metadata", () =>
  run(async ({ req }: any) => {
    const r = await req("/entities/rulePage?riskTags=98100");
    assert.equal(r.data.total, 1);
    assert.equal(r.data.items[0].id, 98005);
    assert.equal(
      r.data.items[0].ruleStats.sourceDecisionDistribution[0].ratio,
      100,
    );
    assert.equal(r.data.items[0].ruleStats.sourceReferenceCount, 12);
    const g = await req("/groups/98004/rules");
    assert.deepEqual(g.data.items[0].riskTags, [98101]);
    assert.equal(g.data.items[0].modifiedBy, "demo");
    const tree = riskTagTree([
      { id: 98100, name: "一级风险" },
      { id: 98101, name: "二级风险", parentId: 98100 },
    ]);
    assert.equal(tree[0].children[0].value, 98101);
    assert.ok(
      tagDescendants(
        [
          { id: 1, name: "a" },
          { id: 2, name: "b", parentId: 1 },
        ],
        [1],
      ).has(2),
    );
  }));
test("batch changes and new rules remain isolated, draft cancellation works, and stale publish leaves production intact", () =>
  run(async ({ req, task, publish, db }: any) => {
    const id = await task();
    const batch = await req(
      "/policy-configs/batch?changeTaskId=" + id,
      "POST",
      { ids: ["a", "b", "c"], action: "修改", patch: { status: "离线" } },
    );
    assert.equal(batch.status, 200);
    assert.equal(
      (await req("/source/configs/scene/98001")).data.items[0].status,
      "生效",
    );
    const context = (await req("/changes/" + id + "/context")).data;
    assert.equal(context.localChanges.length, 3);
    await req(
      "/changes/" + id + "/items/" + context.localChanges[0].changeId,
      "DELETE",
    );
    assert.equal(
      (await req("/changes/" + id + "/context")).data.localChanges.length,
      2,
    );
    const created = await req("/entities/rulePage?changeTaskId=" + id, "POST", {
      name: "草稿新规则",
      enName: "draft_new",
      expression: "riskScore > 0.1",
    });
    assert.equal(created.status, 201);
    assert.equal(
      (await req("/entities/rulePage/" + created.data.id)).status,
      404,
    );
    assert.equal(
      (
        await req(
          "/entities/rulePage/" + created.data.id + "?changeTaskId=" + id,
        )
      ).status,
      200,
    );
    const failed = await req(
      "/groups/98004/create-rule?changeTaskId=" + id,
      "POST",
      { rule: { name: "回滚孤立草稿" }, config: { status: "生效" } },
    );
    assert.equal(failed.status, 400);
    assert.ok(
      !(await req("/changes/" + id + "/context")).data.localChanges.some(
        (c: any) => c.after?.name === "回滚孤立草稿",
      ),
    );
    db.prepare(
      "UPDATE source_configs SET data=json_set(data,'$.priority',777) WHERE id='b'",
    ).run();
    assert.equal((await publish(id)).status, 409);
    assert.equal(
      (await req("/entities/rulePage/" + created.data.id)).status,
      404,
    );
    assert.equal(
      (await req("/source/configs/layerScene/98003")).data.items[0].status,
      "标记",
    );
  }));
test("draft pagination and risk filtering include new and edited rules without changing production", () =>
  run(async ({ req, task }: any) => {
    const id = await task();
    await req("/entities/rulePage/98005?changeTaskId=" + id, "PUT", {
      name: "草稿改名",
      riskTags: [],
    });
    const created = await req("/entities/rulePage?changeTaskId=" + id, "POST", {
      name: "草稿新增",
      expression: "riskScore > 0.1",
      riskTags: [98101],
    });
    assert.equal(created.status, 201);
    const list = (
      await req(
        "/entities/rulePage?changeTaskId=" +
          id +
          "&pageSize=1&q=" +
          encodeURIComponent("草稿"),
      )
    ).data;
    assert.equal(list.total, 2);
    assert.equal(list.items.length, 1);
    const tagged = (
      await req("/entities/rulePage?changeTaskId=" + id + "&riskTags=98100")
    ).data;
    assert.equal(tagged.total, 1);
    assert.equal(tagged.items[0].id, created.data.id);
    assert.equal(
      (await req("/entities/rulePage?riskTags=98100")).data.items[0].id,
      98005,
    );
    assert.equal(
      (await req("/entities/rulePage?q=" + encodeURIComponent("草稿"))).data
        .total,
      0,
    );
    assert.equal(
      (
        await req("/entities/decisionList/98007?changeTaskId=" + id, "PUT", {
          name: "禁止串写",
        })
      ).status,
      409,
    );
    assert.equal(
      (await req("/entities/decisionList/98007")).data.name,
      "人工复核",
    );
  }));
test("urgent change preserves isolation until approved publication and freezes further edits", () =>
  run(async ({ req, task, db }: any) => {
    const id = await task();
    await req("/entities/rulePage/98005?changeTaskId=" + id, "PUT", {
      expression: "riskScore > 0.2",
    });
    assert.equal(
      (await req("/changes/" + id + "/urgent", "POST", {})).status,
      400,
    );
    const urgent = await req("/changes/" + id + "/urgent", "POST", {
      reason: "UI紧急配置验证",
    });
    assert.equal(urgent.data.phase, "审批");
    assert.equal(urgent.data.deployMode, 0);
    assert.equal(
      (await req("/entities/rulePage/98005")).data.expression,
      "riskScore > 0.9",
    );
    assert.equal(
      (
        await req("/entities/rulePage/98005?changeTaskId=" + id, "PUT", {
          name: "不可修改",
        })
      ).status,
      409,
    );
    await req("/releases/" + id + "/advance", "POST", { action: "审批" });
    for (let i = 0; i < 4; i++)
      assert.equal(
        (
          await req("/releases/" + id + "/advance", "POST", {
            action: "下一步",
          })
        ).status,
        200,
      );
    assert.equal(
      (await req("/entities/rulePage/98005")).data.expression,
      "riskScore > 0.2",
    );
  }));
test("new draft group rule, test records and mounts publish together and roll back together", () =>
  run(async ({ req, task, publish, db }: any) => {
    const id = await task();
    const created = await req(
      "/groups/98004/create-rule?changeTaskId=" + id,
      "POST",
      {
        rule: { name: "草稿组内新规则", expression: "riskScore > 0.1" },
        config: { status: "标记", decisionId: 98007, priority: 2 },
      },
    );
    assert.equal(created.status, 201);
    const ruleId = created.data.id;
    const tested = await req(
      "/rules/" + ruleId + "/test?changeTaskId=" + id,
      "POST",
      { input: { riskScore: 0.5 }, expected: true },
    );
    assert.equal(tested.status, 200);
    assert.equal(Boolean(tested.data.passed), true);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM test_runs WHERE rule_id=?").get(ruleId)
        .n,
      0,
    );
    assert.equal(
      (await req("/groups/98004/rules?changeTaskId=" + id)).data.items.length,
      2,
    );
    assert.equal((await req("/groups/98004/rules")).data.items.length, 1);
    assert.equal((await publish(id)).status, 200);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM source_configs WHERE rule_id=?")
        .get(ruleId).n,
      4,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM test_runs WHERE rule_id=?").get(ruleId)
        .n,
      1,
    );
    assert.equal(
      (await req("/releases/" + id + "/advance", "POST", { action: "回滚" }))
        .status,
      200,
    );
    assert.equal((await req("/entities/rulePage/" + ruleId)).status, 404);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM source_configs WHERE rule_id=?")
        .get(ruleId).n,
      0,
    );
  }));
