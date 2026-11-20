import type { Express } from "express";
import type Database from "better-sqlite3";
import { GroupRuleError } from "./group-rules.ts";
export function registerReleaseWorkflow(
  app: Express,
  db: Database.Database,
  deps: any,
) {
  const { save, changes, groups, experimentContext } = deps;
  const get = (id: number) => {
    const r = db
      .prepare("SELECT data FROM entities WHERE module='release/list' AND id=?")
      .get(id) as any;
    if (!r) throw new GroupRuleError(404, "任务不存在");
    return JSON.parse(r.data);
  };
  const raw = (id: number) => {
    const r = db
      .prepare(
        "SELECT data FROM source_archives WHERE kind='release' AND id=? AND version=''",
      )
      .get(id) as any;
    return r ? JSON.parse(r.data) : {};
  };
  const live = (r: any) => {
    if (r.sourceImported)
      throw new GroupRuleError(409, "来源归档只读，请新建变更任务");
    if (["已完成", "已回滚", "已中止"].includes(r.status) || r.phase === "完成")
      throw new GroupRuleError(409, "当前任务已结束，不能执行此操作");
  };
  const grayEditable = (r: any) =>
    !r.sourceImported &&
    !r.groupChangesApplied &&
    !["已完成", "已回滚", "已中止"].includes(r.status) &&
    ["实验", "审批"].includes(r.phase) &&
    r.approvalState !== "待审批";
  const grayDefaults = (mode: number) =>
    [1, 10, 50, 100].map((rate, i) => ({
      stage: i + 1,
      grayRate: rate,
      grayTime: i === 3 ? 0 : mode === 0 ? 1 : 10,
      notify: true,
    }));
  function grayConfig(r: any, mode?: number) {
    const b = raw(r.id).basic || {};
    const deployMode = mode ?? r.deployMode ?? b.deployMode ?? 1;
    return {
      deployMode,
      description: r.description || b.description || "",
      urgentReason: r.urgentReason || "",
      grayEnabled: r.grayEnabled !== false,
      approver: r.approver || b.customApprover || "demo",
      notifyUsers: r.notifyUsers || [],
      stages: r.grayConfig?.length
        ? r.grayConfig
        : b.autoDeployConfig?.length
          ? b.autoDeployConfig
          : grayDefaults(deployMode),
    };
  }
  function validate(body: any) {
    const deployMode = Number(body.deployMode);
    if (![0, 1].includes(deployMode))
      throw new GroupRuleError(400, "请选择有效的变更模式");
    const description = String(body.description || "").trim(),
      urgentReason = String(body.urgentReason || "").trim();
    if (!description || description.length > 2000)
      throw new GroupRuleError(400, "请填写变更说明（最多2000字）");
    if (deployMode === 0 && !urgentReason)
      throw new GroupRuleError(400, "请填写紧急变更原因");
    const approver = String(body.approver || "").trim();
    if (!/^[\w.-]{1,80}$/.test(approver))
      throw new GroupRuleError(400, "请填写有效的指定审批人 MIS ID");
    const notifyUsers = body.notifyUsers || [];
    if (
      !Array.isArray(notifyUsers) ||
      notifyUsers.length > 50 ||
      notifyUsers.some(
        (x: any) => typeof x !== "string" || !/^[\w.-]{1,80}$/.test(x),
      )
    )
      throw new GroupRuleError(400, "通知人须为有效 MIS ID");
    const grayEnabled = deployMode === 1 || body.grayEnabled !== false;
    let stages = body.stages;
    if (!grayEnabled)
      stages = [{ stage: 1, grayRate: 100, grayTime: 0, notify: true }];
    if (
      !Array.isArray(stages) ||
      !stages.length ||
      stages.length > 15 ||
      (grayEnabled && stages.length < 2)
    )
      throw new GroupRuleError(400, "请配置有效的灰度阶段");
    let prev = 0;
    const clean = stages.map((s: any, i: number) => {
      const rate = Number(s.grayRate),
        time = Number(s.grayTime || 0),
        last = i === stages.length - 1;
      if (
        !Number.isInteger(rate) ||
        rate <= prev ||
        rate > 100 ||
        (grayEnabled && i === 0 && rate > 10) ||
        (grayEnabled && i > 0 && rate - prev > 50) ||
        (last && rate !== 100)
      )
        throw new GroupRuleError(
          400,
          "首阶段为1%至10%，后续递增且增幅不超过50%，最后阶段须为100%",
        );
      if (
        !last &&
        (!Number.isInteger(time) || time < (deployMode === 0 ? 1 : 10))
      )
        throw new GroupRuleError(
          400,
          deployMode === 0
            ? "紧急变更每阶段不少于1分钟"
            : "日常变更每阶段不少于10分钟",
        );
      prev = rate;
      return {
        stage: i + 1,
        grayRate: rate,
        grayTime: last ? 0 : time,
        notify: s.notify !== false,
      };
    });
    return {
      deployMode,
      description,
      urgentReason,
      approver,
      notifyUsers: [...new Set(notifyUsers)],
      grayEnabled,
      stages: clean,
    };
  }
  const commit = (r: any, next: any, action: string) =>
    save(
      "release/list",
      r.id,
      {
        ...next,
        workflowEvents: [
          ...(r.workflowEvents || []),
          {
            action,
            actor: "demo",
            time: new Date().toISOString(),
            phase: next.phase,
            status: next.status,
            progress: next.progress || 0,
          },
        ],
      },
      action,
    );
  const publish = (r: any, next: any, action: string) => {
    if (
      next.phase === "完成" &&
      !r.groupChangesApplied &&
      r.localChanges?.some((c: any) =>
        ["规则", "场景策略", "规则组策略"].includes(c.objectType),
      )
    ) {
      const impact = experimentContext(r.id);
      next.affectedSnapshot = impact.affected;
      next.trafficSourceSnapshot = impact.trafficSources;
      const snapshots = [...r.localChanges]
        .sort(
          (a: any, b: any) =>
            Number(b.objectType === "规则" && b.action === "新增") -
            Number(a.objectType === "规则" && a.action === "新增"),
        )
        .filter((c: any) =>
          ["规则", "场景策略", "规则组策略"].includes(c.objectType),
        )
        .map((c: any) => changes.publish(c));
      for (const t of r.draftTests || [])
        db.prepare(
          "INSERT INTO test_runs(rule_id,input,expected,actual,passed) VALUES(?,?,?,?,?)",
        ).run(t.rule_id, t.input, t.expected, t.actual, t.passed);
      return commit(
        r,
        {
          ...next,
          groupChangesApplied: true,
          strategySnapshots: snapshots,
          publishedAt: new Date().toISOString(),
        },
        action,
      );
    }
    return commit(r, next, action);
  };
  const advance = db.transaction((id: number, body: any) => {
    const r = get(id);
    if (r.sourceImported)
      throw new GroupRuleError(409, "来源归档只读，请新建变更任务");
    const aliases: any = {
      审批通过: "审批",
      启动灰度: "启动灰度",
      去灰度: "启动灰度",
    };
    const action = aliases[body.action] || body.action;
    let next = { ...r };
    const now = new Date().toISOString();
    if (action === "回滚") {
      if (!r.groupChangesApplied || r.status === "已回滚")
        throw new GroupRuleError(409, "该任务没有可回滚的已发布配置");
      for (const s of [...(r.strategySnapshots || [])].reverse())
        changes.rollback(s);
      if (!r.strategySnapshots)
        for (const s of [...(r.groupChangeSnapshots || [])].reverse())
          groups.rollback(s);
      return commit(
        r,
        {
          ...r,
          status: "已回滚",
          stopTime: now,
          rollbackTime: now,
          groupChangesApplied: false,
        },
        action,
      );
    }
    if (action === "重启") {
      if (r.status !== "已中止" || r.phase === "完成")
        throw new GroupRuleError(409, "当前任务不可重启");
      return commit(
        r,
        {
          ...r,
          ...(r.stoppedAction === "中止实验"
            ? {
                phase: "实验",
                experimentStartedAt: undefined,
                experimentState: "待启动",
                experiment: undefined,
              }
            : {}),
          status:
            r.stoppedAction === "中止实验"
              ? "待启动"
              : r.phase === "灰度"
                ? "待启动"
                : r.phase === "审批"
                  ? "待审批"
                  : "待启动",
          stopTime: undefined,
        },
        action,
      );
    }
    live(r);
    if (action === "中止" || action === "中止实验") {
      if (
        action === "中止实验" &&
        (!r.experimentStartedAt || r.phase !== "审批" || r.approvalSubmittedAt)
      )
        throw new GroupRuleError(409, "当前实验不可中止");
      next.status = "已中止";
      next.stopTime = now;
      next.stoppedPhase = r.phase;
      next.stoppedAction = action;
      if (action === "中止实验") next.experimentState = "已中止";
      return commit(r, next, action);
    }
    if (action === "撤回") {
      if (r.phase !== "审批" || r.approvalState !== "待审批")
        throw new GroupRuleError(409, "仅待审批任务可撤回");
      return commit(
        r,
        {
          ...r,
          status: "待配置",
          approvalState: "已撤回",
          approvalSubmittedAt: undefined,
        },
        action,
      );
    }
    if (action === "审批驳回") {
      if (r.phase !== "审批" || r.approvalState !== "待审批")
        throw new GroupRuleError(409, "任务当前不在待审批阶段");
      if (!String(body.reason || "").trim())
        throw new GroupRuleError(400, "请填写驳回理由");
      return commit(
        r,
        {
          ...r,
          status: "审批驳回",
          approvalState: "已驳回",
          approvalReason: String(body.reason),
        },
        action,
      );
    }
    if (action === "实验") {
      if (r.phase !== "实验")
        throw new GroupRuleError(409, "任务尚未进入实验阶段");
      next.experiment = body.experiment || "双跑";
      next.ratio = body.ratio || 10;
      next.phase = "审批";
      next.status = "待审批";
    } else if (action === "审批") {
      if (r.phase !== "审批")
        throw new GroupRuleError(409, "任务尚未进入审批阶段");
      if (r.workflowVersion === 2 && r.approvalState !== "待审批")
        throw new GroupRuleError(409, "请先完成灰度配置并提交审批");
      next.phase = "灰度";
      next.status = "待启动";
      next.approvalState = "已通过";
      next.approvedAt = now;
      next.grayStageIndex = -1;
      next.progress = 0;
    } else if (action === "下一步" || action === "启动灰度") {
      if (r.phase !== "灰度")
        throw new GroupRuleError(409, "任务尚未进入灰度阶段");
      if (r.workflowVersion === 2) {
        if (r.approvalState !== "已通过")
          throw new GroupRuleError(409, "请先完成审批");
        const index = (r.grayStageIndex ?? -1) + 1,
          stage = r.grayConfig?.[index];
        if (!stage) throw new GroupRuleError(409, "没有可推进的灰度阶段");
        if (action === "启动灰度" && (r.grayStageIndex ?? -1) >= 0)
          throw new GroupRuleError(409, "灰度已经启动，请使用下一步");
        next.grayStageIndex = index;
        next.progress = stage.grayRate;
        next.grayStartedAt = r.grayStartedAt || now;
        next.grayStageStartedAt = now;
      } else next.progress = Math.min(100, (r.progress || 0) + 25);
      next.status = next.progress === 100 ? "已完成" : "灰度中";
      if (next.progress === 100) {
        next.phase = "完成";
        next.endTime = now;
      }
    } else throw new GroupRuleError(400, "未知操作");
    return publish(r, next, action);
  });
  app.get("/api/releases/:id/workflow", (req, res) => {
    const r = get(Number(req.params.id)),
      a = raw(r.id),
      context = experimentContext(r.id);
    const synchronized = new Set<string>();
    for (const snap of r.strategySnapshots || []) {
      if (snap.kind === "group")
        for (const row of [...snap.snapshot.before, ...snap.snapshot.after])
          synchronized.add(String(row.id));
      if (snap.kind === "config") synchronized.add(String(snap.id));
      if (snap.kind === "rule")
        for (const state of [snap.before, snap.after]) {
          for (const row of state.configs || [])
            synchronized.add(String(row.id));
          for (const row of state.legacy || [])
            synchronized.add("legacy:" + row.id);
        }
    }
    res.json({
      ...context,
      publicationSummary: {
        configurationCount: synchronized.size,
        sceneCount: context.affected.scene.length,
        publishedAt: r.publishedAt,
        rollbackTime: r.rollbackTime,
      },
      archive: a,
      grayConfig: grayConfig(r),
      grayEditable: grayEditable(r),
      isSource: !!r.sourceImported,
      experimentResults: a.experimentResults || r.experimentResults || [],
      grayStages: a.grayStages || r.grayStages || [],
      events: r.workflowEvents || [],
      canRollback:
        !r.sourceImported && !!r.groupChangesApplied && r.status !== "已回滚",
    });
  });
  app.get("/api/releases/:id/gray-config", (req, res) => {
    const r = get(Number(req.params.id));
    res.json({
      task: r,
      config: grayConfig(
        r,
        req.query.deployMode === undefined
          ? undefined
          : Number(req.query.deployMode),
      ),
      isEditable: grayEditable(r),
    });
  });
  app.put("/api/releases/:id/gray-config", (req, res) => {
    const r = get(Number(req.params.id));
    if (!grayEditable(r))
      throw new GroupRuleError(409, "当前任务不可编辑灰度配置");
    const c = validate(req.body);
    const task = commit(
      r,
      { ...r, ...c, grayConfig: c.stages, workflowVersion: 2 },
      "保存灰度配置",
    );
    res.json({ task, config: c, isEditable: true });
  });
  app.post("/api/releases/:id/gray-config/submit", (req, res) => {
    const r = get(Number(req.params.id));
    if (!grayEditable(r))
      throw new GroupRuleError(409, "任务已提交或不可编辑，请勿重复操作");
    if (!r.localChanges?.length)
      throw new GroupRuleError(400, "请先配置变更内容");
    const c = validate(req.body);
    if (
      c.deployMode === 1 &&
      (r.experimentState === "已中止" ||
        (!r.experimentStartedAt && !r.experiment))
    )
      throw new GroupRuleError(409, "日常变更须先完成实验流程");
    const task = commit(
      r,
      {
        ...r,
        ...c,
        affectedSnapshot: experimentContext(r.id).affected,
        trafficSourceSnapshot: experimentContext(r.id).trafficSources,
        type: c.deployMode === 0 ? "紧急变更" : "日常变更",
        grayConfig: c.stages,
        workflowVersion: 2,
        phase: "审批",
        status: "待审批",
        approvalState: "待审批",
        approvalSubmittedAt: new Date().toISOString(),
      },
      "提交审批",
    );
    res.json({ task });
  });
  app.post(
    ["/api/releases/:id/advance", "/api/releases/:id/workflow/action"],
    (req, res) => res.json(advance(Number(req.params.id), req.body)),
  );
  return { advance };
}
