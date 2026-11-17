import type Database from "better-sqlite3";
import type { Express } from "express";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
export function referencedFeatureNames(logic: any) {
  const tokens = new Set<string>();
  for (const key of ["factorNameList", "paramNameList"])
    for (const name of logic[key] || [])
      tokens.add(typeof name === "string" ? name : name.name);
  try {
    for (const name of JSON.parse(logic.parsedExpInfo || "{}")
      .dependentEleNames || [])
      tokens.add(name);
  } catch {}
  const scan = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (
      x.value &&
      typeof x.value === "string" &&
      [0, 1].includes(x.zeusDataType)
    )
      tokens.add(x.value);
    Object.values(x).forEach((v) => {
      if (Array.isArray(v)) v.forEach(scan);
      else scan(v);
    });
  };
  try {
    const cs =
      typeof logic.ruleConditions === "string"
        ? JSON.parse(logic.ruleConditions)
        : logic.ruleConditions;
    for (const c of cs || [])
      for (const key of ["leftParamValue", "rightParamValue"])
        try {
          scan(JSON.parse(c[key]));
        } catch {}
  } catch {}

  return tokens;
}
export function syncDetailFixtures(db: Database.Database, loadFixtures = true) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS source_detail_objects(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS source_request_logs(request_id TEXT PRIMARY KEY,cv_id TEXT,log_time INTEGER,basic TEXT,detail TEXT);`,
  );
  if (!loadFixtures) return;
  const manifests = [
    "fixtures/zeus-details-manifest.json",
    "data/zeus-source/detail-pages/logs-manifest.json",
  ];
  for (const path of manifests) {
    if (!existsSync(path)) continue;
    const m = JSON.parse(readFileSync(path, "utf8"));
    const bytes = Buffer.concat(
      m.parts.map((p: any) => {
        const b = readFileSync(p.path);
        if (createHash("sha256").update(b).digest("hex") !== p.sha256)
          throw Error("详情包校验失败");
        return b;
      }),
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== m.sha256) throw Error("详情包摘要错误");
    const key = "detail-fixture:" + path;
    const old = db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key) as any;
    if (old?.value === "v3:" + digest) continue;
    const data = JSON.parse(gunzipSync(bytes).toString());
    db.transaction(() => {
      const put = db.prepare(
        "INSERT OR REPLACE INTO source_detail_objects VALUES(?,?,?)",
      );
      for (const v of data.graphVersions || [])
        put.run(
          "graphVersion",
          `${v.id}:${v.version}`,
          JSON.stringify({ ...v.graph, decisionTreeArchive: v.decisionTree }),
        );
      for (const d of data.dependencies || [])
        put.run("dependency", String(d.id), JSON.stringify(d));
      for (const d of data.fetchers || []) {
        put.run("fetcher", String(d.id), JSON.stringify(d));
        const f = d.detail;
        db.prepare("INSERT OR REPLACE INTO entities VALUES('fetcher',?,?)").run(
          d.id,
          JSON.stringify({
            id: d.id,
            name: f.name,
            status: f.status === 64 ? "生效" : String(f.status),
            appId: f.appId,
            appKey: "AppID " + f.appId,
            owner: f.owners,
            description: f.description,
            timeout: f.timeout,
            updatedAt: new Date(f.modtime * 1000).toISOString(),
            sourceImported: true,
          }),
        );
      }
      for (const r of data.rules || []) {
        put.run("ruleDetail", String(r.id), JSON.stringify(r));
        const previous = db
          .prepare(
            "SELECT data FROM source_archives WHERE kind='rule' AND id=?",
          )
          .get(r.id) as any;
        const featureRows = (
          db
            .prepare("SELECT data FROM entities WHERE module='featureService'")
            .all() as any[]
        ).map((x) => JSON.parse(x.data));
        const tokens = referencedFeatureNames(r.logic);
        db.prepare("DELETE FROM source_feature_refs WHERE rule_id=?").run(r.id);
        for (const f of featureRows)
          if (tokens.has(f.enName))
            db.prepare(
              "INSERT OR IGNORE INTO source_feature_refs VALUES(?,?,?,?,?)",
            ).run(
              r.id,
              f.id,
              f.sourceId || f.id,
              f.sourceKind || "factor",
              f.enName,
            );
        const { references, ...definition } = r;
        const combined = {
          ...(previous ? JSON.parse(previous.data) : {}),
          ...definition,
        };
        delete combined.references;
        db.prepare(
          "INSERT OR REPLACE INTO source_archives(kind,id,version,data) VALUES('rule',?,'',?)",
        ).run(r.id, JSON.stringify(combined));
        if (
          !db
            .prepare("SELECT 1 FROM entities WHERE module='rulePage' AND id=?")
            .get(r.id)
        ) {
          const f = r.logic;
          db.prepare("INSERT INTO entities VALUES('rulePage',?,?)").run(
            r.id,
            JSON.stringify({
              id: r.id,
              name: f.alias,
              enName: f.name,
              expression: f.expression,
              status:
                ({ 64: "生效", 32: "标记", 0: "离线" } as any)[f.status] ||
                String(f.status),
              owner: f.modifier,
              sourceImported: true,
              sourceId: r.id,
              sourceSupplement: true,
            }),
          );
        }
      }
      for (const q of data.queries || []) {
        put.run(
          "logQuery",
          q.cvId,
          JSON.stringify({
            cvId: q.cvId,
            window: data.window,
            total: q.basic.length,
            detailTotal: q.details.length,
          }),
        );
        const details = new Map(q.details.map((d: any) => [d.requestId, d]));
        for (const b of q.basic)
          db.prepare(
            "INSERT OR REPLACE INTO source_request_logs VALUES(?,?,?,?,?)",
          ).run(
            b.requestId,
            q.cvId,
            b.logTime,
            JSON.stringify(b),
            details.has(b.requestId)
              ? JSON.stringify(details.get(b.requestId))
              : null,
          );
      }
      db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
        key,
        "v3:" + digest,
      );
    })();
  }
}
export function registerDetailRoutes(app: Express, db: Database.Database) {
  const obj = (kind: string, id: string) => {
    const r = db
      .prepare("SELECT data FROM source_detail_objects WHERE kind=? AND id=?")
      .get(kind, id) as any;
    return r ? JSON.parse(r.data) : undefined;
  };
  const entities = (module: string) =>
    (
      db
        .prepare("SELECT data FROM entities WHERE module=?")
        .all(module) as any[]
    ).map((r) => JSON.parse(r.data));
  app.get("/api/source/graph/:id/version/:version", (req, res) => {
    const r = obj("graphVersion", `${req.params.id}:${req.params.version}`);
    r
      ? res.json(r)
      : res.status(404).json({ error: "该历史版本未包含在当前快照" });
  });
  app.get("/api/source/rules/:id/metadata", (req, res) => {
    const configs = db
      .prepare("SELECT data FROM source_configs WHERE rule_id=?")
      .all(Number(req.params.id)) as any[];
    const tags = new Map();
    for (const c of configs)
      for (const t of JSON.parse(c.data).tags || []) tags.set(t.id, t);
    res.json({ tags: [...tags.values()] });
  });
  app.get("/api/source/detail-rule/:id", (req, res) => {
    const r = obj("ruleDetail", req.params.id) || {},
      type = String(req.query.type || "");
    if (!type) return res.json(r);
    const counts = Object.fromEntries(
      Object.entries(r.references || {}).map(([key, v]: any) => [
        key,
        v.sceneTotal ??
          v.graphSceneTotal ??
          v.rule_group_total ??
          v.canvas_total ??
          v.rule_total ??
          0,
      ]),
    );
    res.json({ references: { [type]: r.references?.[type] }, counts });
  });
  app.get("/api/source/fetchers", (req, res) =>
    res.json({
      items: (
        db
          .prepare(
            "SELECT data FROM source_detail_objects WHERE kind='fetcher'",
          )
          .all() as any[]
      ).map((r) => JSON.parse(r.data)),
    }),
  );
  app.get("/api/source/fetcher/:id", (req, res) => {
    const r = obj("fetcher", req.params.id);
    r ? res.json(r) : res.status(404).json({ error: "来源接口尚未导入" });
  });
  let featureIndex: any;
  const index = () => {
    if (featureIndex) return featureIndex;
    const rows = entities("featureService");
    const byName = new Map(rows.map((r) => [r.enName, r]));
    const deps = new Map<number, any[]>();
    for (const r of rows) {
      const text = String(r.expression || "") + " " + String(r.paramList || "");
      const names = new Set(text.match(/[A-Za-z_][\w]*/g) || []);
      deps.set(
        r.id,
        [...names].map((n) => byName.get(n)).filter((x) => x && x.id !== r.id),
      );
    }
    // Raw param lists and parsed dependencies are more complete than presentation fields.
    for (const a of db
      .prepare("SELECT id,data FROM source_archives WHERE kind='feature'")
      .all() as any[]) {
      const f = JSON.parse(a.data).detail || {};
      const names = new Set(
        (
          JSON.stringify([
            f.param_list,
            f.paramList,
            f.parsed_exp_info,
            f.parsedExpInfo,
            f.expression,
          ]) || ""
        ).match(/[A-Za-z_][\w]*/g) || [],
      );
      deps.set(
        a.id,
        [...names].map((n) => byName.get(n)).filter((x) => x && x.id !== a.id),
      );
    }
    return (featureIndex = { rows, byName, deps });
  };
  app.get("/api/source/features/catalog", (_req, res) =>
    res.json({
      items: index().rows.map((r: any) => ({
        id: r.id,
        enName: r.enName,
        name: r.name,
        type: r.type,
        sourceKind: r.sourceKind,
      })),
    }),
  );
  app.get("/api/source/features/:id/lineage", (req, res) => {
    const id = Number(req.params.id),
      { rows, deps } = index();
    const root = rows.find((r: any) => r.id === id);
    if (!root) return res.status(404).json({ error: "特征不存在" });
    const upstream = deps.get(id) || [];
    const downstream = rows.filter((r: any) =>
      (deps.get(r.id) || []).some((d: any) => d.id === id),
    );
    const rules = (
      db
        .prepare("SELECT rule_id FROM source_feature_refs WHERE feature_id=?")
        .all(id) as any[]
    )
      .map((r) => {
        const e = db
          .prepare("SELECT data FROM entities WHERE module='rulePage' AND id=?")
          .get(r.rule_id) as any;
        return e ? JSON.parse(e.data) : null;
      })
      .filter(Boolean);
    const a = db
      .prepare("SELECT data FROM source_archives WHERE kind='feature' AND id=?")
      .get(id) as any;
    let dependency: any;
    try {
      const f = JSON.parse(a.data).detail;
      dependency = obj(
        "dependency",
        String(JSON.parse(f.expression || "{}").dependencyId),
      );
    } catch {}
    const fetcher = dependency
      ? obj("fetcher", String(dependency.fetcherId)) || {
          id: dependency.fetcherId,
          detail: dependency.fetcher,
          params: [],
        }
      : undefined;
    const nodes: any[] = [
      {
        id: String(id),
        name: root.name,
        enName: root.enName,
        type: root.type,
        root: true,
      },
    ];
    const edges: any[] = [];
    const seen = new Set([id]);
    const walk = (current: number, depth: number) => {
      if (depth > 3) return;
      for (const d of deps.get(current) || []) {
        edges.push({ source: String(d.id), target: String(current) });
        if (!seen.has(d.id)) {
          seen.add(d.id);
          nodes.push({
            id: String(d.id),
            name: d.name,
            enName: d.enName,
            type: d.type,
          });
          walk(d.id, depth + 1);
        }
      }
    };
    walk(id, 0);
    for (const r of downstream) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        nodes.push({
          id: String(r.id),
          name: r.name,
          enName: r.enName,
          type: r.type,
          direction: "downstream",
        });
      }
      edges.push({ source: String(id), target: String(r.id) });
    }
    for (const r of rules) {
      nodes.push({
        id: "rule:" + r.id,
        name: r.name,
        enName: r.enName,
        type: "规则",
        direction: "downstream",
      });
      edges.push({ source: String(id), target: "rule:" + r.id });
    }

    res.json({
      root,
      upstream,
      downstream,
      rules,
      dependency,
      fetcher,
      nodes,
      edges,
      scope: "当前导入快照",
      maxDepth: 4,
    });
  });
  app.get("/api/source/logs", (req, res) => {
    const q = String(req.query.cvId || ""),
      rid = String(req.query.requestId || ""),
      scene = String(req.query.sceneId || "");
    let items = (
      db
        .prepare(
          "SELECT cv_id,log_time,basic,detail FROM source_request_logs ORDER BY log_time DESC",
        )
        .all() as any[]
    ).map((r) => {
      const b = JSON.parse(r.basic),
        d = r.detail ? JSON.parse(r.detail) : null;
      const decisions = (d?.decisions || []).map((v: any) => {
        let name = v.name;
        try {
          name = JSON.parse(v.name)
            .map((n: any) => n.name)
            .join("，");
        } catch {}
        return { id: v.id, name };
      });
      return {
        ...b,
        cvId: r.cv_id,
        hasDetail: !!d,
        takenEffectRuleList: d?.takenEffectRules || b.takenEffectRuleList,
        markedRuleList: d?.markedRules || b.markedRuleList,
        decisionList: decisions.length ? decisions : b.decisionList,
      };
    });
    if (q) items = items.filter((r) => q.split(/[,，\s]+/).includes(r.cvId));
    if (rid) items = items.filter((r) => r.requestId.includes(rid));
    if (scene)
      items = items.filter(
        (r) =>
          String(r.sceneInfo?.id) === scene ||
          (r.subSceneList || []).some((s: any) => String(s.id) === scene),
      );
    if (req.query.startTime)
      items = items.filter((r) => r.logTime >= Number(req.query.startTime));
    if (req.query.endTime)
      items = items.filter((r) => r.logTime <= Number(req.query.endTime));
    const queries = (
      db
        .prepare("SELECT data FROM source_detail_objects WHERE kind='logQuery'")
        .all() as any[]
    ).map((r) => JSON.parse(r.data));
    res.json({ items, total: items.length, queries });
  });
  app.get("/api/source/logs/:requestId", (req, res) => {
    const r = db
      .prepare("SELECT * FROM source_request_logs WHERE request_id=?")
      .get(req.params.requestId) as any;
    if (!r) return res.status(404).json({ error: "请求不在当前日志快照中" });
    res.json({
      cvId: r.cv_id,
      basic: JSON.parse(r.basic),
      detail: r.detail ? JSON.parse(r.detail) : null,
    });
  });
}
