import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { readSourceFixture } from "../server/source-import.ts";
import { openDatabase } from "../server/db.ts";
const manifest = JSON.parse(
  readFileSync("fixtures/zeus-examples-manifest.json", "utf8"),
);
assert.ok(readSourceFixture());
const db = openDatabase();
const report = JSON.parse(
  (
    db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get("source-import-report") as any
  ).value,
);
assert.deepEqual(report.counts, manifest.counts);
for (const [key, module] of [
  ["sceneIds", "scene"],
  ["graphIds", "layerScene"],
  ["groupIds", "rulesGroup"],
  ["releaseIds", "release/list"],
] as const) {
  for (const id of manifest.selection[key])
    assert.ok(
      db
        .prepare("SELECT 1 FROM entities WHERE module=? AND id=?")
        .get(module, id),
      module + " " + id,
    );
}
for (const [name, count] of Object.entries(manifest.bindingCounts)) {
  const module = name === "scene" ? "scene" : "rulesGroup";
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM source_configs WHERE scene_module=?",
        )
        .get(module) as any
    ).n,
    count,
  );
}
const missingRules = db
  .prepare(
    "SELECT DISTINCT rule_id FROM source_configs c WHERE NOT EXISTS(SELECT 1 FROM entities e WHERE e.module='rulePage' AND e.id=c.rule_id)",
  )
  .all();
assert.deepEqual(missingRules, []);
const missingGroups = db
  .prepare(
    "SELECT DISTINCT group_id FROM source_configs c WHERE group_id>0 AND NOT EXISTS(SELECT 1 FROM entities e WHERE e.module='rulesGroup' AND e.id=c.group_id)",
  )
  .all();
assert.deepEqual(missingGroups, []);
assert.equal(
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM source_archives WHERE kind='tag'")
      .get() as any
  ).n,
  manifest.counts.tags,
);
assert.ok(
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM source_archives WHERE kind='rule'")
      .get() as any
  ).n >= manifest.counts.rules,
);

const baseline = JSON.parse(gunzipSync(readSourceFixture()!).toString());
assert.ok(
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM source_archives WHERE kind='feature'")
      .get() as any
  ).n >=
    manifest.counts.features + manifest.missingFeatures.length,
);
for (const f of [...baseline.features, ...baseline.missingFeatures]) {
  const id = f.kind === "param" ? 1000000000 + f.id : f.id;
  assert.ok(
    db
      .prepare("SELECT 1 FROM source_archives WHERE kind='feature' AND id=?")
      .get(id),
    "missing original feature " + id,
  );
}
assert.equal(
  (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM source_feature_refs WHERE rule_id=5595",
      )
      .get() as any
  ).n,
  2,
);
for (const id of manifest.selection.graphIds) {
  const a = JSON.parse(
    (
      db
        .prepare("SELECT data FROM source_archives WHERE kind='graph' AND id=?")
        .get(id) as any
    ).data,
  );
  assert.ok(a.graph.nodes.length);
  assert.ok(a.decisionTree.nodes.length);
  assert.ok(a.versions.length);
}
for (const id of manifest.selection.releaseIds) {
  const r = JSON.parse(
    (
      db
        .prepare(
          "SELECT data FROM source_archives WHERE kind='release' AND id=?",
        )
        .get(id) as any
    ).data,
  );
  assert.ok(r.changes);
  for (const e of r.experimentResults) {
    assert.equal(e.comparison.items.length, e.comparison.total);
    assert.equal(e.details.items.length, e.details.total);
  }
  for (const g of r.grayStages) {
    assert.equal(g.comparison.items.length, g.comparison.capturedCount);
    assert.equal(
      g.comparison.sourceCountMismatch,
      g.comparison.items.length !== g.comparison.total,
    );
    assert.equal(g.details.items.length, g.details.total);
  }
}
assert.equal(report.missingFeatures.length, 3);
console.log(
  JSON.stringify(
    {
      verified: true,
      counts: report.counts,
      bindings: manifest.bindingCounts,
      missingFeatures: report.missingFeatures.length,
    },
    null,
    2,
  ),
);
db.close();
