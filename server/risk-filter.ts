import type Database from "better-sqlite3";
import { tagDescendants } from "../src/risk-tags.ts";
export function riskIdsForRule(db: Database.Database, id: number) {
  const row = db
    .prepare(
      "SELECT data FROM source_archives WHERE kind='rule' AND id=? AND version='' ",
    )
    .get(id) as any;
  const raw = row ? JSON.parse(row.data) : {};
  const e = db
    .prepare("SELECT data FROM entities WHERE module='rulePage' AND id=?")
    .get(id) as any;
  const entity = e ? JSON.parse(e.data) : {};
  return [
    ...new Set<number>([
      ...Object.keys(raw.catalogInfo?.riskTagInfo || {}).map(Number),
      ...(entity.riskTags || []).map((t: any) =>
        Number(typeof t === "object" ? t.id : t),
      ),
    ]),
  ].filter(Number.isFinite);
}
export function expandedRiskTags(db: Database.Database, query: any) {
  const ids = String(query || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  const tags = (
    db.prepare("SELECT data FROM entities WHERE module='tag'").all() as any[]
  ).map((r) => JSON.parse(r.data));
  return [...tagDescendants(tags, ids)];
}
