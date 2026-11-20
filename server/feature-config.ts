import { runAviator } from "./aviator.ts";
import type { Express } from "express";
import type Database from "better-sqlite3";
type Save = (module: string, id: number, data: any, action: string) => any;
export function registerFeatureConfig(
  app: Express,
  db: Database.Database,
  save: Save,
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS local_accumulation_events(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL)",
  );
  app.post("/api/feature-logic/map-test", (req, res) => {
    try {
      const { targetId, param, source, input } = req.body;
      if (
        !Number.isSafeInteger(targetId) ||
        !param ||
        !source ||
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      )
        throw Error("请选择调用目标并填写映射");
      const row = db
        .prepare(
          "SELECT data FROM entities WHERE module='featureService' AND id=?",
        )
        .get(targetId) as any;
      if (!row) throw Error("目标特征不存在");
      const target = JSON.parse(row.data);
      const archived = db
        .prepare(
          "SELECT data FROM source_archives WHERE kind='feature' AND id=? AND version=''",
        )
        .get(targetId) as any;
      const d = archived
        ? JSON.parse(archived.data).detail
        : target.featureDefinition;
      let expr = target.enName;
      if (target.type !== "原始特征" && target.sourceKind !== "param") {
        if (![0, 1].includes(d?.type)) throw Error("调用目标依赖外部特征服务");
        expr = d.originExpression || d.origin_expression || d.expression;
      }
      return res.json({ value: runAviator(expr, input, { param, source }) });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });
  app.get("/api/feature-config/options", (_, res) => {
    const events = new Set<string>(),
      traffic: Record<string, string[]> = {};
    for (const row of db
      .prepare(
        "SELECT data FROM source_detail_objects WHERE kind='accumulation'",
      )
      .iterate() as Iterable<any>) {
      const a = JSON.parse(row.data);
      for (const event of a.events || []) events.add(event);
      if (a.events?.length === 1 && Array.isArray(a.traffic))
        traffic[a.events[0]] = a.traffic;
    }
    for (const row of db
      .prepare("SELECT id,name FROM local_accumulation_events ORDER BY id DESC")
      .iterate() as Iterable<any>)
      events.add("本地 " + row.id + " | " + row.name);
    res.json({
      events: [...events],
      traffic,
      categories: [
        "存量特征/存量默认",
        "内容安全特征树/内容特征/图片",
        "内容安全特征树/内容特征/文本",
      ],
    });
  });
  app.post("/api/feature-config/events", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 200)
      return res
        .status(400)
        .json({ error: "请填写 1 至 200 字的累计事件名称" });
    db.prepare(
      "INSERT OR IGNORE INTO local_accumulation_events(name) VALUES(?)",
    ).run(name);
    const row = db
      .prepare("SELECT id FROM local_accumulation_events WHERE name=?")
      .get(name) as any;
    res.json({ label: "本地 " + row.id + " | " + name });
  });
  app.get("/api/feature-config/offline-columns", (req, res) => {
    const table = String(req.query.table || "").trim();
    if (!table) return res.status(400).json({ error: "请填写特征 Hive 表" });
    const rows = db
      .prepare(
        "SELECT data FROM entities WHERE module='featureService' AND json_extract(data,'$.featureForm.table')=?",
      )
      .all(table) as { data: string }[];
    const columns = new Map();
    for (const row of rows) {
      const v = JSON.parse(row.data).featureForm;
      for (const col of v.columns || [])
        if (col.column) columns.set(col.column, col);
    }
    res.json({ items: [...columns.values()] });
  });
  app.post("/api/feature-config/batch", (req, res) => {
    const items = req.body?.items;
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.length > 500 ||
      items.some(
        (x) =>
          !x ||
          x.type !== "离线特征" ||
          typeof x.name !== "string" ||
          !x.name.trim() ||
          !/^[A-Za-z_]\w*$/.test(x.enName) ||
          !x.dataType,
      )
    )
      return res
        .status(400)
        .json({ error: "请检查特征列的名称、结果类型和批量条数" });
    const ids = db.transaction(() => {
      let { id } = db
        .prepare(
          "SELECT coalesce(max(id),10000) AS id FROM entities WHERE module='featureService'",
        )
        .get() as { id: number };
      return items.map((x) => save("featureService", ++id, x, "批量新建").id);
    })();
    res.status(201).json({ ids });
  });
}
