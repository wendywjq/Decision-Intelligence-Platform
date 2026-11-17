import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.ts";
import { importSourceSnapshot } from "../server/source-import.ts";
test("source importer preserves repeated rules in separate groups and resolves JSON-string conditions", () => {
  const db = openDatabase(":memory:");
  const snapshot = {
    capturedAt: "2026-11-17T00:00:00Z",
    selection: {},
    scenes: [
      {
        scene: { id: 3503, name: "来源场景" },
        configs: [
          { id: 1, ruleId: 4, ruleGroupId: 2, status: 64 },
          { id: 2, ruleId: 4, ruleGroupId: 3, status: 32 },
        ],
      },
    ],
    groups: [
      { group: { id: 2, name: "组A" }, configs: [] },
      { group: { id: 3, name: "组B" }, configs: [] },
    ],
    rules: [
      {
        id: 4,
        logic: {
          id: 4,
          name: "rule",
          alias: "规则",
          expression: "1",
          ruleConditions: JSON.stringify([
            {
              leftParamValue: JSON.stringify([
                { id: 5, value: "f", zeusDataType: 1 },
              ]),
            },
          ]),
        },
      },
    ],
    features: [
      {
        id: 5,
        kind: "factor",
        detail: { id: 5, name: "f", alias: "因子", expression: "x", type: 1 },
      },
    ],
  };
  importSourceSnapshot(db, snapshot);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM source_configs WHERE scene_id=3503")
        .get() as any
    ).n,
    2,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM source_feature_refs WHERE rule_id=4",
        )
        .get() as any
    ).n,
    1,
  );
  importSourceSnapshot(db, snapshot);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM source_configs WHERE scene_id=3503")
        .get() as any
    ).n,
    2,
  );
  db.close();
});
