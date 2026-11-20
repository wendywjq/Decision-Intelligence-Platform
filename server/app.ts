import { registerFeatureConfig } from "./feature-config.ts";
import { canSyncSource, registerSourceSync } from "./source-sync.ts";
import { resourceLookup, registerRuleResources } from "./rule-resources.ts";
import { runAviator } from "./aviator.ts";
import { executableRule, evaluateWithCatalog } from "./evaluate-rule.ts";
import { registerReleaseWorkflow } from "./release-workflow.ts";
import { registerExperimentConfig } from "./experiment-config.ts";
import { randomUUID } from "node:crypto";
import { strategyChanges } from "./strategy-changes.ts";
import { expandedRiskTags, riskIdsForRule } from "./risk-filter.ts";
import { evaluateRuleExpression } from "../src/rule-logic.ts";
import { assertRuleMutable, isEffective, ruleStats } from "./rule-policy.ts";
import { expressionFeatureNames } from "./feature-refs.ts";
import { groupRules, GroupRuleError } from "./group-rules.ts";
import { listCatalogEntities } from "./catalog-list.ts";
import { registerDetailRoutes } from "./source-details.ts";
import express from "express";
import type Database from "better-sqlite3";
import { moduleMap } from "../src/catalog.ts";
import { z } from "zod";
const bodySchema = z
  .object({ name: z.string().trim().min(1).max(200) })
  .passthrough();
