import { listCatalogEntities } from "./catalog-list.ts";
import { riskIdsForRule } from "./risk-filter.ts";
import type Database from "better-sqlite3";
import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { GroupRuleError, groupRules } from "./group-rules.ts";
import { evaluateRuleExpression } from "../src/rule-logic.ts";
type Change = any;
export function strategyChanges(
  db: Database.Database,
  groups: ReturnType<typeof groupRules>,
  save: (m: string, id: number, data: any, action: string) => any,
) {
  const get = (m: string, id: number) => {
    const r = db
      .prepare("SELECT data FROM entities WHERE module=? AND id=?")
      .get(m, id) as any;
    return r ? JSON.parse(r.data) : undefined;
  };
  const task = (id: number) => {
    const r = get("release/list", id);
    if (!r) throw new GroupRuleError(404, "变更任务不存在");
    return r;
  };
  const editable = (r: any) => {
    if (r.phase !== "实验" || ["已中止", "已回滚", "已完成"].includes(r.status))
      throw new GroupRuleError(409, "该变更任务当前不可编辑，请新建变更任务");
  };
  const config = (id: string) => {
    if (id.startsWith("legacy:")) {
      const r = db
        .prepare("SELECT * FROM scene_rules WHERE id=?")
        .get(Number(id.slice(7))) as any;
      return r
        ? { id, ...r, data: { ...r, id, ruleId: r.rule_id } }
        : undefined;
    }
    const r = db
      .prepare("SELECT * FROM source_configs WHERE id=?")
      .get(id) as any;
    return r ? { ...r, data: JSON.parse(r.data) } : undefined;
  };
  const ruleView = (r: any, id: number) => {
    let e = get("rulePage", id);
    if (e) e = { ...e, riskTags: e.riskTags ?? riskIdsForRule(db, id) };
    if (r.phase === "完成") return e;
    for (const c of r.localChanges || [])
      if (c.objectType === "规则" && c.ruleId === id)
        e = { ...e, ...(c.after || {}), id, pendingAction: c.action };
    return e;
  };
  const safeRule = (body: any) => {
    const out: any = {};
    for (const k of [
      "name",
      "enName",
      "expression",
      "owner",
      "description",
      "riskText",
      "serviceText",
      "riskTags",
      "tags",
      "ruleConditions",
      "conditionLogic",
      "editMode",
      "status",
    ])
      if (body[k] !== undefined) out[k] = body[k];
    if (
      out.name !== undefined &&
      (!String(out.name).trim() || String(out.name).length > 200)
    )
      throw new GroupRuleError(400, "请输入有效的规则名称");
    return out;
  };
  const safeConfig = (body: any, newGroup = false) => {
    const out: any = {};
    for (const k of [
      "status",
      "decision",
      "decisionId",
      "priority",
      "extraInfoId",
      "extraInfoName",
      "reasonId",
      "reasonName",
      "derivedParamsId",
    ])
      if (body[k] !== undefined) out[k] = body[k];
    if (out.status !== undefined) {
      out.status =
        ({ 0: "离线", 32: "标记", 64: "生效", 48: "灰度", 80: "灰度" } as any)[
          out.status
        ] || out.status;
      if (
        !(
          newGroup ? ["离线", "标记"] : ["离线", "标记", "生效", "灰度"]
        ).includes(out.status)
      )
        throw new GroupRuleError(400, "配置状态无效");
      out.sourceStatus = ({ 离线: 0, 标记: 32, 生效: 64, 灰度: 48 } as any)[
        out.status
      ];
    }
    if (out.priority !== undefined) {
      out.priority = Number(out.priority);
      if (!Number.isFinite(out.priority) || out.priority < 0)
        throw new GroupRuleError(400, "优先级必须为非负数字");
    }
    if (out.decisionId !== undefined) {
      const d = get("decisionList", Number(out.decisionId));
      if (!d) throw new GroupRuleError(400, "决策不存在");
      out.decision = out.decisionName = d.name;
    }
    return out;
  };
  const stage = db.transaction((id: number, body: Change) => {
    const r = task(id);
    editable(r);
    let c: any = { objectType: body.objectType, action: body.action || "修改" };
    if (!["修改", "删除", "新增"].includes(c.action))
      throw new GroupRuleError(400, "变更操作无效");
    if (c.objectType === "规则") {
      c.ruleId = Number(body.ruleId);
      if (c.action === "新增") {
        const all = db
          .prepare("SELECT data FROM entities WHERE module='release/list'")
          .all() as any[];
        const ids = all.flatMap((t) =>
          (JSON.parse(t.data).localChanges || [])
            .filter((c: any) => c.objectType === "规则")
            .map((c: any) => Number(c.ruleId))
            .filter(Number.isFinite),
        );
        c.ruleId =
          Math.max(
            Number(
              (
                db
                  .prepare(
                    "SELECT COALESCE(MAX(id),10000) id FROM entities WHERE module='rulePage'",
                  )
                  .get() as any
              ).id,
            ),
            ...ids,
            10000,
          ) + 1;
        c.before = null;
      } else {
        c.before = get("rulePage", c.ruleId) || null;
        if (
          !c.before &&
          !r.localChanges?.some(
            (p: any) =>
              p.objectType === "规则" &&
              p.ruleId === c.ruleId &&
              p.action === "新增",
          )
        )
          throw new GroupRuleError(404, "规则不存在");
      }
      c.after =
        c.action === "删除"
          ? null
          : {
              ...safeRule(body.after || {}),
              id: c.ruleId,
              ...(c.action === "新增"
                ? { sourceImported: false, status: "就绪" }
                : {}),
            };
    } else if (["场景策略", "规则组策略"].includes(c.objectType)) {
      c.configId = String(body.configId || "");
      const original = config(c.configId);
      const prior = (r.localChanges || []).find(
        (x: any) => x.configId === c.configId && x.action === "新增",
      );
      if (c.action === "新增") {
        c.configId = "change-config:" + randomUUID();
        c.groupId = Number(body.groupId) || 0;
        c.ruleId = Number(body.ruleId);
        c.sceneModule =
          body.sceneModule ||
          (c.objectType === "规则组策略" ? "rulesGroup" : "scene");
        c.sceneId = Number(body.sceneId || body.groupId);
        c.nodeId = body.nodeId || "";
        c.before = null;
        if (!ruleView(r, c.ruleId)) throw new GroupRuleError(404, "规则不存在");
        if (ruleView(r, c.ruleId)?.pendingAction === "删除")
          throw new GroupRuleError(
            409,
            "该规则已计划删除，请先撤销规则删除变更",
          );
        if (
          !get(
            c.sceneModule === "graphTemplate" ? "layerScene" : c.sceneModule,
            c.sceneId,
          )
        )
          throw new GroupRuleError(404, "场景或规则组不存在");
      } else if (!original && prior) {
        c = { ...prior, action: c.action };
        c.before = null;
      } else {
        if (!original) throw new GroupRuleError(404, "策略配置不存在");
        c.before = original.data;
        c.ruleId = original.rule_id;
        c.groupId =
          original.scene_module === "rulesGroup"
            ? original.scene_id
            : original.group_id;
        c.refGroupId = original.group_id;
        c.sceneId = original.scene_id;
        c.sceneModule = original.scene_module;
        c.nodeId = original.node_id;
      }
      c.after =
        c.action === "删除"
          ? null
          : safeConfig(
              body.after || {},
              c.objectType === "规则组策略" && c.action === "新增",
            );
    } else throw new GroupRuleError(400, "不支持的变更对象");
    const changes = [...(r.localChanges || [])].filter(
      (x: any) =>
        !(
          c.objectType === "规则" &&
          c.action === "删除" &&
          x.ruleId === c.ruleId &&
          x.objectType !== "规则"
        ),
    );
    const index = changes.findIndex(
      (x) =>
        x.objectType === c.objectType &&
        (c.objectType === "规则"
          ? x.ruleId === c.ruleId
          : x.configId === c.configId),
    );
    if (index >= 0) {
      const previous = changes[index];
      c.before = previous.before;
      c.changeId = previous.changeId || randomUUID();
      if (previous.action === "新增" && c.action === "删除") {
        changes.splice(index, 1);
        save("release/list", id, { ...r, localChanges: changes }, "修改");
        return c;
      }
      c.action = previous.action === "新增" ? "新增" : c.action;
      c.after = c.after ? { ...previous.after, ...c.after } : null;
      changes[index] = c;
    } else {
      c.changeId = randomUUID();
      changes.push(c);
    }
    save("release/list", id, { ...r, localChanges: changes }, "修改");
    return c;
  });
  const overlayConfigs = (
    r: any,
    rows: any[],
    module: string,
    sceneId: number,
    nodeId?: string,
  ) => {
    if (r.phase === "完成") return rows;
    const result = rows.map((row) => {
      let out = { ...row };
      for (const c of r.localChanges || []) {
        const group =
          c.objectType === "规则组策略" &&
          Number(row.groupId || row.group_id || row.ruleGroupId) ===
            Number(c.refGroupId || c.groupId) &&
          Number(row.ruleId || row.rule_id) === c.ruleId;
        const exact =
          c.objectType === "场景策略" && c.configId === String(row.id);
        if ((group || exact) && c.action !== "新增")
          out = { ...out, ...(c.after || {}), pendingAction: c.action };
      }
      const rule = ruleView(r, Number(out.ruleId || out.rule_id));
      return {
        ...out,
        rule: rule || out.rule,
        riskTags: rule?.riskTags || out.riskTags,
        pendingAction:
          rule?.pendingAction === "删除" ? "删除规则" : out.pendingAction,
        locked: false,
      };
    });
    for (const c of r.localChanges || [])
      if (
        c.action === "新增" &&
        ["场景策略", "规则组策略"].includes(c.objectType)
      ) {
        const match =
          c.objectType === "场景策略"
            ? c.sceneModule === module && c.sceneId === sceneId
            : (module === "rulesGroup" && sceneId === c.groupId) ||
              groups
                .mounts(c.groupId)
                .some(
                  (m) =>
                    m.module === module &&
                    m.parent_id === sceneId &&
                    (!nodeId || m.node_id === nodeId),
                );
        if (match)
          result.push({
            id: c.configId,
            ruleId: c.ruleId,
            rule_id: c.ruleId,
            groupId: c.groupId,
            nodeId: c.nodeId,
            ...c.after,
            rule: ruleView(r, c.ruleId),
            locked: false,
            pendingAction: "新增",
          });
      }
    return result;
  };
  const middleware: RequestHandler = (req, res, next) => {
    if (req.query.changeTaskId === undefined) return next();
    const id = Number(req.query.changeTaskId);
    if (!Number.isSafeInteger(id) || id <= 0)
      return res.status(400).json({ error: "变更环境任务ID无效" });
    try {
      const r = task(id),
        p = req.path.split("/").filter(Boolean).map(decodeURIComponent);
      if (req.method === "GET") {
        if (
          p[0] === "entities" &&
          p[1] === "rulePage" &&
          !p[2] &&
          r.phase !== "完成"
        ) {
          const overrides = new Map<number, any>();
          for (const c of r.localChanges || [])
            if (c.objectType === "规则") {
              const view = ruleView(r, c.ruleId);
              if (view) overrides.set(c.ruleId, view);
            }
          return res.json(
            listCatalogEntities(db, "rulePage", req.query, overrides),
          );
        }

        if (p[0] === "rules" && p[2] === "tests")
          return res.json({
            items: [
              ...(db
                .prepare(
                  "SELECT * FROM test_runs WHERE rule_id=? ORDER BY id DESC",
                )
                .all(Number(p[1])) as any[]),
              ...(r.draftTests || []).filter(
                (t: any) => t.rule_id === Number(p[1]),
              ),
            ],
          });
        if (p[0] === "entities" && p[1] === "rulePage" && p[2]) {
          const e = ruleView(r, Number(p[2]));
          return e
            ? res.json(e)
            : res.status(404).json({ error: "该规则在变更环境中已删除" });
        }
        const json = res.json.bind(res);
        res.json = ((data: any) => {
          if (r.phase === "完成") return json(data);
          if (p[0] === "source" && p[1] === "rules" && p[3] === "metadata") {
            const c = r.localChanges?.find(
              (c: any) =>
                c.objectType === "规则" &&
                c.ruleId === Number(p[2]) &&
                c.after?.riskTags,
            );
            if (c)
              data.tags = [
                ...(data.tags || []).filter((t: any) => t.objType !== 5),
                ...c.after.riskTags.map((v: any) => {
                  const id = Number(typeof v === "object" ? v.id : v);
                  return {
                    id,
                    name: get("tag", id)?.name || String(id),
                    objType: 5,
                  };
                }),
              ];
          }

          if (p[0] === "policy-configs" && data.items) {
            const scopes = new Map<string, any[]>();
            for (const row of data.items) {
              const key = row.scope.module + ":" + row.scope.sceneId;
              scopes.set(key, [...(scopes.get(key) || []), row]);
            }
            data.items = [...scopes.values()].flatMap((rows) =>
              overlayConfigs(
                r,
                rows,
                rows[0].scope.module,
                rows[0].scope.sceneId,
              ),
            );
          }
          if (p[0] === "source" && p[1] === "configs" && data.items)
            data.items = overlayConfigs(r, data.items, p[2], Number(p[3]));
          if (p[0] === "groups" && p[2] === "rules" && data.items)
            data.items = overlayConfigs(
              r,
              data.items,
              "rulesGroup",
              Number(p[1]),
            );
          if (p[0] === "scenes" && p[3] === "rules" && data.items)
            data.items = overlayConfigs(
              r,
              data.items.map((x: any) => ({
                ...x,
                id: typeof x.id === "number" ? "legacy:" + x.id : x.id,
              })),
              p[1],
              Number(p[2]),
            );
          if (p[0] === "source" && p[1] === "archive" && p[2] === "rule") {
            const view = ruleView(r, Number(p[3]));
            if (view?.pendingAction)
              data = {
                ...data,
                logic: {
                  ...data.logic,
                  name: view.enName || data.logic?.name,
                  alias: view.name,
                  expression: view.expression,
                  originExpression: view.expression,
                  ...(view.expression !== get("rulePage", view.id)?.expression
                    ? { ruleConditions: [], editMode: 2 }
                    : {}),
                },
              };
          }
          return json(data);
        }) as any;
        return next();
      }
      if (["PUT", "DELETE"].includes(req.method)) {
        let c: any;
        if (p[0] === "entities" && p[1] === "rulePage")
          c = { objectType: "规则", ruleId: Number(p[2]) };
        if (p[0] === "source" && p[1] === "config") {
          const cfg = config(p[2]);
          const prior = r.localChanges?.find((c: any) => c.configId === p[2]);
          if (!cfg && prior)
            c = { objectType: prior.objectType, configId: p[2] };
          if (cfg)
            c = {
              objectType:
                cfg.scene_module === "rulesGroup" ? "规则组策略" : "场景策略",
              configId: p[2],
            };
        }
        if (p[0] === "scene-rules") {
          const cfg = config(p[1]) || config("legacy:" + p[1]);
          const prior = r.localChanges?.find((c: any) => c.configId === p[1]);
          if (!cfg && prior)
            c = { objectType: prior.objectType, configId: p[1] };
          if (cfg)
            c = {
              objectType:
                cfg.scene_module === "rulesGroup" ? "规则组策略" : "场景策略",
              configId: cfg.id,
            };
        }
        if (p[0] === "groups" && p[2] === "rules" && p[3])
          c = { objectType: "规则组策略", configId: p[3] };
        if (c)
          return res.json({
            ok: true,
            staged: true,
            change: stage(id, {
              ...c,
              action: req.method === "DELETE" ? "删除" : "修改",
              after: req.body,
            }),
            synced: 0,
          });
      }
      if (req.method === "POST") {
        if (p[0] === "policy-configs" && p[1] === "batch") {
          if (!Array.isArray(req.body.ids) || !req.body.ids.length)
            throw new GroupRuleError(400, "请选择策略配置");
          const result = db.transaction(() =>
            req.body.ids.map((configId: string) => {
              const cfg = config(configId) || config("legacy:" + configId);
              const previous = r.localChanges?.find(
                (c: any) => c.configId === configId,
              );
              if (!cfg && !previous)
                throw new GroupRuleError(404, "配置不存在");
              return stage(id, {
                objectType:
                  cfg?.scene_module === "rulesGroup"
                    ? "规则组策略"
                    : previous?.objectType || "场景策略",
                configId: cfg?.id || configId,
                action: req.body.action === "删除" ? "删除" : "修改",
                after: req.body.patch || {},
              });
            }),
          )();
          return res.json({ ok: true, staged: true, items: result });
        }

        if (p[0] === "entities" && p[1] === "rulePage" && p[3] === "restore") {
          const v = db
            .prepare(
              "SELECT data FROM versions WHERE id=? AND module='rulePage' AND entity_id=?",
            )
            .get(Number(p[4]), Number(p[2])) as any;
          if (!v) throw new GroupRuleError(404, "版本不存在");
          const c = stage(id, {
            objectType: "规则",
            ruleId: Number(p[2]),
            action: "修改",
            after: JSON.parse(v.data),
          });
          return res.json(ruleView(task(id), c.ruleId));
        }
        if (p[0] === "entities" && p[1] === "rulePage" && p[3] === "copy") {
          const before = ruleView(r, Number(p[2]));
          if (!before) throw new GroupRuleError(404, "规则不存在");
          const c = stage(id, {
            objectType: "规则",
            action: "新增",
            after: { ...before, name: before.name + "_copy", status: "就绪" },
          });
          return res.status(201).json(ruleView(task(id), c.ruleId));
        }

        if (p[0] === "entities" && p[1] === "rulePage") {
          const c = stage(id, {
            objectType: "规则",
            action: "新增",
            after: req.body,
          });
          return res.status(201).json(ruleView(task(id), c.ruleId));
        }
        if (p[0] === "groups" && p[2] === "create-rule") {
          const result = db.transaction(() => {
            const c = stage(id, {
              objectType: "规则",
              action: "新增",
              after: req.body.rule,
            });
            stage(id, {
              objectType: "规则组策略",
              action: "新增",
              groupId: Number(p[1]),
              ruleId: c.ruleId,
              after: { status: "标记", ...req.body.config },
            });
            return ruleView(task(id), c.ruleId);
          })();
          return res.status(201).json(result);
        }
        if (p[0] === "groups" && p[2] === "rules" && p[3] === "batch") {
          const result = db.transaction(() =>
            req.body.ids.map((configId: string) =>
              stage(id, {
                objectType: "规则组策略",
                configId,
                action: req.body.action === "删除" ? "删除" : "修改",
                after: req.body.patch || {},
              }),
            ),
          )();
          return res.json({ ok: true, staged: true, items: result });
        }
        if (p[0] === "groups" && p[2] === "rules")
          return res.status(201).json({
            ...stage(id, {
              objectType: "规则组策略",
              action: "新增",
              groupId: Number(p[1]),
              ruleId: req.body.ruleId,
              after: { status: "标记", ...req.body },
            }),
            staged: true,
            synced: 0,
          });
        if (p[0] === "scenes" && p[3] === "rules")
          return res.status(201).json({
            ...stage(id, {
              objectType: p[1] === "rulesGroup" ? "规则组策略" : "场景策略",
              action: "新增",
              groupId: p[1] === "rulesGroup" ? Number(p[2]) : 0,
              sceneModule: p[1],
              sceneId: Number(p[2]),
              ruleId: req.body.ruleId,
              after: { status: "标记", ...req.body },
            }),
            staged: true,
            synced: 0,
          });
        if (p[0] === "rules" && p[2] === "test") {
          const rule = ruleView(r, Number(p[1]));
          if (!rule) throw new GroupRuleError(404, "规则不存在");
          const input =
            typeof req.body.input === "string"
              ? JSON.parse(req.body.input)
              : req.body.input;
          const actual = evaluateRuleExpression(rule.expression, input),
            expected = req.body.expected !== false;
          const result = {
            rule_id: rule.id,
            input: JSON.stringify(input),
            actual: Number(actual),
            expected: Number(expected),
            passed: Number(actual === expected),
            id: Date.now(),
          };
          save(
            "release/list",
            id,
            { ...r, draftTests: [...(r.draftTests || []), result] },
            "测试",
          );
          return res.json({
            ...result,
            actual,
            expected,
            passed: actual === expected,
          });
        }
      }
      if (
        !["changes", "releases", "rule-drafts", "evaluate", "probe"].includes(
          p[0],
        ) &&
        !(p[0] === "entities" && p[1] === "release/list")
      )
        return res.status(409).json({
          error: "该操作不支持在当前变更环境直接执行，请返回线上环境操作",
        });
      return next();
    } catch (e) {
      next(e);
    }
  };
  const unchanged = (before: any, current: any) => {
    if (JSON.stringify(before) !== JSON.stringify(current))
      throw new GroupRuleError(409, "线上配置已变化，请重新核对变更内容");
  };
  const ruleSnapshot = (id: number) => ({
    entity: get("rulePage", id) || null,
    archives: db
      .prepare("SELECT * FROM source_archives WHERE kind='rule' AND id=?")
      .all(id),
    configs: db.prepare("SELECT * FROM source_configs WHERE rule_id=?").all(id),
    legacy: db.prepare("SELECT * FROM scene_rules WHERE rule_id=?").all(id),
    refs: db
      .prepare("SELECT * FROM source_feature_refs WHERE rule_id=?")
      .all(id),
  });
  const putConfig = (row: any) =>
    db
      .prepare("INSERT OR REPLACE INTO source_configs VALUES(?,?,?,?,?,?,?)")
      .run(
        row.id,
        row.scene_module,
        row.scene_id,
        row.rule_id,
        row.group_id,
        row.node_id || "",
        typeof row.data === "string" ? row.data : JSON.stringify(row.data),
      );
  const publish = (c: Change): any => {
    if (c.objectType === "规则组策略") {
      if (c.action !== "新增")
        return { kind: "group", snapshot: groups.publish(c) };
      const before = db
        .prepare("SELECT * FROM source_configs WHERE group_id=? AND rule_id=?")
        .all(c.groupId, c.ruleId) as any[];
      groups.add(c.groupId, { ...c.after, ruleId: c.ruleId });
      const parse = (rs: any[]) =>
        rs.map((r) => ({ ...r, data: JSON.parse(r.data) }));
      return {
        kind: "group",
        snapshot: {
          groupId: c.groupId,
          ruleId: c.ruleId,
          before: parse(before),
          after: parse(
            db
              .prepare(
                "SELECT * FROM source_configs WHERE group_id=? AND rule_id=?",
              )
              .all(c.groupId, c.ruleId) as any[],
          ),
        },
      };
    }
    if (c.objectType === "规则") {
      const before = ruleSnapshot(c.ruleId);
      unchanged(c.before, before.entity);
      if (c.action === "删除") {
        db.prepare("DELETE FROM entities WHERE module='rulePage' AND id=?").run(
          c.ruleId,
        );
        db.prepare("DELETE FROM source_configs WHERE rule_id=?").run(c.ruleId);
        db.prepare("DELETE FROM scene_rules WHERE rule_id=?").run(c.ruleId);
        db.prepare("DELETE FROM source_feature_refs WHERE rule_id=?").run(
          c.ruleId,
        );
        db.prepare(
          "DELETE FROM source_archives WHERE kind='rule' AND id=? AND version=''",
        ).run(c.ruleId);
      } else {
        save(
          "rulePage",
          c.ruleId,
          { ...c.after, pendingAction: undefined },
          c.action === "新增" ? "新建" : "修改",
        );
        for (const a of before.archives as any[])
          if (a.version === "") {
            const raw = JSON.parse(a.data);
            raw.logic = {
              ...raw.logic,
              expression: c.after.expression ?? raw.logic?.expression,
              originExpression:
                c.after.expression ?? raw.logic?.originExpression,
              alias: c.after.name ?? raw.logic?.alias,
              name: c.after.enName ?? raw.logic?.name,
            };
            if (c.after.expression !== undefined) {
              raw.logic.ruleConditions = [];
              raw.logic.editMode = 2;
            }
            if (c.after.riskTags)
              raw.catalogInfo = {
                ...raw.catalogInfo,
                riskTagInfo: Object.fromEntries(
                  c.after.riskTags.map((t: any) => {
                    const id = Number(typeof t === "object" ? t.id : t);
                    return [id, get("tag", id)?.name || String(id)];
                  }),
                ),
              };
            db.prepare(
              "UPDATE source_archives SET data=? WHERE kind='rule' AND id=? AND version='' ",
            ).run(JSON.stringify(raw), c.ruleId);
          }
      }
      return {
        kind: "rule",
        id: c.ruleId,
        before,
        after: ruleSnapshot(c.ruleId),
      };
    }
    const old = config(c.configId);
    if (c.action !== "新增") unchanged(c.before, old?.data || null);
    const legacy = c.configId.startsWith("legacy:");
    if (c.action === "删除") {
      if (legacy)
        db.prepare("DELETE FROM scene_rules WHERE id=?").run(
          Number(c.configId.slice(7)),
        );
      else db.prepare("DELETE FROM source_configs WHERE id=?").run(c.configId);
    } else if (legacy) {
      const next = { ...old!.data, ...c.after };
      db.prepare(
        "UPDATE scene_rules SET status=?,decision=?,priority=? WHERE id=?",
      ).run(
        next.status,
        next.decision,
        next.priority,
        Number(c.configId.slice(7)),
      );
    } else {
      const data = {
        ...old?.data,
        ...c.after,
        id: c.configId,
        ruleId: c.ruleId,
        rule_id: c.ruleId,
        groupId: c.groupId || 0,
        nodeId: c.nodeId || "",
        modifier: "demo",
        updatedAt: new Date().toISOString(),
      };
      putConfig({
        id: c.configId,
        scene_module: c.sceneModule,
        scene_id: c.sceneId,
        rule_id: c.ruleId,
        group_id: c.refGroupId || c.groupId || 0,
        node_id: c.nodeId || "",
        data,
      });
    }
    return {
      kind: "config",
      id: c.configId,
      before: old || null,
      after: config(c.configId) || null,
    };
  };
  const rollback = (s: any) => {
    if (s.kind === "group") return groups.rollback(s.snapshot);
    if (s.kind === "config") {
      unchanged(s.after, config(s.id) || null);
      if (s.id.startsWith("legacy:")) {
        db.prepare("DELETE FROM scene_rules WHERE id=?").run(
          Number(s.id.slice(7)),
        );
        if (s.before) {
          const r = s.before;
          db.prepare("INSERT INTO scene_rules VALUES(?,?,?,?,?,?,?)").run(
            Number(s.id.slice(7)),
            r.scene_module,
            r.scene_id,
            r.rule_id,
            r.data.status,
            r.data.decision,
            r.data.priority,
          );
        }
      } else {
        db.prepare("DELETE FROM source_configs WHERE id=?").run(s.id);
        if (s.before) putConfig(s.before);
      }
      return;
    }
    unchanged(s.after, ruleSnapshot(s.id));
    db.prepare("DELETE FROM entities WHERE module='rulePage' AND id=?").run(
      s.id,
    );
    db.prepare("DELETE FROM source_archives WHERE kind='rule' AND id=?").run(
      s.id,
    );
    db.prepare("DELETE FROM source_configs WHERE rule_id=?").run(s.id);
    db.prepare("DELETE FROM scene_rules WHERE rule_id=?").run(s.id);
    db.prepare("DELETE FROM source_feature_refs WHERE rule_id=?").run(s.id);
    const b = s.before;
    if (b.entity)
      db.prepare("INSERT INTO entities VALUES(?,?,?)").run(
        "rulePage",
        s.id,
        JSON.stringify(b.entity),
      );
    for (const a of b.archives)
      db.prepare("INSERT INTO source_archives VALUES(?,?,?,?)").run(
        a.kind,
        a.id,
        a.version,
        a.data,
      );
    for (const r of b.configs) putConfig(r);
    for (const r of b.legacy)
      db.prepare("INSERT INTO scene_rules VALUES(?,?,?,?,?,?,?)").run(
        r.id,
        r.scene_module,
        r.scene_id,
        r.rule_id,
        r.status,
        r.decision,
        r.priority,
      );
    for (const r of b.refs)
      db.prepare("INSERT INTO source_feature_refs VALUES(?,?,?,?,?)").run(
        r.rule_id,
        r.feature_id,
        r.source_id,
        r.kind,
        r.name,
      );
  };
  const remove = db.transaction((id: number, key: string) => {
    const r = task(id);
    editable(r);
    const rows = [...(r.localChanges || [])];
    const index = rows.findIndex((c: any) => c.changeId === key);
    const actual = index >= 0 ? index : /^\d+$/.test(key) ? Number(key) : -1;
    if (actual < 0 || actual >= rows.length)
      throw new GroupRuleError(404, "变更项不存在");
    const removed = rows[actual];
    rows.splice(actual, 1);
    if (removed.objectType === "规则" && removed.action === "新增")
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i].ruleId === removed.ruleId) rows.splice(i, 1);
    return save("release/list", id, { ...r, localChanges: rows }, "修改");
  });
  return {
    task,
    stage,
    remove,
    middleware,
    publish,
    rollback,
    overlayConfigs,
    ruleView,
  };
}
