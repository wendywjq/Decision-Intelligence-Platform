import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.ts";
const manifest = JSON.parse(
  readFileSync("fixtures/zeus-details-manifest.json", "utf8"),
);
const db = openDatabase();
for (const [field, kind] of [
  ["graphVersions", "graphVersion"],
  ["dependencies", "dependency"],
  ["fetchers", "fetcher"],
  ["rules", "ruleDetail"],
] as const) {
  const n = (
    db
      .prepare("SELECT COUNT(*) n FROM source_detail_objects WHERE kind=?")
      .get(kind) as any
  ).n;
  assert.equal(n, manifest.counts[field], field);
}
for (const { data } of db
  .prepare("SELECT data FROM source_detail_objects WHERE kind='dependency'")
  .all() as any[]) {
  const d = JSON.parse(data);
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM source_detail_objects WHERE kind='fetcher' AND id=?",
      )
      .get(String(d.fetcherId)),
    "missing fetcher " + d.fetcherId,
  );
}
for (const { data } of db
  .prepare("SELECT data FROM source_detail_objects WHERE kind='logQuery'")
  .all() as any[]) {
  const q = JSON.parse(data);
  const n = (
    db
      .prepare("SELECT COUNT(*) n FROM source_request_logs WHERE cv_id=?")
      .get(q.cvId) as any
  ).n;
  assert.equal(n, q.total);
  assert.equal(q.total, q.detailTotal);
}
console.log(
  JSON.stringify(
    {
      verified: true,
      definitions: manifest.counts,
      localRequests: (
        db.prepare("SELECT COUNT(*) n FROM source_request_logs").get() as any
      ).n,
    },
    null,
    2,
  ),
);
db.close();
