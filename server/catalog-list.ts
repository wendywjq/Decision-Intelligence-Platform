import type Database from "better-sqlite3";
import { moduleMap } from "../src/catalog.ts";
/** Filter/count in SQLite and decode only the requested page of large catalogs. */
export function listCatalogEntities(
  db: Database.Database,
  module: string,
  query: Record<string, unknown>,
) {
  const clauses = ["module=?"],
    values: any[] = [module];
  const allowed = new Set([
    "id",
    "q",
    "view",
    ...moduleMap[module].filters.map((f) => f.key),
  ]);
  for (const [key, value] of Object.entries(query)) {
    if (!value || ["page", "pageSize", "searchMode"].includes(key)) continue;
    if (!allowed.has(key)) {
      clauses.push("0");
      continue;
    }
    const v = String(value);
    if (key === "id") {
      clauses.push(
        "(CAST(id AS TEXT)=? OR CAST(json_extract(data,'$.sourceId') AS TEXT)=?)",
      );
      values.push(v, v);
    } else if (key === "q" && query.searchMode === "exact") {
      clauses.push(
        "(CAST(id AS TEXT)=? OR CAST(json_extract(data,'$.sourceId') AS TEXT)=? OR lower(json_extract(data,'$.name'))=lower(?) OR lower(json_extract(data,'$.enName'))=lower(?))",
      );
      values.push(v, v, v, v);
    } else if (key === "q") {
      clauses.push(
        "instr(lower(CAST(id AS TEXT)||' '||COALESCE(json_extract(data,'$.sourceId'),'')||' '||COALESCE(json_extract(data,'$.name'),'')||' '||COALESCE(json_extract(data,'$.enName'),'')),lower(?))>0",
      );
      values.push(v);
    } else if (key === "view") {
      clauses.push(
        "instr(lower(COALESCE(NULLIF(json_extract(data,'$.view'),''),?)),lower(?))>0",
      );
      values.push(moduleMap[module].tabs?.[0] || "", v);
    } else {
      clauses.push(
        "instr(lower(COALESCE(CAST(json_extract(data,?) AS TEXT),'')),lower(?))>0",
      );
      values.push('$."' + key + '"', v);
    }
  }
  const where = clauses.join(" AND ");
  const total = (
    db
      .prepare("SELECT COUNT(*) n FROM entities WHERE " + where)
      .get(...values) as any
  ).n;
  const pageNumber = Number(query.page),
    sizeNumber = Number(query.pageSize);
  const page = Number.isFinite(pageNumber)
    ? Math.max(1, Math.min(1e9, Math.floor(pageNumber) || 1))
    : 1;
  const pageSize = Number.isFinite(sizeNumber)
    ? Math.max(1, Math.min(100, Math.floor(sizeNumber) || 10))
    : 10;
  const rows = db
    .prepare(
      "SELECT data FROM entities WHERE " +
        where +
        " ORDER BY json_extract(data,'$.updatedAt') DESC,id DESC LIMIT ? OFFSET ?",
    )
    .all(...values, pageSize, (page - 1) * pageSize) as { data: string }[];
  return { items: rows.map((r) => JSON.parse(r.data)), total, page, pageSize };
}