export function createApp(db: Database.Database) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerRuleResources(app, db);
  registerSourceSync(app, db);
  app.post("/api/feature-logic/test", (req, res) => {
    try {
      const { expression, input } = req.body;
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw Error("请输入 JSON 对象");
      return res.json({ value: runAviator(expression, input) });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });
  const get = (module: string, id: number) => {
    const r = db
      .prepare("SELECT data FROM entities WHERE module=? AND id=?")
      .get(module, id) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  };
  const evaluateExpression = (
    expression: string,
    input: Record<string, unknown>,
  ) =>
    evaluateWithCatalog(
      expression,
      input,
      (id) => executableRule(db, get("rulePage", id)),
      [],
      resourceLookup(db),
    );
  const audit = (m: string, id: number, name: string, action: string) =>
    db
      .prepare(
        "INSERT INTO audit(module,entity_id,name,action,owner) VALUES(?,?,?,?,?)",
      )
      .run(m, id, name, action, "demo");
  const save = (m: string, id: number, data: any, action: string) =>
    db.transaction(() => {
      const old = get(m, id);
      if (old)
        db.prepare(
          "INSERT INTO versions(module,entity_id,data) VALUES(?,?,?)",
        ).run(m, id, JSON.stringify(old));
      const next = {
        ...old,
        ...data,
        id,
        updatedAt: new Date().toISOString(),
        modifier: "demo",
        createdAt: old?.createdAt || new Date().toISOString(),
      };
      db.prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)").run(
        m,
        id,
        JSON.stringify(next),
      );
      if (
        m === "rulePage" &&
        (!old ||
          next.expression !== old.expression ||
          JSON.stringify(next.ruleConditions) !==
            JSON.stringify(old.ruleConditions))
      ) {
        const names = [...expressionFeatureNames(next.expression)];
        const selected = new Map<string, Set<number>>();
        for (const c of next.ruleConditions || []) {
          const f =
            Number.isInteger(c.featureId) && get("featureService", c.featureId);
          if (f && f.enName === c.feature) {
            const ids = selected.get(c.feature) || new Set<number>();
            ids.add(f.id);
            selected.set(c.feature, ids);
          }
        }
        db.prepare("DELETE FROM source_feature_refs WHERE rule_id=?").run(id);
        if (names.length)
          for (const f of db
            .prepare(
              "SELECT id,data FROM entities WHERE module='featureService' AND json_extract(data,'$.enName') IN (" +
                names.map(() => "?").join(",") +
                ")",
            )
            .all(...names) as any[]) {
            const d = JSON.parse(f.data);
            if (selected.has(d.enName) && !selected.get(d.enName)!.has(f.id))
              continue;
            db.prepare(
              "INSERT OR IGNORE INTO source_feature_refs VALUES(?,?,?,?,?)",
            ).run(
              id,
              f.id,
              d.sourceId || f.id,
              d.sourceKind || "factor",
              d.enName,
            );
          }
      }
      if (m === "rulePage") {
        const a = db
          .prepare(
            "SELECT data FROM source_archives WHERE kind='rule' AND id=? AND version='' ",
          )
          .get(id) as any;
        if (a) {
          const raw = JSON.parse(a.data);
          raw.logic = {
            ...raw.logic,
            alias: next.name,
            name: next.enName || raw.logic?.name,
          };
          if (
            data.expression !== undefined &&
            data.expression !== old?.expression
          ) {
            raw.logic.expression = next.expression;
            raw.logic.originExpression = next.expression;
            raw.logic.ruleConditions = [];
            raw.logic.editMode = 2;
          }
          if (data.riskTags)
            raw.catalogInfo = {
              ...raw.catalogInfo,
              riskTagInfo: Object.fromEntries(
                data.riskTags.map((v: any) => {
                  const tid = Number(typeof v === "object" ? v.id : v);
                  return [tid, get("tag", tid)?.name || String(tid)];
                }),
              ),
            };
          db.prepare(
            "UPDATE source_archives SET data=? WHERE kind='rule' AND id=? AND version='' ",
          ).run(JSON.stringify(raw), id);
        }
      }
      audit(m, id, next.name, action);
      return next;
    })();
  const groups = groupRules(db);
  const changes = strategyChanges(db, groups, save);
  app.use("/api", changes.middleware);
  app.get("/api/changes/:id/context", (req, res) => {
    const task = changes.task(Number(req.params.id));
    res.json({
      ...task,
      isEditable:
        task.phase === "实验" &&
        !["已中止", "已回滚", "已完成"].includes(task.status),
    });
  });
  app.post("/api/changes/:id/items", (req, res) =>
    res.json(changes.stage(Number(req.params.id), req.body)),
  );
  app.delete("/api/changes/:id/items/:key", (req, res) =>
    res.json(changes.remove(Number(req.params.id), req.params.key)),
  );
  app.post("/api/changes/:id/urgent", (req, res) => {
    const task = changes.task(Number(req.params.id));
    if (
      task.sourceImported ||
      task.phase !== "实验" ||
      ["已中止", "已完成", "已回滚"].includes(task.status) ||
      !task.localChanges?.length
    )
      return res.status(409).json({ error: "请先在可编辑任务中保存变更" });
    if (!String(req.body.reason || "").trim())
      return res.status(400).json({ error: "请填写紧急变更原因" });
    res.json(
      save(
        "release/list",
        task.id,
        {
          ...task,
          type: "紧急变更",
          deployMode: 0,
          urgentReason: req.body.reason,
          phase: "审批",
          status: "待审批",
        },
        "紧急变更",
      ),
    );
  });
  app.get("/api/policy-configs", (req, res) => {
    const clauses = [
        "c.scene_module IN ('scene','layerScene','routerSceneList')",
      ],
      values: any[] = [];
    if (req.query.sceneId) {
      clauses.push("c.scene_id=?");
      values.push(Number(req.query.sceneId));
    }
    if (req.query.q) {
      clauses.push(
        "instr(lower(CAST(c.rule_id AS TEXT)||' '||COALESCE(json_extract(e.data,'$.name'),'')),lower(?))>0",
      );
      values.push(String(req.query.q));
    }
    const rows = db
      .prepare(
        "SELECT c.* FROM source_configs c LEFT JOIN entities e ON e.module='rulePage' AND e.id=c.rule_id WHERE " +
          clauses.join(" AND ") +
          " LIMIT 100",
      )
      .all(...values) as any[];
    const items = rows.map((r) => ({
      ...JSON.parse(r.data),
      id: r.id,
      ruleId: r.rule_id,
      ruleName: get("rulePage", r.rule_id)?.name,
      sceneName: get(r.scene_module, r.scene_id)?.name,
      scope: { module: r.scene_module, sceneId: r.scene_id, nodeId: r.node_id },
    }));
    for (const r of db
      .prepare(
        "SELECT * FROM scene_rules WHERE scene_module!='rulesGroup' LIMIT 30",
      )
      .all() as any[])
      if (
        (!req.query.sceneId || Number(req.query.sceneId) === r.scene_id) &&
        (!req.query.q ||
          String(r.rule_id).includes(String(req.query.q)) ||
          (get("rulePage", r.rule_id)?.name || "").includes(
            String(req.query.q),
          ))
      )
        items.push({
          ...r,
          id: "legacy:" + r.id,
          ruleId: r.rule_id,
          ruleName: get("rulePage", r.rule_id)?.name,
          sceneName: get(r.scene_module, r.scene_id)?.name,
          scope: { module: r.scene_module, sceneId: r.scene_id, nodeId: "" },
        });
    res.json({ items });
  });
  app.get("/api/rules/:id/stats", (req, res) =>
    res.json(ruleStats(db, Number(req.params.id))),
  );
  app.post("/api/groups/:id/rules/batch", (req, res) => {
    if (!Array.isArray(req.body.ids) || !req.body.ids.length)
      return res.status(400).json({ error: "请选择规则配置" });
    const result = db.transaction(() =>
      req.body.ids.map((id: string) =>
        groups.update(
          Number(req.params.id),
          id,
          req.body.patch || {},
          req.body.action === "删除",
        ),
      ),
    )();
    res.json({ ok: true, items: result });
  });
  app.get("/api/groups/:id/rules", (req, res) =>
    res.json({
      items: groups.list(Number(req.params.id)),
      mounts: groups.mounts(Number(req.params.id)),
    }),
  );
  app.post("/api/groups/:id/rules", (req, res) =>
    res.status(201).json(groups.add(Number(req.params.id), req.body)),
  );
  app.put("/api/groups/:id/rules/:configId", (req, res) =>
    res.json(
      groups.update(Number(req.params.id), req.params.configId, req.body),
    ),
  );
  app.delete("/api/groups/:id/rules/:configId", (req, res) =>
    res.json(
      groups.update(Number(req.params.id), req.params.configId, {}, true),
    ),
  );
  app.post("/api/groups/:id/create-rule", (req, res) => {
    const parsed = bodySchema.safeParse(req.body.rule);
    if (!parsed.success)
      return res.status(400).json({ error: "请填写规则名称" });
    const result = db.transaction(() => {
      const id = Number(
        (
          db
            .prepare(
              "SELECT COALESCE(MAX(id),10000)+1 AS id FROM entities WHERE module='rulePage'",
            )
            .get() as any
        ).id,
      );
      const rule = save(
        "rulePage",
        id,
        { ...parsed.data, status: "就绪" },
        "新建",
      );
      const config = groups.add(Number(req.params.id), {
        ...req.body.config,
        ruleId: id,
      });
      return { rule, config };
    })();
    res.status(201).json(result.rule);
  });
  registerFeatureConfig(app, db, save);
  registerDetailRoutes(app, db);
  const experiments = registerExperimentConfig(app, db, save);
  registerReleaseWorkflow(app, db, {
    save,
    changes,
    groups,
    experimentContext: experiments.context,
  });
  app.get("/api/references/rule/:id", (req, res) => {
    const ruleId = Number(req.params.id);
    const legacy = (
      db
        .prepare("SELECT * FROM scene_rules WHERE rule_id=?")
        .all(ruleId) as any[]
    ).map((r) => ({ ...r, id: "legacy:" + r.id }));
    const source = (
      db
        .prepare("SELECT * FROM source_configs WHERE rule_id=?")
        .all(ruleId) as any[]
    ).map((r) => ({ ...r, ...JSON.parse(r.data) }));
    res.json({
      items: [...legacy, ...source].map((r) => ({
        ...r,
        name:
          get(
            r.scene_module === "graphTemplate" ? "layerScene" : r.scene_module,
            r.scene_id,
          )?.name || "—",
      })),
    });
  });
  app.get("/api/relations", (req, res) => {
    const id = Number(req.query.id);
    res.json({
      items: (
        db
          .prepare("SELECT * FROM scene_rules WHERE scene_id=? OR rule_id=?")
          .all(id, id) as any[]
      ).map((r) => ({
        ...r,
        name: get(r.scene_module, r.scene_id)?.name || "—",
      })),
    });
  });
  const requestRows = () =>
    (
      db.prepare("SELECT data FROM request_logs").all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  app.get("/api/requests", (req, res) => {
    const q = String(req.query.q || "");
    res.json({
      items: requestRows().filter((r) => JSON.stringify(r).includes(q)),
    });
  });
  app.post("/api/probe", (req, res) => {
    const r = requestRows().find((r) => r.requestId === req.body.requestId);
    if (!r)
      return res
        .status(404)
        .json({ error: "本地没有该RequestId，可使用 demo-request-001" });
    if (
      Number(req.body.sceneId) !== r.sceneId ||
      Number(req.body.ruleId) !== r.ruleId
    )
      return res.status(404).json({ error: "请求与场景或规则不匹配" });
    const rule = get("rulePage", r.ruleId);
    if (!rule) return res.status(404).json({ error: "示例规则已删除" });
    res.json({
      summary: "基于本地示例请求重新计算",
      requestId: r.requestId,
      expression: rule.expression,
      input: r.input,
      hit: evaluateExpression(executableRule(db, rule).expression, r.input),
    });
  });
  app.get("/api/cumulative", (req, res) => {
    if (req.query.factor !== "requestCount")
      return res.status(404).json({ error: "累计因子不存在" });
    const key = String(req.query.key || "demo");
    const row = db
      .prepare(
        "SELECT factor,subject_key AS key,value,window FROM cumulative_values WHERE factor=? AND subject_key=?",
      )
      .get("requestCount", key);
    if (!row)
      return res
        .status(404)
        .json({ error: "未找到该主体的累计值，示例主体为 demo" });
    res.json(row);
  });
  const updateSourceConfig = (id: string, body: any, remove = false) => {
    const row = db
      .prepare("SELECT * FROM source_configs WHERE id=?")
      .get(id) as any;
    if (!row) throw new GroupRuleError(404, "配置不存在");
    if (row.scene_module === "rulesGroup")
      return groups.update(row.scene_id, id, body, remove);
    const old = JSON.parse(row.data);
    assertRuleMutable(db, row.rule_id);
    if (remove) {
      db.prepare("DELETE FROM source_configs WHERE id=?").run(id);
      return { ok: true };
    }
    if (isEffective(body.status))
      throw new GroupRuleError(409, "生效配置请通过策略变更发布", {
        code: "CHANGE_REQUIRED",
      });
    const next = {
      ...old,
      ...Object.fromEntries(
        [
          "extraInfoId",
          "extraInfoName",
          "reasonId",
          "reasonName",
          "derivedParamsId",
          "priority",
        ]
          .filter((k) => body[k] !== undefined)
          .map((k) => [k, body[k]]),
      ),
      status:
        ({ 0: "离线", 32: "标记" } as any)[body.status] ||
        body.status ||
        old.status,
      decision: body.decisionId
        ? get("decisionList", Number(body.decisionId))?.name
        : (body.decision ?? old.decision),
      decisionId: body.decisionId ?? old.decisionId,
      modifier: "demo",
      updatedAt: new Date().toISOString(),
    };
    db.prepare("UPDATE source_configs SET data=? WHERE id=?").run(
      JSON.stringify(next),
      id,
    );
    return next;
  };
  app.put("/api/source/config/:id", (req, res) =>
    res.json(updateSourceConfig(req.params.id, req.body)),
  );
  app.delete("/api/source/config/:id", (req, res) =>
    res.json(updateSourceConfig(req.params.id, {}, true)),
  );
  app.post("/api/policy-configs/batch", (req, res) => {
    if (!Array.isArray(req.body.ids) || !req.body.ids.length)
      return res.status(400).json({ error: "请选择策略配置" });
    const items = db.transaction(() =>
      req.body.ids.map((id: string) => {
        if (id.startsWith("legacy:")) {
          const r = db
            .prepare("SELECT * FROM scene_rules WHERE id=?")
            .get(Number(id.slice(7))) as any;
          if (!r) throw new GroupRuleError(404, "配置不存在");
          assertRuleMutable(db, r.rule_id);
          if (req.body.action === "删除")
            db.prepare("DELETE FROM scene_rules WHERE id=?").run(r.id);
          else {
            const patch = req.body.patch || {};
            if (isEffective(patch.status))
              throw new GroupRuleError(409, "生效配置请通过策略变更发布", {
                code: "CHANGE_REQUIRED",
              });
            db.prepare(
              "UPDATE scene_rules SET status=?,decision=?,priority=? WHERE id=?",
            ).run(
              patch.status ?? r.status,
              patch.decisionId
                ? get("decisionList", Number(patch.decisionId))?.name
                : (patch.decision ?? r.decision),
              patch.priority ?? r.priority,
              r.id,
            );
          }
          return { ok: true };
        }
        return updateSourceConfig(
          id,
          req.body.patch || {},
          req.body.action === "删除",
        );
      }),
    )();
    res.json({ ok: true, items });
  });
  app.get("/api/source/risk-tags", (_req, res) => {
    const rows = db
      .prepare("SELECT data FROM source_archives WHERE kind='tag'")
      .all() as any[];
    const byId = new Map(
      rows.map((r) => {
        const t = JSON.parse(r.data);
        return [t.id, t];
      }),
    );
    for (const row of db
      .prepare("SELECT data FROM entities WHERE module='tag'")
      .all() as any[]) {
      const t = JSON.parse(row.data);
      if (t.type === "风险标签" || t.view === "风险标签")
        byId.set(t.id, { ...byId.get(t.id), ...t });
    }
    res.json({ items: [...byId.values()] });
  });
  app.get("/api/source/features/:id/dependencies", (req, res) => {
    const row = db
      .prepare("SELECT data FROM source_archives WHERE kind='feature' AND id=?")
      .get(Number(req.params.id)) as any;
    if (!row) return res.status(404).json({ error: "特征不存在" });
    const f = JSON.parse(row.data).detail;
    let names = f.param_list || f.paramList || "";
    names = Array.isArray(names) ? names : String(names).split(",");
    try {
      const p = JSON.parse(f.parsed_exp_info || f.parsedExpInfo || "{}");
      names.push(...(p.dependentEleNames || []));
    } catch {}
    const rows = db
      .prepare("SELECT data FROM entities WHERE module='featureService'")
      .all() as any[];
    res.json({
      items: rows
        .map((r) => JSON.parse(r.data))
        .filter((r) => names.includes(r.enName)),
    });
  });
  app.get("/api/source/full-catalog/report", (_req, res) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key='full-catalog-report'")
      .get() as any;
    res.json(row ? JSON.parse(row.value) : { counts: {}, available: false });
  });
  app.get("/api/source/report", (_req, res) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get("source-import-report") as any;
    res.json(row ? JSON.parse(row.value) : { counts: {} });
  });
  app.get("/api/source/archive/:kind/:id", (req, res) => {
    const row = db
      .prepare(
        "SELECT data FROM source_archives WHERE kind=? AND id=? ORDER BY version DESC LIMIT 1",
      )
      .get(req.params.kind, Number(req.params.id)) as any;
    if (!row) return res.status(404).json({ error: "尚未导入该来源对象" });
    const archive = JSON.parse(row.data);
    if (req.params.kind === "rule" && !archive.detail?.versionInfo?.length) {
      const captured = db
        .prepare(
          "SELECT json_extract(data,'$.detail.versionInfo') AS versions FROM source_detail_objects WHERE kind='ruleDetail' AND id=?",
        )
        .get(req.params.id) as any;
      const supplement = db
        .prepare(
          "SELECT data FROM source_detail_objects WHERE kind='ruleVersions' AND id=?",
        )
        .get(req.params.id) as any;
      const versions = supplement?.data || captured?.versions;
      if (versions)
        archive.detail = {
          ...archive.detail,
          versionInfo: JSON.parse(versions),
        };
    }
    if (req.params.kind === "feature" && archive.detail?.type === 2) {
      const captured = db
        .prepare(
          "SELECT data FROM source_detail_objects WHERE kind='accumulation' AND id=?",
        )
        .get(req.params.id) as any;
      if (captured) archive.detail.accumulation = JSON.parse(captured.data);
    }
    res.json({ ...archive, canSyncSource });
  });
  app.get("/api/source/configs/:module/:id", (req, res) => {
    const rows = db
      .prepare(
        "SELECT * FROM source_configs WHERE scene_module=? AND scene_id=?",
      )
      .all(req.params.module, Number(req.params.id)) as { data: string }[];
    res.json({
      items: rows.map((x: any) => {
        const c = JSON.parse(x.data);
        return {
          ...c,
          scope: {
            module: x.scene_module,
            sceneId: x.scene_id,
            nodeId: x.node_id,
          },
          locked: ruleStats(db, c.ruleId).effective,
          riskTags: riskIdsForRule(db, c.ruleId),
          rule: (() => {
            const r = get("rulePage", c.ruleId);
            return r
              ? { id: r.id, name: r.name, enName: r.enName, status: r.status }
              : undefined;
          })(),
          ruleGroupName: c.ruleGroupName || get("rulesGroup", c.groupId)?.name,
          decision:
            c.decision && !/^\d+$/.test(c.decision)
              ? c.decision
              : get("decisionList", c.decisionId)?.name || c.decision,
        };
      }),
    });
  });
  app.get("/api/source/rules/:id/features", (req, res) => {
    const refs = db
      .prepare(
        `
      SELECT e.data, json_extract(a.data,'$.detail.creator') AS creator,
             json_extract(a.data,'$.detail.modifier') AS modifier,
             coalesce(json_extract(a.data,'$.detail.ref_count'),json_extract(a.data,'$.detail.refCount')) AS refCount
      FROM source_feature_refs r JOIN entities e ON e.module='featureService' AND e.id=r.feature_id
      LEFT JOIN source_archives a ON a.kind='feature' AND a.id=e.id AND a.version=''
      WHERE r.rule_id=? ORDER BY r.feature_id
    `,
      )
      .all(Number(req.params.id)) as any[];
    res.json({
      items: refs.map(({ data, ...meta }) => ({
        ...JSON.parse(data),
        ...meta,
      })),
    });
  });
  app.get("/api/source/rules/:id/references", (req, res) => {
    const refs = db
      .prepare(
        "SELECT id,scene_module,scene_id,node_id,group_id,data FROM source_configs WHERE rule_id=?",
      )
      .all(Number(req.params.id)) as any[];
    res.json({
      items: refs.map((r) => ({
        ...r,
        name: get(
          r.scene_module === "graphTemplate" ? "layerScene" : r.scene_module,
          r.scene_id,
        )?.name,
        conf: JSON.parse(r.data),
      })),
    });
  });
  app.get("/api/health", (_, res) =>
    res.json({ ok: true, database: "sqlite" }),
  );
  app.get("/api/audit", (_, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT id,module,entity_id AS entityId,name,action,owner,updated_at AS updatedAt FROM audit ORDER BY id DESC LIMIT 500",
        )
        .all(),
    }),
  );
  app.get("/api/entities/:module", (req, res) => {
    const m = req.params.module;
    if (!moduleMap[m]) return res.status(404).json({ error: "模块不存在" });
    if (["rulePage", "featureService"].includes(m))
      return res.json(listCatalogEntities(db, m, req.query));
    let rows = (
      db
        .prepare("SELECT data FROM entities WHERE module=? ORDER BY id DESC")
        .all(m) as { data: string }[]
    ).map((x) => JSON.parse(x.data));
    for (const [k, v] of Object.entries(req.query)) {
      if (!v || ["page", "pageSize", "searchMode", "changeTaskId"].includes(k))
        continue;
      if (k === "riskTags") {
        const ids = new Set(expandedRiskTags(db, v));
        rows = rows.filter((r) => {
          const refs = db
            .prepare(
              "SELECT rule_id FROM source_configs WHERE scene_module=? AND scene_id=?",
            )
            .all(m, r.id) as any[];
          return refs.some((c) =>
            riskIdsForRule(db, c.rule_id).some((id) => ids.has(id)),
          );
        });
        continue;
      }
      if (
        ["scene", "rulesGroup"].includes(m) &&
        ["ruleId", "decision", "status"].includes(k)
      ) {
        rows = rows.filter((r) => {
          const bindings = db
            .prepare(
              "SELECT * FROM scene_rules WHERE scene_module=? AND scene_id=?",
            )
            .all(m, r.id) as any[];
          if (r.sourceImported) {
            const source = db
              .prepare(
                "SELECT data FROM source_configs WHERE scene_module=? AND scene_id=?",
              )
              .all(m, r.id) as { data: string }[];
            bindings.push(
              ...source.map(({ data }) => {
                const c = JSON.parse(data);
                return { ...c, rule_id: c.ruleId };
              }),
            );
          }
          return bindings.some((b) =>
            k === "ruleId"
              ? `${b.rule_id} ${get("rulePage", b.rule_id)?.name || ""}`.includes(
                  String(v),
                )
              : String(b[k] || "").includes(String(v)),
          );
        });
        continue;
      }
      rows = rows.filter((r) =>
        k === "id"
          ? String(r.id) === String(v) || String(r.sourceId) === String(v)
          : k === "q" && req.query.searchMode === "exact"
            ? [r.id, r.sourceId, r.name, r.enName].some(
                (value) =>
                  value != null &&
                  String(value).toLowerCase() === String(v).toLowerCase(),
              )
            : k === "q"
              ? `${r.id} ${r.sourceId || ""} ${r.name} ${r.enName || ""}`
                  .toLowerCase()
                  .includes(String(v).toLowerCase())
              : String(
                  k === "view"
                    ? r.view || moduleMap[m].tabs?.[0] || ""
                    : r[k] || "",
                )
                  .toLowerCase()
                  .includes(String(v).toLowerCase()),
      );
    }
    const total = rows.length;
    const size = Math.max(1, Math.min(100, Number(req.query.pageSize) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({
      items: rows
        .slice((page - 1) * size, page * size)
        .map(({ nodes, edges, sourceData, ...row }) => row),
      total,
      page,
      pageSize: size,
    });
  });
  app.get("/api/entities/:module/:id", (req, res) => {
    let row = get(req.params.module, Number(req.params.id));
    if (row && req.params.module === "rulePage")
      row = {
        ...row,
        riskTags: riskIdsForRule(db, row.id),
        ruleStats: ruleStats(db, row.id),
      };
    return row ? res.json(row) : res.status(404).json({ error: "记录不存在" });
  });
  app.post("/api/entities/:module", (req, res) => {
    const m = req.params.module;
    if (!moduleMap[m]) return res.status(404).json({ error: "模块不存在" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "名称不能为空，且不能超过200个字符" });
    const id = Number(
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(id),10000)+1 AS id FROM entities WHERE module=?",
          )
          .get(m) as any
      ).id,
    );
    return res.status(201).json(
      save(
        m,
        id,
        {
          status: "生效",
          owner: "demo",
          type: "实时计算",
          version: "v1",
          ...parsed.data,
        },
        "新建",
      ),
    );
  });
  app.put("/api/entities/:module/:id", (req, res) => {
    const m = req.params.module,
      id = Number(req.params.id);
    if (!get(m, id)) return res.status(404).json({ error: "记录不存在" });
    if (m === "rulePage") assertRuleMutable(db, id);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "请输入有效名称" });
    return res.json(save(m, id, parsed.data, "修改"));
  });
  app.delete("/api/entities/:module/:id", (req, res) => {
    const m = req.params.module,
      id = Number(req.params.id),
      old = get(m, id);
    if (!old) return res.status(404).json({ error: "记录不存在" });
    if (m === "rulePage") assertRuleMutable(db, id);
    db.transaction(() => {
      db.prepare("DELETE FROM entities WHERE module=? AND id=?").run(m, id);
      if (m === "rulePage") {
        db.prepare("DELETE FROM scene_rules WHERE rule_id=?").run(id);
        db.prepare("DELETE FROM source_configs WHERE rule_id=?").run(id);
        db.prepare("DELETE FROM source_feature_refs WHERE rule_id=?").run(id);
      } else
        db.prepare(
          "DELETE FROM scene_rules WHERE scene_module=? AND scene_id=?",
        ).run(m, id);
      audit(m, id, old.name, "删除");
    })();
    return res.json({ ok: true });
  });
  app.post("/api/entities/:module/:id/copy", (req, res) => {
    const m = req.params.module,
      old = get(m, Number(req.params.id));
    if (!old) return res.status(404).json({ error: "记录不存在" });
    const id = Number(
      (
        db
          .prepare("SELECT MAX(id)+1 AS id FROM entities WHERE module=?")
          .get(m) as any
      ).id,
    );
    return res.status(201).json(
      save(
        m,
        id,
        {
          ...old,
          name: `${old.name}_copy`,
          enName: old.enName ? `${old.enName}_copy` : undefined,
          ...(m === "rulePage"
            ? {
                sourceImported: false,
                sourceId: undefined,
                refCount: 0,
                ruleStats: undefined,
                status: "就绪",
              }
            : {}),
        },
        "复制",
      ),
    );
  });
  app.get("/api/entities/:module/:id/versions", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT id,data,created_at AS createdAt FROM versions WHERE module=? AND entity_id=? ORDER BY id DESC",
        )
        .all(req.params.module, Number(req.params.id))
        .map((r: any) => ({ ...r, data: JSON.parse(r.data) })),
    }),
  );
  app.post("/api/entities/:module/:id/restore/:version", (req, res) => {
    if (req.params.module === "rulePage")
      assertRuleMutable(db, Number(req.params.id));
    const v = db
      .prepare(
        "SELECT data FROM versions WHERE id=? AND module=? AND entity_id=?",
      )
      .get(
        Number(req.params.version),
        req.params.module,
        Number(req.params.id),
      ) as any;
    if (!v || !get(req.params.module, Number(req.params.id)))
      return res.status(404).json({ error: "版本不存在" });
    res.json(
      save(
        req.params.module,
        Number(req.params.id),
        JSON.parse(v.data),
        "恢复版本",
      ),
    );
  });
  app.get("/api/scenes/:module/:id/rules", (req, res) => {
    const rows = db
      .prepare(
        "SELECT * FROM scene_rules WHERE scene_module=? AND scene_id=? ORDER BY priority,id",
      )
      .all(req.params.module, Number(req.params.id)) as any[];
    res.json({
      items: [
        ...rows.map((r) => ({
          ...r,
          locked: ruleStats(db, r.rule_id).effective,
          rule: get("rulePage", r.rule_id),
        })),
        ...(
          db
            .prepare(
              "SELECT * FROM source_configs WHERE scene_module=? AND scene_id=?",
            )
            .all(req.params.module, Number(req.params.id)) as any[]
        ).map((r) => ({
          ...JSON.parse(r.data),
          rule_id: r.rule_id,
          locked: ruleStats(db, r.rule_id).effective,
          rule: get("rulePage", r.rule_id),
        })),
      ],
    });
  });
  app.post("/api/scenes/:module/:id/rules", (req, res) => {
    if (req.params.module === "rulesGroup")
      return res.status(201).json(groups.add(Number(req.params.id), req.body));
    const ruleId = Number(req.body.ruleId);
    if (
      !get(req.params.module, Number(req.params.id)) ||
      !get("rulePage", ruleId)
    )
      return res.status(404).json({ error: "场景或规则不存在" });
    if (isEffective(req.body.status ?? "标记"))
      return res
        .status(409)
        .json({ error: "生效配置请通过策略变更发布", code: "CHANGE_REQUIRED" });
    const status =
      ({ 0: "离线", 32: "标记" } as any)[req.body.status] ||
      req.body.status ||
      "标记";
    if (get(req.params.module, Number(req.params.id))?.sourceImported) {
      const id = "scene-local:" + randomUUID();
      const decision = req.body.decisionId
        ? get("decisionList", Number(req.body.decisionId))?.name
        : req.body.decision || "人工审核";
      const data = {
        id,
        ruleId,
        rule_id: ruleId,
        groupId: 0,
        ...req.body,
        status,
        decision,
        modifier: "demo",
        updatedAt: new Date().toISOString(),
      };
      db.prepare("INSERT INTO source_configs VALUES(?,?,?,?,?,?,?)").run(
        id,
        req.params.module,
        Number(req.params.id),
        ruleId,
        0,
        req.body.nodeId || "",
        JSON.stringify(data),
      );
      return res.status(201).json({ id });
    }
    try {
      const info = db
        .prepare(
          "INSERT INTO scene_rules(scene_module,scene_id,rule_id,status,decision,priority) VALUES(?,?,?,?,?,?)",
        )
        .run(
          req.params.module,
          Number(req.params.id),
          ruleId,
          status,
          req.body.decisionId
            ? get("decisionList", Number(req.body.decisionId))?.name ||
                "人工审核"
            : req.body.decision || "人工审核",
          Number(req.body.priority) || 1,
        );
      audit(req.params.module, Number(req.params.id), "添加规则", "修改");
      res.status(201).json({ id: info.lastInsertRowid });
    } catch {
      res.status(409).json({ error: "规则已经添加到该场景" });
    }
  });
  app.put("/api/scene-rules/:id", (req, res) => {
    if (
      db.prepare("SELECT 1 FROM source_configs WHERE id=?").get(req.params.id)
    )
      return res.json(updateSourceConfig(req.params.id, req.body));
    const old = db
      .prepare("SELECT * FROM scene_rules WHERE id=?")
      .get(Number(req.params.id)) as any;
    if (old?.scene_module === "rulesGroup")
      return res.json(
        groups.update(old.scene_id, "legacy-group:" + old.id, req.body),
      );
    if (!old) return res.status(404).json({ error: "配置不存在" });
    assertRuleMutable(db, old.rule_id);
    if (isEffective(req.body.status))
      return res
        .status(409)
        .json({ error: "生效配置请通过策略变更发布", code: "CHANGE_REQUIRED" });
    const result = db
      .prepare(
        "UPDATE scene_rules SET status=?,decision=?,priority=? WHERE id=?",
      )
      .run(
        req.body.status ?? old.status,
        req.body.decision ?? old.decision,
        req.body.priority ?? old.priority,
        Number(req.params.id),
      );
    res.status(result.changes ? 200 : 404).json({ ok: !!result.changes });
  });
  app.delete("/api/scene-rules/:id", (req, res) => {
    if (
      db.prepare("SELECT 1 FROM source_configs WHERE id=?").get(req.params.id)
    )
      return res.json(updateSourceConfig(req.params.id, {}, true));
    const old = db
      .prepare("SELECT * FROM scene_rules WHERE id=?")
      .get(Number(req.params.id)) as any;
    if (old?.scene_module === "rulesGroup")
      return res.json(
        groups.update(old.scene_id, "legacy-group:" + old.id, {}, true),
      );
    if (old) assertRuleMutable(db, old.rule_id);
    db.prepare("DELETE FROM scene_rules WHERE id=?").run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/rules/:id/tests", (req, res) =>
    res.json({
      items: db
        .prepare("SELECT * FROM test_runs WHERE rule_id=? ORDER BY id DESC")
        .all(Number(req.params.id)),
    }),
  );
  app.post("/api/rules/:id/test", (req, res) => {
    const rule = get("rulePage", Number(req.params.id));
    if (!rule) return res.status(404).json({ error: "规则不存在" });
    try {
      const input =
        typeof req.body.input === "string"
          ? JSON.parse(req.body.input)
          : req.body.input;
      if (!input || typeof input !== "object") throw Error("请输入JSON对象");
      const result = evaluateExpression(
        executableRule(db, rule).expression,
        input,
      );
      const expected =
        req.body.expected === undefined ? true : Boolean(req.body.expected);
      const info = db
        .prepare(
          "INSERT INTO test_runs(rule_id,input,expected,actual,passed) VALUES(?,?,?,?,?)",
        )
        .run(
          rule.id,
          JSON.stringify(input),
          Number(expected),
          Number(result),
          Number(result === expected),
        );
      audit("rulePage", rule.id, rule.name, "测试");
      return res.json({
        id: info.lastInsertRowid,
        actual: result,
        expected,
        passed: result === expected,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/rule-drafts/test", (req, res) => {
    try {
      let input = req.body.input;
      if (req.body.mode === "RequestId模式" || req.body.mode === "CVID模式") {
        const field =
          req.body.mode === "RequestId模式" ? "request_id" : "cv_id";
        const log = db
          .prepare(
            "SELECT detail FROM source_request_logs WHERE " +
              field +
              "=? ORDER BY log_time DESC LIMIT 1",
          )
          .get(String(req.body.requestId || "")) as any;
        if (!log)
          return res.status(404).json({ error: "未找到该请求的本地日志示例" });
        const detail = JSON.parse(log.detail);
        input =
          detail.paramContext || detail.featureValues || detail.input || {};
      }
      if (typeof input === "string") input = JSON.parse(input);
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw Error("请输入JSON对象");
      const taskId = Number(req.query.changeTaskId);
      const actual = taskId
          ? evaluateWithCatalog(
              req.body.expression,
              input,
              (ruleId) =>
                executableRule(
                  db,
                  changes.ruleView(changes.task(taskId), ruleId),
                ),
              [],
              resourceLookup(db),
            )
          : evaluateExpression(req.body.expression, input),
        expected = req.body.expected !== false;
      return res.json({ input, actual, expected, passed: actual === expected });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });
  app.post("/api/evaluate", (req, res) => {
    try {
      return res.json({
        result: evaluateExpression(
          req.body.expression,
          typeof req.body.input === "string"
            ? JSON.parse(req.body.input)
            : req.body.input,
        ),
      });
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  });
  app.get("/api/settings/:key", (req, res) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(req.params.key) as any;
    res.json(row ? JSON.parse(row.value) : {});
  });
  app.put("/api/settings/:key", (req, res) => {
    db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
      req.params.key,
      JSON.stringify(req.body),
    );
    res.json({ ok: true });
  });
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(err instanceof GroupRuleError ? err.status : 500).json({
      error: err.message || "服务异常",
      ...(err instanceof GroupRuleError ? err.details : {}),
    }),
  );
  return app;
}
export const evaluateExpression = evaluateRuleExpression;
