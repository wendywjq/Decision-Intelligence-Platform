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

test("full catalog extends rules and features without replacing scene bindings, rich details or local edits", () => {
  const db = openDatabase(":memory:");
  importSourceSnapshot(
    db,
    {
      capturedAt: "2026-11-17",
      scenes: [
        {
          scene: { id: 3503, name: "已收录场景" },
          configs: [{ id: 1, ruleId: 80001, status: 64 }],
        },
      ],
      features: [
        {
          id: 70001,
          kind: "factor",
          detail: { id: 70001, name: "old_feature", type: 1 },
        },
      ],
      rules: [
        {
          id: 80001,
          logic: {
            id: 80001,
            name: "old_rule",
            alias: "旧规则",
            factorNameList: ["old_feature"],
          },
          detail: {
            versionInfo: [{ version_id: 1 }],
            basicInfo: { testCaseList: [{ id: 1 }] },
          },
        },
        {
          id: 80003,
          logic: { id: 80003, name: "local_rule", alias: "本地修改前" },
        },
      ],
    },
    "base-digest",
  );
  const oldReport = (
    db
      .prepare("SELECT value FROM settings WHERE key='source-import-report'")
      .get() as any
  ).value;
  db.prepare(
    "UPDATE entities SET data=json_set(data,'$.name','本地修改后') WHERE module='rulePage' AND id=80003",
  ).run();
  db.prepare(
    "INSERT INTO audit(module,entity_id,action) VALUES('rulePage',80003,'修改')",
  ).run();
  db.prepare(
    "INSERT INTO audit(module,entity_id,action) VALUES('rulePage',80004,'删除')",
  ).run();
  importSourceSnapshot(
    db,
    {
      capturedAt: "2026-11-18",
      sourceTotal: 4,
      indexedRuleCount: 4,
      features: [
        { id: 70002, kind: "param", detail: { id: 70002, name: "new_param" } },
      ],
      rules: [
        {
          id: 80001,
          logic: {
            id: 80001,
            name: "old_rule",
            alias: "更新后的规则",
            factorNameList: ["old_feature"],
          },
          catalogInfo: { riskTagInfo: { 5: "风险标签" }, refCount: 3 },
        },
        {
          id: 80002,
          logic: {
            id: 80002,
            name: "new_rule",
            alias: "新规则",
            paramNameList: ["new_param"],
            factorIdList: "70001",
          },
        },
        {
          id: 80003,
          logic: { id: 80003, name: "local_rule", alias: "线上更新不覆盖本地" },
        },
        {
          id: 80004,
          logic: { id: 80004, name: "deleted_rule", alias: "不恢复本地删除" },
        },
      ],
    },
    "full-digest",
    { additive: true, preserveLocal: true },
  );
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) n FROM source_configs WHERE scene_id=3503")
        .get() as any
    ).n,
    1,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM source_feature_refs WHERE rule_id=80001 AND feature_id=70001",
        )
        .get() as any
    ).n,
    1,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM source_feature_refs WHERE rule_id=80002 AND feature_id=1000070002",
        )
        .get() as any
    ).n,
    1,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM source_feature_refs WHERE rule_id=80002 AND feature_id=70001",
        )
        .get() as any
    ).n,
    1,
  );
  const archive = JSON.parse(
    (
      db
        .prepare(
          "SELECT data FROM source_archives WHERE kind='rule' AND id=80001",
        )
        .get() as any
    ).data,
  );
  assert.equal(archive.detail.versionInfo[0].version_id, 1);
  assert.equal(archive.detail.basicInfo.testCaseList[0].id, 1);
  assert.equal(archive.detail.basicInfo.rule.alias, "更新后的规则");
  assert.equal(
    JSON.parse(
      (
        db
          .prepare(
            "SELECT data FROM entities WHERE module='rulePage' AND id=80003",
          )
          .get() as any
      ).data,
    ).name,
    "本地修改后",
  );
  assert.equal(
    db
      .prepare("SELECT 1 FROM entities WHERE module='rulePage' AND id=80004")
      .get(),
    undefined,
  );
  assert.equal(
    (
      db
        .prepare("SELECT value FROM settings WHERE key='source-import-report'")
        .get() as any
    ).value,
    oldReport,
  );
  const report = JSON.parse(
    (
      db
        .prepare("SELECT value FROM settings WHERE key='full-catalog-report'")
        .get() as any
    ).value,
  );
  assert.deepEqual(report.protectedRules, [80003, 80004]);
  db.close();
});

