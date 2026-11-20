import {
  expressionFeatureNames,
  typedFeatureReferences,
} from "./feature-refs.ts";
import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
export const sourceStatus = (value: unknown) =>
  (
    ({
      0: "离线",
      32: "标记",
      64: "生效",
      "-1": "未就绪",
      2: "就绪",
    }) as Record<number, string>
  )[Number(value)] || String(value ?? "—");
export function initializeSourceSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS source_archives(kind TEXT,id INTEGER,version TEXT DEFAULT '',data TEXT NOT NULL,PRIMARY KEY(kind,id,version));
CREATE TABLE IF NOT EXISTS source_configs(id TEXT PRIMARY KEY,scene_module TEXT NOT NULL,scene_id INTEGER NOT NULL,rule_id INTEGER,group_id INTEGER,node_id TEXT,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS source_configs_parent ON source_configs(scene_module,scene_id,node_id);
CREATE INDEX IF NOT EXISTS source_configs_rule ON source_configs(rule_id);
CREATE TABLE IF NOT EXISTS source_feature_refs(rule_id INTEGER,feature_id INTEGER,source_id INTEGER,kind TEXT,name TEXT,PRIMARY KEY(rule_id,feature_id));`);
}
export function importSourceSnapshot(
  db: Database.Database,
  snapshot: any,
  digest = "manual",
  options: { additive?: boolean; preserveLocal?: boolean } = {},
) {
  initializeSourceSchema(db);
  const entity = db.prepare(
    "INSERT OR REPLACE INTO entities(module,id,data) VALUES(?,?,?)",
  );
  const archive = db.prepare(
    "INSERT OR REPLACE INTO source_archives(kind,id,version,data) VALUES(?,?,?,?)",
  );
  const config = db.prepare(
    "INSERT OR REPLACE INTO source_configs VALUES(?,?,?,?,?,?,?)",
  );
  const featureRef = db.prepare(
    "INSERT OR IGNORE INTO source_feature_refs VALUES(?,?,?,?,?)",
  );
  const captured = snapshot.capturedAt;
  const protectionRecords = options.preserveLocal
    ? (db
        .prepare(
          "SELECT module,entity_id,MAX(updated_at) AS updated_at FROM audit WHERE action IN ('修改','删除') GROUP BY module,entity_id",
        )
        .all() as any[])
    : [];
  const protectionDates = new Map<string, number>(
    protectionRecords.map((r) => [
      r.module + ":" + r.entity_id,
      Date.parse(
        String(r.updated_at).replace(" ", "T") +
          (String(r.updated_at).endsWith("Z") ? "" : "Z"),
      ),
    ]),
  );
  const protectedRows = new Set(protectionDates.keys());
  // A locally deleted demo ID can later be allocated to a new source object.
  // An edit made before that source object existed must not suppress its import.
  const allowNewSource = (module: string, id: number, added: any) => {
    const stamp = Number(added),
      audit = protectionDates.get(module + ":" + id);
    if (
      Number.isFinite(stamp) &&
      stamp > 0 &&
      audit !== undefined &&
      (stamp < 1e12 ? stamp * 1000 : stamp) > audit
    )
      protectedRows.delete(module + ":" + id);
  };
  const protectedRules: number[] = [];
  const protectedFeatures: number[] = [];

  const iso = (v: any) =>
    typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : v;
  const put = (module: string, id: number, data: any) =>
    !protectedRows.has(module + ":" + id) &&
    entity.run(
      module,
      id,
      JSON.stringify({
        ...data,
        id,
        sourceImported: true,
        sourceId: data.sourceId ?? id,
        capturedAt: captured,
      }),
    );
  const raw = (kind: string, id: number, data: any, version = "") =>
    archive.run(kind, id, String(version), JSON.stringify(data));
  const bindings = (
    module: string,
    id: number,
    items: any[],
    node = "",
    group = 0,
  ) => {
    for (const [index, c] of items.entries()) {
      const rid = c.ruleId;
      if (!rid) continue;
      const gid = c.ruleGroupId || group || 0;
      const key = [
        module,
        id,
        node,
        c.confId ?? c.id ?? index,
        gid,
        index,
      ].join(":");
      const normalized = {
        ...c,
        id: key,
        sourceConfId: c.confId ?? c.id,
        rule_id: rid,
        ruleId: rid,
        groupId: gid,
        ruleGroupId: gid,
        nodeId: node || c.nodeId || "",
        name: c.ruleAlias || c.ruleName,
        decision: c.decisionName || String(c.decisionId ?? ""),
        status: sourceStatus(c.status),
        sourceStatus: c.status,
        extraInfo: c.extraInfoName,
        reason: c.reasonName,
        priority: c.priority ?? 1,
        updatedAt: iso(c.modtime ?? c.modTime),
      };
      config.run(
        key,
        module,
        id,
        rid,
        gid,
        node || String(c.nodeId || ""),
        JSON.stringify(normalized),
      );
    }
  };
  db.transaction(() => {
    // Replace only previous captured examples; user-created demo rows remain intact.
    if (!options.additive) {
      db.prepare("DELETE FROM source_configs").run();
      db.prepare("DELETE FROM source_feature_refs").run();
    }
    for (const entry of snapshot.scenes || []) {
      const s = entry.scene;
      put("scene", s.id, {
        name: s.name,
        owner: s.owners || s.manager || s.modifier,
        type:
          ({ 0: "实时计算", 1: "离线计算", 2: "近线计算" } as any)[
            s.calculateType
          ] || "实时计算",
        description: s.remark,
        status: sourceStatus(s.status ?? 64),
        updatedAt: iso(s.modtime),
        configCount: entry.configs.length,
        groupCount: new Set(
          entry.configs.map((c: any) => c.ruleGroupId).filter(Boolean),
        ).size,
      });
      raw("scene", s.id, entry);
      bindings("scene", s.id, entry.configs);
    }
    for (const entry of snapshot.groups || []) {
      const g = entry.group;
      put("rulesGroup", g.id, {
        name: g.name,
        owner: g.manager || g.modifier,
        status: sourceStatus(g.status ?? 64),
        description: g.remark,
        updatedAt: iso(g.modtime),
        createdAt: iso(g.addtime),
        configCount: entry.configs.length,
        type: g.type,
      });
      raw("group", g.id, entry);
      bindings("rulesGroup", g.id, entry.configs, "", g.id);
    }
    const featureNames = new Map<string, any>();
    const featureIds = new Map<string, number>();
    const featureEntityNames = new Map<number, string>();
    if (options.additive)
      for (const row of db
        .prepare("SELECT data FROM entities WHERE module='featureService'")
        .all() as any[]) {
        const f = JSON.parse(row.data);
        featureIds.set(
          (f.sourceKind || "factor") + ":" + (f.sourceId || f.id),
          f.id,
        );
        featureEntityNames.set(f.id, f.enName);
        if (f.enName)
          featureNames.set(f.enName, {
            entityId: f.id,
            id: f.sourceId || f.id,
            kind: f.sourceKind || "factor",
          });
      }
    for (const f of [
      ...(snapshot.features || []),
      ...(snapshot.missingFeatures || []),
    ]) {
      const d = f.detail;
      const param = f.kind === "param";
      const id = param ? 1000000000 + Number(f.id) : Number(f.id);
      allowNewSource("featureService", id, d.addtime);
      if (protectedRows.has("featureService:" + id)) protectedFeatures.push(id);
      const name = d.name || f.reference?.value || "";
      for (const alias of [name, ...(f.referenceNames || [])])
        if (f.available !== false || !featureNames.has(alias))
          featureNames.set(alias, { ...f, entityId: id });
      featureIds.set(f.kind + ":" + f.id, id);
      featureEntityNames.set(id, name);
      put("featureService", id, {
        sourceId: f.id,
        sourceKind: f.kind,
        name: d.alias || name,
        enName: name,
        type: param
          ? "参数"
          : (
              {
                0: "基础因子",
                1: "衍生因子",
                2: "累计因子",
                3: "扩展因子",
                4: "决策表因子",
                5: "工具因子",
                6: "离线引擎-个体因子",
                7: "离线引擎-全局因子",
                8: "内存名单-CEP",
                9: "黑白模板因子",
                11: "离线因子",
                10: "模型因子",
              } as any
            )[d.type] || (d.type == null ? "衍生因子" : "类型 " + d.type),
        status:
          f.available === false
            ? f.availability === "not-in-catalog"
              ? "来源未收录"
              : "来源不存在"
            : sourceStatus(d.status ?? 64),
        dataType:
          (
            {
              0: "Boolean",
              1: "Integer",
              2: "Long",
              3: "Float",
              4: "Double",
              5: "String",
              6: "List",
              7: "Map",
              8: "Map",
            } as any
          )[d.resultType ?? d.result_type] ||
          String(d.resultType ?? d.result_type ?? ""),
        expression: d.originExpression || d.origin_expression || d.expression,
        owner: d.modifier || d.creator,
        description: d.description,
        updatedAt: iso(d.modtime),
        createdAt: iso(d.addtime),
        view: "特征集市",
      });
      if (!protectedRows.has("featureService:" + id)) raw("feature", id, f);
    }
    for (const r of snapshot.rules || []) {
      allowNewSource(
        "rulePage",
        r.id,
        r.logic?.addtime || r.catalogInfo?.addtime,
      );
      if (protectedRows.has("rulePage:" + r.id)) {
        protectedRules.push(r.id);
        continue;
      }
      if (options.additive)
        db.prepare("DELETE FROM source_feature_refs WHERE rule_id=?").run(r.id);
      const logic = r.logic || r.detail?.basicInfo?.rule || {};
      const refs = new Set<string>();
      for (const key of ["factorNameList", "paramNameList"]) {
        let vals = logic[key] || [];
        if (typeof vals === "string") vals = vals.split(",");
        for (const n of vals) refs.add(n);
      }
      try {
        const p =
          typeof logic.parsedExpInfo === "string"
            ? JSON.parse(logic.parsedExpInfo)
            : logic.parsedExpInfo;
        for (const n of p?.dependentEleNames || []) refs.add(n);
      } catch {}
      let ruleConditions = logic.ruleConditions || [];
      if (typeof ruleConditions === "string") {
        try {
          ruleConditions = JSON.parse(ruleConditions);
        } catch {
          ruleConditions = [];
        }
      }
      const fields = Array.isArray(ruleConditions) ? ruleConditions : [];
      for (const c of fields)
        for (const key of ["leftParamValue", "rightParamValue"]) {
          try {
            const parsed = JSON.parse(c[key]);
            const scan = (x: any) => {
              if (!x || typeof x !== "object") return;
              if (
                x.value &&
                typeof x.value === "string" &&
                featureNames.has(x.value)
              )
                refs.add(x.value);
              Object.values(x).forEach((v) => {
                if (Array.isArray(v)) v.forEach(scan);
                else scan(v);
              });
            };
            scan(parsed);
          } catch {}
        }
      for (const name of expressionFeatureNames(
        logic.originExpression || logic.expression,
      ))
        if (featureNames.has(name)) refs.add(name);
      let directFactorIds = logic.factorIdList || [];
      if (typeof directFactorIds === "string")
        directFactorIds = directFactorIds.split(",");
      for (const sourceId of directFactorIds) {
        const id = featureIds.get("factor:" + sourceId);
        if (id !== undefined)
          featureRef.run(
            r.id,
            id,
            Number(sourceId),
            "factor",
            featureEntityNames.get(id),
          );
      }
      const typed = typedFeatureReferences(logic);
      for (const [name, ids] of typed)
        for (const id of ids)
          if (featureEntityNames.get(id) === name)
            featureRef.run(
              r.id,
              id,
              id % 1000000000,
              id >= 1000000000 ? "param" : "factor",
              name,
            );
      for (const name of refs) {
        if (
          [...(typed.get(name) || [])].some(
            (id) => featureEntityNames.get(id) === name,
          )
        )
          continue;
        const f = featureNames.get(name);
        if (f) featureRef.run(r.id, f.entityId, f.id, f.kind, name);
      }
      put("rulePage", r.id, {
        name: logic.alias || logic.name,
        enName: logic.name,
        status: sourceStatus(logic.status),
        expression: logic.originExpression || logic.expression,
        interactiveExpression: logic.expression,
        editMode: logic.editMode,
        owner: logic.modifier || logic.creator,
        description: logic.ruleRemark,
        version: logic.versionId || r.detail?.basicInfo?.rule?.versionId,
        updatedAt: iso(logic.modtime),
        createdAt: iso(logic.addtime),
        featureCount: (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM source_feature_refs WHERE rule_id=?",
            )
            .get(r.id) as any
        ).n,
        ...(r.catalogInfo
          ? {
              refCount: r.catalogInfo.refCount,
              tags: [
                ...new Set(
                  [
                    "tagInfo",
                    "riskTagInfo",
                    "factTagInfo",
                    "typeTagInfo",
                    "customTagInfo",
                  ].flatMap((key) => Object.values(r.catalogInfo[key] || {})),
                ),
              ],
            }
          : {}),
      });
      const prior = options.additive
        ? (db
            .prepare(
              "SELECT data FROM source_archives WHERE kind='rule' AND id=? AND version=''",
            )
            .get(r.id) as any)
        : undefined;
      const old = prior ? JSON.parse(prior.data) : {};
      raw("rule", r.id, {
        ...old,
        ...r,
        ...(r.catalogInfo && (old.detail || r.detail)
          ? {
              detail: {
                ...old.detail,
                ...r.detail,
                basicInfo: {
                  ...old.detail?.basicInfo,
                  ...r.detail?.basicInfo,
                  rule: logic,
                },
              },
            }
          : {}),
      });
    }
    const walkGraph = (
      module: string,
      id: number,
      nodes: any[],
      prefix = "",
    ) => {
      for (const n of nodes || []) {
        const path = prefix ? prefix + "-" + n.id : String(n.id),
          d = n.data || {};
        bindings(module, id, d.ruleConfs || [], path);
        for (const group of d.ruleGroups || [])
          bindings(module, id, group.ruleConfs || [], path, group.ruleGroupId);
        if (d.template) walkGraph(module, id, d.template.nodes, path);
      }
    };
    for (const entry of snapshot.graphs || []) {
      const g = entry.graph;
      put("layerScene", g.id, {
        name: g.name,
        owner: g.manager || g.modifier,
        status: sourceStatus(g.status ?? 64),
        version: "v" + g.version,
        description: g.remark,
        createdAt: iso(g.addtime),
        updatedAt: iso(g.modtime),
        nodeCount: g.nodes?.length,
        view: "场景列表",
      });
      raw("graph", g.id, entry);
      walkGraph("layerScene", g.id, g.nodes);
    }
    for (const entry of snapshot.templates || []) {
      const g = entry.graph || entry;
      put("layerScene", g.id, {
        name: g.name || "模板 " + g.id,
        owner: g.manager || g.modifier,
        version: "v" + g.version,
        description: g.remark,
        status: sourceStatus(g.status ?? 64),
        view: "模版列表",
        sourceKind: "template",
      });
      raw("template", g.id, entry);
      walkGraph("graphTemplate", g.id, g.nodes || []);
    }
    for (const t of snapshot.tags || []) {
      put("tag", t.id, {
        name: t.name,
        type: "风险标签",
        view: "风险标签",
        parentId: t.parentId,
        tagCode: t.tagCode,
        priority: t.priority,
        description: t.description,
        owner: t.modifier,
        updatedAt: iso(t.modtime),
        status: sourceStatus(t.status),
      });
      raw("tag", t.id, t);
    }
    const releaseStatus: Record<number, string> = {
      "-1": "草稿",
      0: "待启动",
      3: "运行中",
      4: "实验已完成",
      5: "实验已中止",
      7: "待审批",
      8: "审批通过",
      9: "发布完成",
      10: "已撤回",
      13: "审批驳回",
      18: "灰度发布中",
      19: "已中止",
      20: "异常中止",
      59: "已回滚",
      57: "回滚失败",
    };
    for (const r of snapshot.releases || []) {
      const b = r.basic;
      put("release/list", b.id, {
        name: b.name,
        owner: b.modifier || b.creator,
        status: releaseStatus[b.status] || String(b.status),
        sourceStatus: b.status,
        type: b.deployMode === 0 ? "紧急变更" : "普通变更",
        phase:
          b.status === 9
            ? "完成"
            : b.status === 18
              ? "灰度"
              : b.status === 7
                ? "审批"
                : "实验",
        progress: b.status === 9 ? 100 : r.gray?.progress?.scale || 0,
        createdAt: iso(b.startDeployTime || b.addTime),
        updatedAt: iso(b.updateTime),
        endedAt: iso(b.endDeployTime),
        description: b.deployDesc,
        changeSummary: r.summary?.changeSummary,
        affectedSummary: r.summary?.affectedSummary,
      });
      raw("release", b.id, r);
    }
    for (const d of snapshot.decisions || []) {
      put("decisionList", d.id, {
        name: d.name || d.alias,
        type: d.type,
        priority: d.priority,
        status: sourceStatus(d.status ?? 64),
        description: d.remark,
      });
      raw("decision", d.id, d);
    }
    const report = {
      capturedAt: captured,
      sourceTotal: snapshot.sourceTotal,
      featureScope: snapshot.featureScope,
      featureCatalogCounts: snapshot.featureCatalogCounts,
      featuresExpandedAt: snapshot.featuresExpandedAt,
      interfacesCapturedAt: snapshot.interfacesCapturedAt,
      indexedRuleCount: snapshot.indexedRuleCount,
      protectedRules,
      protectedFeatures,
      detailCounts: {
        dependencies: snapshot.dependencies?.length || 0,
        fetchers: snapshot.fetchers?.length || 0,
      },
      unavailableInterfaces: snapshot.unavailableInterfaces || [],
      missingRuleDefinitions: snapshot.missingRuleDefinitions || [],
      missingTypedFeatures: snapshot.missingTypedFeatures || [],
      selection: snapshot.selection,
      counts: Object.fromEntries(
        [
          "scenes",
          "graphs",
          "groups",
          "rules",
          "features",
          "tags",
          "releases",
          "templates",
          "decisions",
        ].map((k) => [k, (snapshot[k] || []).length]),
      ),
      errors: snapshot.errors || [],
      sourceCountMismatches: snapshot.sourceCountMismatches || [],
      missingFeatures:
        snapshot.missingFeatures?.map((f: any) => ({
          id: f.id,
          name: f.detail.name,
          reason: f.detail.reason,
        })) || [],
      unresolvedFeatureNames: snapshot.unresolvedFeatureNames || [],
    };
    db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
      options.additive ? "full-catalog-report" : "source-import-report",
      JSON.stringify(report),
    );
    db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
      options.additive ? "full-catalog-digest" : "source-import-digest",
      JSON.stringify(digest),
    );
  })();
}
export function readSourceFixture() {
  const manifestPath = resolve("fixtures/zeus-examples-manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let bytes: Buffer;
  if (manifest.parts?.length) {
    bytes = Buffer.concat(
      manifest.parts.map((part: any) => {
        const file = readFileSync(resolve("fixtures", part.path));
        if (
          file.length !== part.size ||
          createHash("sha256").update(file).digest("hex") !== part.sha256
        )
          throw Error("示例数据分片校验失败：" + part.path);
        return file;
      }),
    );
  } else bytes = readFileSync(resolve("fixtures/zeus-examples.json.gz"));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256)
    throw Error("示例数据包摘要校验失败");
  return bytes;
}
export function syncSourceFixture(db: Database.Database) {
  initializeSourceSchema(db);
  const bytes = readSourceFixture();
  if (!bytes) return;
  const digest = "v2:" + createHash("sha256").update(bytes).digest("hex");
  const row = db
    .prepare("SELECT value FROM settings WHERE key=?")
    .get("source-import-digest") as any;
  if (row && JSON.parse(row.value) === digest) return;
  importSourceSnapshot(db, JSON.parse(gunzipSync(bytes).toString()), digest);
}

/** Repair existing checkouts without reimporting scenes or overwriting local rule edits. */
export function reconcileTypedReferences(db: Database.Database) {
  const marker = "typed-rule-feature-refs:v1";
  const version = (
    db
      .prepare("SELECT value FROM settings WHERE key='full-catalog-digest'")
      .get() as any
  )?.value;
  if (
    !version ||
    (db.prepare("SELECT value FROM settings WHERE key=?").get(marker) as any)
      ?.value === version
  )
    return;
  const names = new Map<number, string>(
    (
      db
        .prepare(
          "SELECT id,json_extract(data,'$.enName') AS name FROM entities WHERE module='featureService'",
        )
        .all() as any[]
    ).map((r) => [r.id, r.name]),
  );
  const edited = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT entity_id FROM audit WHERE module='rulePage' AND action IN ('修改','删除','回滚')",
        )
        .all() as any[]
    ).map((r) => r.entity_id),
  );
  const rows = db.prepare(
    "SELECT id,json_extract(data,'$.logic.ruleConditions') AS ruleConditions,json_extract(data,'$.logic.factorIdList') AS factorIds FROM source_archives WHERE kind='rule' AND version=''",
  );
  const existing = db.prepare(
    "SELECT feature_id FROM source_feature_refs WHERE rule_id=? AND name=?",
  );
  const remove = db.prepare(
    "DELETE FROM source_feature_refs WHERE rule_id=? AND feature_id=?",
  );
  const put = db.prepare(
    "INSERT OR IGNORE INTO source_feature_refs VALUES(?,?,?,?,?)",
  );
  const count = db.prepare(
    "UPDATE entities SET data=json_set(data,'$.featureCount',(SELECT COUNT(*) FROM source_feature_refs WHERE rule_id=?)) WHERE module='rulePage' AND id=?",
  );
  db.transaction(() => {
    // Do not write while stepping a live SQLite cursor on the same connection.
    const rules = rows.all() as any[];
    for (const r of rules) {
      if (edited.has(r.id)) continue;
      const direct = new Set(
        String(r.factorIds || "")
          .replace(/[\[\]]/g, "")
          .split(",")
          .map(Number),
      );
      let changed = false;
      for (const [name, ids] of typedFeatureReferences(r)) {
        const valid = [...ids].filter((id) => names.get(id) === name);
        if (!valid.length) continue;
        const before = (existing.all(r.id, name) as any[]).map(
          (v) => v.feature_id,
        );
        for (const old of before)
          if (!ids.has(old) && !direct.has(old)) {
            remove.run(r.id, old);
            changed = true;
          }
        for (const id of valid)
          if (!before.includes(id)) {
            put.run(
              r.id,
              id,
              id % 1000000000,
              id >= 1000000000 ? "param" : "factor",
              name,
            );
            changed = true;
          }
      }
      if (changed) count.run(r.id, r.id);
    }
    db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
      marker,
      version,
    );
  })();
}
