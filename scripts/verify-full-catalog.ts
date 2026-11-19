import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFullCatalogFixture } from "../server/full-catalog.ts";
import { openDatabase } from "../server/db.ts";
const fixture = readFullCatalogFixture();
assert.ok(fixture, "全量规则数据包必须存在");
const snapshot = JSON.parse(gunzipSync(fixture.bytes).toString());
assert.equal(snapshot.businessCode, 35);
assert.equal(snapshot.rules.length, fixture.manifest.counts.rules);
assert.equal(snapshot.features.length, fixture.manifest.counts.features);
assert.equal(
  new Set(snapshot.rules.map((r: any) => r.id)).size,
  snapshot.rules.length,
);
assert.ok(snapshot.rules.length >= snapshot.sourceTotal);
assert.deepEqual(snapshot.missingRuleDefinitions, []);
if (snapshot.featureScope === "all") {
  assert.deepEqual(
    snapshot.featureCatalogCounts,
    fixture.manifest.featureCatalogCounts,
  );
  assert.equal(snapshot.featureScope, fixture.manifest.featureScope);
  for (const [kind, total] of Object.entries(snapshot.featureCatalogCounts)) {
    const ids = snapshot.features
      .filter((f: any) => f.kind === kind)
      .map((f: any) => f.id);
    assert.equal(ids.length, total);
    assert.equal(new Set(ids).size, total);
  }
}
const db = openDatabase();
const report = JSON.parse(
  (
    db
      .prepare("SELECT value FROM settings WHERE key='full-catalog-report'")
      .get() as any
  ).value,
);
const protectedRules = new Set(report.protectedRules || []);
const protectedFeatures = new Set(report.protectedFeatures || []);
const entity = db.prepare("SELECT data FROM entities WHERE module=? AND id=?");
const archive = db.prepare(
  "SELECT data FROM source_archives WHERE kind=? AND id=? AND version=''",
);
const availableFactors = new Set(
  snapshot.features
    .filter((f: any) => f.kind === "factor")
    .map((f: any) => Number(f.id)),
);
const linked = db.prepare(
  "SELECT 1 FROM source_feature_refs WHERE rule_id=? AND feature_id=?",
);
for (const r of snapshot.rules) {
  if (protectedRules.has(r.id)) continue;
  const row = entity.get("rulePage", r.id) as any;
  assert.ok(row, "缺规则 " + r.id);
  const raw = archive.get("rule", r.id) as any;
  assert.ok(raw, "缺规则内容 " + r.id);
  assert.equal(JSON.parse(raw.data).logic.name, r.logic.name);
  assert.equal(JSON.parse(raw.data).logic.expression, r.logic.expression);
  const ids =
    typeof r.logic.factorIdList === "string"
      ? r.logic.factorIdList.split(",")
      : r.logic.factorIdList || [];
  for (const id of ids)
    if (availableFactors.has(Number(id)))
      assert.ok(
        linked.get(r.id, Number(id)),
        "缺少规则到特征关联 " + r.id + " → " + id,
      );
}
for (const f of snapshot.features) {
  const id = f.kind === "param" ? 1000000000 + f.id : f.id;
  if (protectedFeatures.has(id)) continue;
  assert.ok(entity.get("featureService", id), "缺特征 " + f.kind + ":" + f.id);
  const raw = archive.get("feature", id) as any;
  assert.ok(raw, "缺特征定义 " + id);
  assert.deepEqual(
    JSON.parse(raw.data).detail,
    f.detail,
    "特征定义不一致 " + id,
  );
}
for (const feature of snapshot.missingFeatures || []) {
  const id = feature.kind === "param" ? 1000000000 + feature.id : feature.id;
  assert.ok(entity.get("featureService", id), "缺失引用标记不存在 " + id);
  const raw = JSON.parse((archive.get("feature", id) as any).data);
  assert.equal(raw.available, false);
  assert.ok(raw.detail.reason);
}
for (const [field, kind] of [
  ["dependencies", "dependency"],
  ["fetchers", "fetcher"],
] as const) {
  assert.equal(snapshot[field]?.length || 0, fixture.manifest.counts[field]);
  for (const item of snapshot[field] || [])
    assert.ok(
      db
        .prepare("SELECT 1 FROM source_detail_objects WHERE kind=? AND id=?")
        .get(kind, String(item.id)),
      "缺少 RPC " + kind + " " + item.id,
    );
}
const dangling = db
  .prepare(
    "SELECT rule_id,feature_id FROM source_feature_refs r WHERE NOT EXISTS(SELECT 1 FROM entities e WHERE e.module='rulePage' AND e.id=r.rule_id) OR NOT EXISTS(SELECT 1 FROM entities e WHERE e.module='featureService' AND e.id=r.feature_id)",
  )
  .all();
assert.deepEqual(dangling, []);
console.log(
  JSON.stringify(
    {
      verified: true,
      businessCode: 35,
      sourceTotal: snapshot.sourceTotal,
      counts: fixture.manifest.counts,
      missingTypedFeatures: snapshot.missingTypedFeatures.length,
      unresolvedFeatureNames: snapshot.unresolvedFeatureNames.length,
      protectedLocalRules: protectedRules.size,
      protectedLocalFeatures: protectedFeatures.size,
    },
    null,
    2,
  ),
);
db.close();
