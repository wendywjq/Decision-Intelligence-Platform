import { expandedRiskTags } from "./risk-filter.ts";
import { ruleStats } from "./rule-policy.ts";
import type Database from "better-sqlite3";
import { moduleMap } from "../src/catalog.ts";
/** Filter/count in SQLite and decode only the requested page of large catalogs. */
export function listCatalogEntities(
  db: Database.Database,
  module: string,
  query: Record<string, unknown>,
  overrides?: Map<number, any>,
) {
  let prefix = "",
    from = "entities";
  const previewValues: any[] = [];
  if (overrides?.size) {
    prefix =
      "WITH preview(module,id,data) AS (VALUES " +
      [...overrides]
        .map(([id, e]) => {
          previewValues.push(module, id, JSON.stringify(e));
          return "(?,?,?)";
        })
        .join(",") +
      "), catalog AS (SELECT e.module,e.id,COALESCE(p.data,e.data) data FROM entities e LEFT JOIN preview p ON p.module=e.module AND p.id=e.id UNION ALL SELECT p.module,p.id,p.data FROM preview p WHERE NOT EXISTS(SELECT 1 FROM entities e WHERE e.module=p.module AND e.id=p.id)) ";
    from = "catalog AS entities";
  }
  const clauses = ["module=?"],
    values: any[] = [module];
  const allowed = new Set([
    "id",
    "q",
    "view",
    "riskTags",
    ...moduleMap[module].filters.map((f) => f.key),
  ]);
  for (const [key, value] of Object.entries(query)) {
    if (
      !value ||
      ["page", "pageSize", "searchMode", "changeTaskId"].includes(key)
    )
      continue;
    if (!allowed.has(key)) {
      clauses.push("0");
      continue;
    }
    const v = String(value);
    if (key === "riskTags") {
      const ids = expandedRiskTags(db, v);
      if (!ids.length) {
        clauses.push("0");
        continue;
      }
      const marks = ids.map(() => "?").join(",");
      clauses.push(
        "((json_type(entities.data,'$.riskTags') IS NULL AND EXISTS (SELECT 1 FROM source_archives a,json_each(a.data,'$.catalogInfo.riskTagInfo') t WHERE a.kind='rule' AND a.id=entities.id AND a.version='' AND CAST(t.key AS INTEGER) IN (" +
          marks +
          "))) OR EXISTS (SELECT 1 FROM json_each(entities.data,'$.riskTags') t WHERE CAST(CASE WHEN t.type='object' THEN json_extract(t.value,'$.id') ELSE t.value END AS INTEGER) IN (" +
          marks +
          ")))",
      );
      values.push(...ids, ...ids);
    } else if (key === "id") {
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
      .prepare(prefix + "SELECT COUNT(*) n FROM " + from + " WHERE " + where)
      .get(...previewValues, ...values) as any
  ).n;
  const pageNumber = Number(query.page),
    sizeNumber = Number(query.pageSize);
  const page = Number.isFinite(pageNumber)
    ? Math.max(1, Math.min(1e9, Math.floor(pageNumber) || 1))
    : 1;
  const pageSize = Number.isFinite(sizeNumber)
    ? Math.max(1, Math.min(100, Math.floor(sizeNumber) || 10))
    : 10;
  const term = String(query.q || "").trim();
  const exactFirst =
    term && query.searchMode !== "exact"
      ? "CASE WHEN CAST(id AS TEXT)=? OR CAST(json_extract(data,'$.sourceId') AS TEXT)=? OR lower(json_extract(data,'$.enName'))=lower(?) OR lower(json_extract(data,'$.name'))=lower(?) THEN 0 ELSE 1 END, "
      : "";
  const rows = db
    .prepare(
      prefix +
        "SELECT data FROM " +
        from +
        " WHERE " +
        where +
        " ORDER BY " +
        exactFirst +
        "json_extract(data,'$.updatedAt') DESC,id DESC LIMIT ? OFFSET ?",
    )
    .all(
      ...previewValues,
      ...values,
      ...(exactFirst ? Array(4).fill(term) : []),
      pageSize,
      (page - 1) * pageSize,
    ) as {
    data: string;
  }[];
  return {
    items: rows.map((r) => {
      const e = JSON.parse(r.data);
      return module === "rulePage"
        ? { ...e, ruleStats: ruleStats(db, e.id) }
        : e;
    }),
    total,
    page,
    pageSize,
  };
}
