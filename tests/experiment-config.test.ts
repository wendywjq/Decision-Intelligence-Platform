import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.ts";
import { createApp } from "../server/app.ts";
async function run(fn: (x: any) => Promise<void>) {
  const db = openDatabase(":memory:");
  const put = (m: string, id: number, d: any) =>
    db
      .prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)")
      .run(m, id, JSON.stringify({ id, name: m + id, ...d }));
  put("scene", 97001, { name: "实验场景甲" });
  put("layerScene", 97002, { name: "实验分层场景" });
  put("rulesGroup", 97003, { name: "实验规则组" });
  put("rulePage", 97004, { name: "实验规则", expression: "riskScore > 0.9" });
  for (const [id, m, s] of [
    ["g", "rulesGroup", 97003],
    ["a", "scene", 97001],
    ["b", "layerScene", 97002],
  ] as const)
    db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
      id,
      m,
      s,
      97004,
      97003,
      "",
      JSON.stringify({ id, ruleId: 97004, status: "生效" }),
    );
  // Existing source sample metadata is joined by affected scene ID, never fabricated.
  db.prepare("INSERT INTO source_archives VALUES(?,?,?,?)").run(
    "release",
    97999,
    "",
    JSON.stringify({
      basic: {
        sampleTrafficSource: {
          sampleInfo: {
            blockSamples: [{ id: 97001, name: "实验场景甲", sampleCount: 811 }],
            regressBlackSamples: [],
            regressWhiteSamples: [],
          },
        },
      },
    }),
  );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const req = async (p: string, m = "GET", b?: any) => {
    const r = await fetch(base + p, {
      method: m,
      headers: { "Content-Type": "application/json" },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const task = async () => {
    const r = await req("/entities/release%2Flist", "POST", {
      name: "实验配置验证",
      phase: "实验",
      status: "待启动",
      localChanges: [],
    });
    return r.data.id;
  };
  try {
    await fn({ db, req, task, put });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
}
test("experiment page derives impact and required benchmarks from the current change task", () =>
  run(async ({ req, task }: any) => {
    const id = await task();
    await req("/entities/rulePage/97004?changeTaskId=" + id, "PUT", {
      name: "规则草稿",
    });
    const c = (await req("/releases/" + id + "/experiment-config")).data;
    assert.equal(c.affected.scene.length, 2);
    assert.equal(c.affected.rule_group[0].id, 97003);
    assert.equal(c.affected.rule[0].name, "规则草稿");
    assert.equal(c.trafficSources.length, 2);
    assert.equal(c.sampleRequired, true);
    assert.equal(c.benchmark.blockSamples[0].sampleCount, 811);
    assert.equal(c.estimates.parallel, undefined);
    assert.equal(
      (await req("/releases/12345678/experiment-config")).status,
      404,
    );
    const other = await task();
    assert.equal(
      (await req("/releases/" + other + "/experiment-config")).data.affected
        .rule.length,
      0,
    );
  }));
test("experiment settings validate, persist and require mandatory sample traffic", () =>
  run(async ({ req, task }: any) => {
    const id = await task();
    await req("/entities/rulePage/97004?changeTaskId=" + id, "PUT", {
      expression: "riskScore > 0.8",
    });
    const path = "/releases/" + id + "/experiment-config";
    const c = (await req(path)).data.config;
    for (const bad of [
      { ...c, trafficSourceTypes: [] },
      { ...c, trafficSourceTypes: ["0", "1"] },
      { ...c, parallel: { ...c.parallel, rate: 101 } },
      { ...c, history: { days: 0 } },
      { ...c, parallel: { ...c.parallel, endTime: "2020-01-01" } },
      {
        ...c,
        parallel: {
          ...c.parallel,
          filters: [{ field: "", operator: "==", value: "1" }],
        },
      },
    ])
      assert.equal((await req(path, "PUT", bad)).status, 400);
    c.parallel.rate = 3;
    c.history.days = 2;
    c.parallel.filters = [
      { field: "sourceIp", operator: "==", value: "127.0.0.1" },
    ];
    assert.equal((await req(path, "PUT", c)).status, 200);
    const saved = (await req(path)).data.config;
    assert.equal(saved.parallel.rate, 3);
    assert.equal(saved.history.days, 2);
    assert.deepEqual(saved.parallel.filters, c.parallel.filters);
    assert.equal(
      (await req("/entities/rulePage/97004")).data.expression,
      "riskScore > 0.9",
    );
    assert.equal((await req(path)).data.task.phase, "实验");
  }));
test("submitting experiment configuration freezes the task without publishing policies", () =>
  run(async ({ req, task, put }: any) => {
    const id = await task(),
      path = "/releases/" + id + "/experiment-config";
    let c = (await req(path)).data.config;
    assert.equal((await req(path + "/start", "POST", c)).status, 400);
    await req("/entities/rulePage/97004?changeTaskId=" + id, "PUT", {
      expression: "riskScore > 0.1",
    });
    c = (await req(path)).data.config;
    const started = await req(path + "/start", "POST", c);
    assert.equal(started.status, 200);
    assert.equal(started.data.task.phase, "审批");
    assert.ok(started.data.task.experimentStartedAt);
    assert.equal(
      (await req("/entities/rulePage/97004")).data.expression,
      "riskScore > 0.9",
    );
    assert.equal((await req(path, "PUT", c)).status, 409);
    assert.equal((await req(path + "/start", "POST", c)).status, 409);
    assert.equal(
      (await req("/entities/rulePage/97004?changeTaskId=" + id, "DELETE"))
        .status,
      409,
    );
    put("release/list", 97998, {
      phase: "实验",
      status: "待启动",
      sourceImported: true,
    });
    assert.equal(
      (await req("/releases/97998/experiment-config")).data.isEditable,
      false,
    );
  }));

test("legacy flat experiment settings remain compatible with the new configuration page", () =>
  run(async ({ req, put }: any) => {
    put("release/list", 97888, {
      name: "旧任务",
      phase: "实验",
      status: "待启动",
      experimentConfig: { trafficSourceTypes: ["0"], rate: 10 },
      localChanges: [],
    });
    const c = (await req("/releases/97888/experiment-config")).data.config;
    assert.equal(c.parallel.rate, 10);
    assert.equal(c.history.days, 1);
    assert.deepEqual(c.parallel.filters, []);
    assert.ok(Date.parse(c.parallel.endTime) > Date.now());
    assert.equal(
      (await req("/releases/97888/experiment-config", "PUT", c)).status,
      200,
    );
  }));
