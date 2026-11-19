import type Database from "better-sqlite3";
import type { Express } from "express";
import { GroupRuleError } from "./group-rules.ts";
export function registerExperimentConfig(
  app: Express,
  db: Database.Database,
  save: (m: string, id: number, d: any, a: string) => any,
) {
  const get = (m: string, id: number) => {
    const r = db
      .prepare("SELECT data FROM entities WHERE module=? AND id=?")
      .get(m, id) as any;
    return r ? JSON.parse(r.data) : undefined;
  };
  const archive = (id: number) => {
    const r = db
      .prepare(
        "SELECT data FROM source_archives WHERE kind='release' AND id=? AND version=''",
      )
      .get(id) as any;
    return r ? JSON.parse(r.data) : {};
  };
  const editable = (t: any) =>
    t.phase === "实验" &&
    !["已中止", "已回滚", "已完成"].includes(t.status) &&
    !t.sourceImported;
  const context = (id: number) => {
    const task = get("release/list", id);
    if (!task) throw new GroupRuleError(404, "变更任务不存在");
    const raw = archive(id),
      basic = raw.basic || {},
      maps: any = {
        scene: new Map(),
        graph_template: new Map(),
        rule_group: new Map(),
        rule: new Map(),
      };
    const add = (kind: string, id: number, module: string, name?: string) => {
      if (!id) return;
      maps[kind].set(module + ":" + id, {
        id,
        module,
        name: name || get(module, id)?.name || String(id),
      });
    };
    for (const kind of Object.keys(maps))
      for (const x of raw.affected?.[kind]?.[kind] || [])
        add(
          kind,
          x.id,
          kind === "rule"
            ? "rulePage"
            : kind === "rule_group"
              ? "rulesGroup"
              : kind === "graph_template"
                ? "layerScene"
                : "scene",
          x.name,
        );
    const addScope = (r: any) => {
      const m = r.scene_module || r.sceneModule;
      const id = r.scene_id || r.sceneId;
      if (m === "rulesGroup") add("rule_group", id, m);
      else if (m === "graphTemplate") add("graph_template", id, "layerScene");
      else if (["scene", "layerScene", "routerSceneList"].includes(m))
        add("scene", id, m);
    };
    for (const c of task.localChanges || []) {
      if (c.ruleId) add("rule", c.ruleId, "rulePage", c.after?.name);
      if (c.objectType === "场景策略") addScope(c);
      else if (c.objectType === "规则组策略") {
        add("rule_group", c.groupId, "rulesGroup");
        for (const r of db
          .prepare(
            "SELECT DISTINCT scene_module,scene_id FROM source_configs WHERE group_id=?",
          )
          .all(c.groupId) as any[])
          addScope(r);
      } else if (c.objectType === "规则") {
        for (const table of ["source_configs", "scene_rules"])
          for (const r of db
            .prepare(
              "SELECT DISTINCT scene_module,scene_id FROM " +
                table +
                " WHERE rule_id=?",
            )
            .all(c.ruleId) as any[])
            addScope(r);
      }
    }
    const affected = Object.fromEntries(
      Object.entries(maps).map(([k, v]: any) => [k, [...v.values()]]),
    );
    const traffic = new Map<string, any>(
      affected.scene.map((s: any) => [
        s.module + ":" + s.id,
        { ...s, label: s.id + "-" + s.name },
      ]),
    );
    for (const label of String(basic.trafficSourceScene || "")
      .split(",")
      .filter(Boolean)) {
      const id = Number(label.split("-")[0]);
      if (id && !traffic.has("scene:" + id))
        traffic.set("scene:" + id, {
          id,
          module: "scene",
          name: label.slice(label.indexOf("-") + 1),
          label,
        });
    }
    const sceneIds = new Set([...traffic.values()].map((s: any) => s.id));
    const samples = {
      blockSamples: [] as any[],
      regressBlackSamples: [] as any[],
      regressWhiteSamples: [] as any[],
    };
    const seen: any = {};
    for (const row of db
      .prepare(
        "SELECT data FROM source_archives WHERE kind='release' AND version=''",
      )
      .all() as any[]) {
      const a = JSON.parse(row.data);
      const info = a.basic?.sampleTrafficSource?.sampleInfo || {};
      for (const k of Object.keys(samples) as (keyof typeof samples)[])
        for (const s of info[k] || [])
          if (sceneIds.has(Number(s.id)) && !seen[k + ":" + s.id]) {
            samples[k].push(s);
            seen[k + ":" + s.id] = true;
          }
    }
    const own = basic.sampleTrafficSource?.sampleInfo;
    if (own)
      for (const k of Object.keys(samples) as (keyof typeof samples)[])
        samples[k] = own[k] || [];
    const sampleRequired =
      samples.blockSamples.length > 0 ||
      samples.regressBlackSamples.length > 0 ||
      samples.regressWhiteSamples.length > 0;
    const parallel = basic.parallelTrafficSource || {},
      history = basic.backtrackTrafficSource || {};
    const defaults = {
      trafficSourceTypes: basic.trafficSourceTypes
        ? String(basic.trafficSourceTypes)
            .split(",")
            .filter((v: string) => ["0", "1", "3"].includes(v))
        : ["0", "1", "3"],
      parallel: {
        rate: parallel.rate || 1,
        endTime: parallel.endTime
          ? new Date(parallel.endTime * 1000).toISOString()
          : new Date(Date.now() + 3600000).toISOString(),
        filters: parallel.filter || [],
      },
      history: {
        days:
          history.startTime && history.endTime
            ? Math.max(
                1,
                Math.round((history.endTime - history.startTime) / 86400),
              )
            : 1,
      },
    };
    // Earlier tasks used a flat { rate, trafficSourceTypes } shape.
    const stored = task.experimentConfig || {};
    const config = {
      trafficSourceTypes: Array.isArray(stored.trafficSourceTypes)
        ? stored.trafficSourceTypes.map(String)
        : defaults.trafficSourceTypes,
      parallel: {
        ...defaults.parallel,
        ...stored.parallel,
        rate: stored.parallel?.rate ?? stored.rate ?? defaults.parallel.rate,
      },
      history: { ...defaults.history, ...stored.history },
    };
    if (sampleRequired && !config.trafficSourceTypes.includes("3"))
      config.trafficSourceTypes = [...config.trafficSourceTypes, "3"];
    return {
      task,
      config,
      affected,
      changeItems: raw.changes?.list || [],
      trafficSources: [...traffic.values()],
      benchmark: samples,
      sampleRequired,
      isEditable: editable(task),
      estimates: {
        parallel: parallel.approximateCostTime,
        history: history.approximateCostTime,
        sample: basic.sampleTrafficSource?.approximateCostTime,
      },
    };
  };
  const validate = (body: any, ctx: any) => {
    const types = body.trafficSourceTypes;
    if (
      !Array.isArray(types) ||
      !types.length ||
      types.some((v: any) => !["0", "1", "3"].includes(v)) ||
      new Set(types).size !== types.length
    )
      throw new GroupRuleError(400, "请选择有效的实验流量类型");
    if (ctx.sampleRequired && !types.includes("3"))
      throw new GroupRuleError(400, "存在必做基准评测实验业务，不可取消");
    const rate = Number(body.parallel?.rate),
      end = Date.parse(body.parallel?.endTime),
      days = Number(body.history?.days);
    if (
      types.includes("0") &&
      (!Number.isFinite(rate) ||
        rate <= 0 ||
        rate > 100 ||
        !Number.isFinite(end) ||
        end <= Date.now())
    )
      throw new GroupRuleError(
        400,
        "双跑流量比例须大于0且不超过100%，结束时间须晚于当前时间",
      );
    if (
      types.includes("1") &&
      (!Number.isInteger(days) || days < 1 || days > 30)
    )
      throw new GroupRuleError(400, "历史时长须为1至30天的整数");
    const filters = body.parallel?.filters || [];
    if (
      !Array.isArray(filters) ||
      filters.length > 50 ||
      filters.some(
        (f: any) =>
          typeof f.field !== "string" ||
          !f.field.trim() ||
          !["==", "!=", ">", ">=", "<", "<=", "包含", "不包含"].includes(
            f.operator,
          ) ||
          typeof f.value !== "string" ||
          !f.value.trim(),
      )
    )
      throw new GroupRuleError(400, "请填写完整有效的流量筛选条件");
    return {
      trafficSourceTypes: types,
      parallel: {
        rate: rate || 1,
        endTime: Number.isFinite(end)
          ? new Date(end).toISOString()
          : new Date(Date.now() + 3600000).toISOString(),
        filters: filters.map((f: any) => ({
          field: f.field,
          operator: f.operator,
          value: f.value,
        })),
      },
      history: { days: days || 1 },
    };
  };
  app.get("/api/releases/:id/experiment-config", (req, res) =>
    res.json(context(Number(req.params.id))),
  );
  app.put("/api/releases/:id/experiment-config", (req, res) => {
    const ctx = context(Number(req.params.id));
    if (!ctx.isEditable)
      throw new GroupRuleError(409, "当前任务不可编辑实验配置");
    const config = validate(req.body, ctx);
    save(
      "release/list",
      ctx.task.id,
      { ...ctx.task, experimentConfig: config },
      "保存实验配置",
    );
    res.json({ ...context(ctx.task.id), config });
  });
  app.post("/api/releases/:id/experiment-config/start", (req, res) => {
    const ctx = context(Number(req.params.id));
    if (!ctx.isEditable) throw new GroupRuleError(409, "当前任务不可启动实验");
    if (!ctx.task.localChanges?.length)
      throw new GroupRuleError(400, "请先在变更环境中配置变更内容");
    const config = validate(req.body, ctx);
    const task = save(
      "release/list",
      ctx.task.id,
      {
        ...ctx.task,
        experimentConfig: config,
        experiment: config.trafficSourceTypes
          .map(
            (t: string) =>
              ({ "0": "双跑", "1": "历史", "3": "基准评测实验" })[t],
          )
          .join("、"),
        ratio: config.parallel.rate,
        experimentStartedAt: new Date().toISOString(),
        phase: "审批",
        status: "待审批",
      },
      "提交实验配置",
    );
    res.json({ task, config });
  });
}
