import { referencedFeatureNames } from "../server/source-details.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.ts";
import { createApp } from "../server/app.ts";
test("detail routes preserve log identity, time filters and feature lineage with cycles", async () => {
  const db = openDatabase(":memory:");
  const put = (id: number, enName: string, expression: string) =>
    db.prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)").run(
      "featureService",
      id,
      JSON.stringify({
        id,
        enName,
        name: enName,
        expression,
        type: "衍生因子",
      }),
    );
  put(70001, "upstream", "downstream");
  put(70002, "downstream", "upstream");
  db.prepare("INSERT INTO source_request_logs VALUES(?,?,?,?,?)").run(
    "request-a",
    "123",
    100,
    JSON.stringify({
      requestId: "request-a",
      logTime: 100,
      sceneInfo: { id: 7 },
    }),
    JSON.stringify({ requestId: "request-a", paramContext: { x: null } }),
  );
  db.prepare("INSERT INTO source_detail_objects VALUES(?,?,?)").run(
    "graphVersion",
    "7:2",
    JSON.stringify({ id: 7, version: 2, nodes: [] }),
  );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  try {
    const data = await (
      await fetch(base + "/source/features/70001/lineage")
    ).json();
    assert.equal(data.upstream[0].id, 70002);
    assert.equal(data.downstream[0].id, 70002);
    assert.equal(data.nodes.length, 2);
    assert.equal(
      (await (await fetch(base + "/source/logs?cvId=123&startTime=101")).json())
        .total,
      0,
    );
    assert.equal(
      (await (await fetch(base + "/source/logs?cvId=123&sceneId=7")).json())
        .total,
      1,
    );
    const log = await (await fetch(base + "/source/logs/request-a")).json();
    assert.equal(log.detail.paramContext.x, null);
    assert.equal(log.cvId, "123");
    assert.equal(
      (await (await fetch(base + "/source/graph/7/version/2")).json()).version,
      2,
    );
    assert.equal((await fetch(base + "/source/graph/7/version/3")).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("rule dependency extraction excludes metadata keys and constant strings", () => {
  const logic = {
    id: 123,
    name: "name",
    alias: "alias",
    creator: "creator",
    parsedExpInfo: JSON.stringify({ dependentEleNames: ["upstream"] }),
    ruleConditions: JSON.stringify([
      {
        leftParamValue: JSON.stringify({ value: "rpc_param", zeusDataType: 1 }),
        rightParamValue: JSON.stringify({ value: "name", zeusDataType: 4 }),
      },
    ]),
  };
  assert.deepEqual([...referencedFeatureNames(logic)].sort(), [
    "rpc_param",
    "upstream",
  ]);
});