test("full catalog interfaces import atomically and missing source definitions remain explicit", async () => {
  const { importFullCatalogSnapshot } =
    await import("../server/full-catalog.ts");
  const db = openDatabase(":memory:");
  const snapshot = {
    capturedAt: "2026-11-18",
    sourceTotal: 1,
    indexedRuleCount: 1,
    rules: [
      {
        id: 81001,
        logic: { id: 81001, name: "uses_missing", factorIdList: "71001" },
      },
    ],
    missingFeatures: [
      {
        id: 71001,
        kind: "factor",
        available: false,
        detail: {
          id: 71001,
          name: "referenced_missing_feature",
          reason: "因子不存在",
        },
      },
    ],
    dependencies: [{ id: 91001, fetcherId: 92001 }],
    fetchers: [
      {
        id: 92001,
        detail: { id: 92001, name: "源接口", appId: 35, status: 64 },
        params: [{ name: "cvId" }],
      },
    ],
  };
  importFullCatalogSnapshot(db, snapshot, "complete-one");
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM source_detail_objects WHERE kind='dependency' AND id='91001'",
      )
      .get(),
  );
  const fetcher = JSON.parse(
    (
      db
        .prepare(
          "SELECT data FROM source_detail_objects WHERE kind='fetcher' AND id='92001'",
        )
        .get() as any
    ).data,
  );
  assert.equal(fetcher.params[0].name, "cvId");
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM source_feature_refs WHERE rule_id=81001 AND feature_id=71001",
      )
      .get(),
  );
  const missing = JSON.parse(
    (
      db
        .prepare(
          "SELECT data FROM source_archives WHERE kind='feature' AND id=71001",
        )
        .get() as any
    ).data,
  );
  assert.equal(missing.available, false);
  assert.equal(missing.detail.reason, "因子不存在");
  assert.throws(() =>
    importFullCatalogSnapshot(
      db,
      {
        capturedAt: "later",
        rules: [{ id: 81002, logic: { id: 81002, name: "must_rollback" } }],
        fetchers: [{ id: 92002 }],
      },
      "must-not-commit",
    ),
  );
  assert.equal(
    db
      .prepare("SELECT 1 FROM entities WHERE module='rulePage' AND id=81002")
      .get(),
    undefined,
  );
  assert.equal(
    JSON.parse(
      (
        db
          .prepare("SELECT value FROM settings WHERE key='full-catalog-digest'")
          .get() as any
      ).value,
    ),
    "complete-one",
  );
  db.close();
});

test("an older deleted demo ID does not hide a newly created source rule with the same ID", () => {
  const db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO audit(module,entity_id,action,updated_at) VALUES('rulePage',2578001,'删除','2026-11-17 12:29:35')",
  ).run();
  const snapshot = {
    capturedAt: "2026-11-18",
    rules: [
      {
        id: 2578001,
        logic: {
          id: 2578001,
          name: "new_source_rule",
          alias: "后续新增的源规则",
          addtime: 1794972667,
        },
      },
    ],
  };
  importSourceSnapshot(db, snapshot, "collision-safe", {
    additive: true,
    preserveLocal: true,
  });
  const row = JSON.parse(
    (
      db
        .prepare(
          "SELECT data FROM entities WHERE module='rulePage' AND id=2578001",
        )
        .get() as any
    ).data,
  );
  assert.equal(row.enName, "new_source_rule");
  db.prepare(
    "UPDATE entities SET data=json_set(data,'$.name','后续本地修改') WHERE module='rulePage' AND id=2578001",
  ).run();
  db.prepare(
    "INSERT INTO audit(module,entity_id,action,updated_at) VALUES('rulePage',2578001,'修改','2026-11-19 12:29:35')",
  ).run();
  importSourceSnapshot(db, snapshot, "preserved-after-import", {
    additive: true,
    preserveLocal: true,
  });
  assert.equal(
    JSON.parse(
      (
        db
          .prepare(
            "SELECT data FROM entities WHERE module='rulePage' AND id=2578001",
          )
          .get() as any
      ).data,
    ).name,
    "后续本地修改",
  );
  db.close();
});

test("expression-only rules link catalog variables while quoted values, comments and properties do not create false references", () => {
  const db = openDatabase(":memory:");
  importSourceSnapshot(db, {
    capturedAt: "2026-11-18",
    features: ["model_score", "label", "riskScore", "ignored", "property"].map(
      (name, i) => ({
        id: 72000 + i,
        kind: "factor",
        detail: { id: 72000 + i, name },
      }),
    ),
    rules: [
      {
        id: 82001,
        logic: {
          id: 82001,
          name: "legacy_expression",
          expression:
            'model_score > double("0.9") && label == "riskScore" && record.property > 0 /* ignored */',
        },
      },
    ],
  });
  const refs = db
    .prepare(
      "SELECT name FROM source_feature_refs WHERE rule_id=82001 ORDER BY name",
    )
    .all() as any[];
  assert.deepEqual(
    refs.map((r) => r.name),
    ["label", "model_score"],
  );
  db.close();
});
