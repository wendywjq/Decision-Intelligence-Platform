import { riskIdsForRule } from "./risk-filter.ts";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
export class GroupRuleError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: any = {},
  ) {
    super(message);
  }
}
const active = (status: any) =>
  [64, 48, 80].includes(Number(status)) || ["生效", "灰度"].includes(status);
const normalize = (status: any) =>
  (({ 0: "离线", 32: "标记", 64: "生效" }) as any)[status] || status;
export function groupRules(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS rule_group_mounts(group_id INTEGER,module TEXT,parent_id INTEGER,node_id TEXT DEFAULT '',PRIMARY KEY(group_id,module,parent_id,node_id));
    CREATE INDEX IF NOT EXISTS source_configs_group_rule ON source_configs(group_id,rule_id);
    INSERT OR IGNORE INTO rule_group_mounts SELECT DISTINCT group_id,scene_module,scene_id,COALESCE(node_id,'') FROM source_configs WHERE group_id>0 AND (scene_module!='rulesGroup' OR scene_id!=group_id);`);
  const put = db.prepare(
    "INSERT OR REPLACE INTO source_configs VALUES(?,?,?,?,?,?,?)",
  );
  const entity = (m: string, id: number) => {
    const r = db
      .prepare("SELECT data FROM entities WHERE module=? AND id=?")
      .get(m, id) as any;
    return r && JSON.parse(r.data);
  };
  const write = (row: any) =>
    put.run(
      row.id,
      row.scene_module,
      row.scene_id,
      row.rule_id,
      row.group_id,
      row.node_id || "",
      JSON.stringify(row.data),
    );
  // Older local groups used the scene_rules table; keep one authoritative member representation.
  for (const r of db
    .prepare("SELECT * FROM scene_rules WHERE scene_module='rulesGroup'")
    .all() as any[]) {
    const id = "legacy-group:" + r.id;
    if (!db.prepare("SELECT 1 FROM source_configs WHERE id=?").get(id))
      write({
        ...r,
        id,
        group_id: r.scene_id,
        node_id: "",
        data: {
          ...r,
          id,
          ruleId: r.rule_id,
          groupId: r.scene_id,
          ruleGroupId: r.scene_id,
        },
      });
  }
  const mounts = (groupId: number, seen = new Set<number>()): any[] => {
    if (seen.has(groupId)) return [];
    seen.add(groupId);
    return (
      db
        .prepare("SELECT * FROM rule_group_mounts WHERE group_id=?")
        .all(groupId) as any[]
    )
      .flatMap((m) => [
        m,
        ...(m.module === "rulesGroup" ? mounts(m.parent_id, seen) : []),
      ])
      .filter(
        (m, i, a) =>
          a.findIndex(
            (x) =>
              x.module === m.module &&
              x.parent_id === m.parent_id &&
              x.node_id === m.node_id,
          ) === i,
      );
  };
  const targets = (groupId: number, ruleId: number) =>
    (
      db
        .prepare("SELECT * FROM source_configs WHERE group_id=? AND rule_id=?")
        .all(groupId, ruleId) as any[]
    ).map((r) => ({ ...r, data: JSON.parse(r.data) }));
  const usage = (_groupId: number, ruleId: number) => {
    const source = (
      db
        .prepare(
          "SELECT * FROM source_configs WHERE rule_id=? AND scene_module NOT IN ('rulesGroup','graphTemplate')",
        )
        .all(ruleId) as any[]
    ).map((r) => ({ ...r, data: JSON.parse(r.data) }));
    const local = (
      db
        .prepare(
          "SELECT * FROM scene_rules WHERE rule_id=? AND scene_module NOT IN ('rulesGroup','graphTemplate')",
        )
        .all(ruleId) as any[]
    ).map((r) => ({ ...r, node_id: "", data: r }));
    return [...source, ...local].map((r) => ({
      module: r.scene_module,
      id: r.scene_id,
      nodeId: r.node_id,
      status: r.data.status ?? r.data.sourceStatus,
      name: entity(r.scene_module, r.scene_id)?.name,
    }));
  };
  const assertEditable = (groupId: number, ruleId: number) => {
    const effective = usage(groupId, ruleId).filter((r) => active(r.status));
    if (effective.length)
      throw new GroupRuleError(
        409,
        "该规则已在场景中生效，请通过策略变更调整或删除",
        { code: "GROUP_RULE_IN_USE", references: effective },
      );
  };
  const patch = (body: any, published = false) => {
    const p: any = {};
    for (const k of [
      "status",
      "decision",
      "decisionId",
      "extraInfoId",
      "extraInfoName",
      "reasonId",
      "reasonName",
      "derivedParamsId",
      "priority",
    ])
      if (body[k] !== undefined) p[k] = body[k];
    if (p.status !== undefined) {
      p.status = normalize(p.status);
      if (
        !(
          published ? ["离线", "标记", "生效", "灰度"] : ["离线", "标记"]
        ).includes(p.status)
      )
        throw new GroupRuleError(400, "规则组内仅允许配置离线或标记状态");
      p.sourceStatus =
        p.status === "标记"
          ? 32
          : p.status === "生效"
            ? 64
            : p.status === "灰度"
              ? 48
              : 0;
    }
    if (
      p.priority !== undefined &&
      (!Number.isFinite(Number(p.priority)) || Number(p.priority) < 0)
    )
      throw new GroupRuleError(400, "优先级必须为非负数字");
    if (p.decisionId !== undefined) {
      const d = entity("decisionList", Number(p.decisionId));
      if (!d) throw new GroupRuleError(400, "决策不存在");
      p.decision = p.decisionName = d.name;
    }
    if (p.priority !== undefined) p.priority = Number(p.priority);
    return p;
  };
  const record = (id: number, action: string) =>
    db
      .prepare(
        "INSERT INTO audit(module,entity_id,name,action,owner) VALUES('rulesGroup',?,?,?,'demo')",
      )
      .run(id, entity("rulesGroup", id)?.name || String(id), action);
  const list = (id: number) =>
    (
      db
        .prepare(
          "SELECT * FROM source_configs WHERE scene_module='rulesGroup' AND scene_id=? ORDER BY json_extract(data,'$.priority'),id",
        )
        .all(id) as any[]
    ).map((r) => {
      const d = JSON.parse(r.data),
        refs = usage(r.group_id, r.rule_id);
      return {
        ...d,
        id: r.id,
        ruleId: r.rule_id,
        groupId: r.group_id,
        rule: entity("rulePage", r.rule_id),
        riskTags: riskIdsForRule(db, r.rule_id),
        modifiedBy:
          d.modifier || d.owner || entity("rulePage", r.rule_id)?.owner,
        modifiedAt: d.updatedAt || d.modtime,
        locked: refs.some((r) => active(r.status)),
        references: refs,
      };
    });
  const add = db.transaction((groupId: number, body: any) => {
    const ruleId = Number(body.ruleId);
    if (!entity("rulesGroup", groupId) || !entity("rulePage", ruleId))
      throw new GroupRuleError(404, "规则组或规则不存在");
    if (
      db
        .prepare(
          "SELECT 1 FROM source_configs WHERE scene_module='rulesGroup' AND scene_id=? AND rule_id=? AND group_id=?",
        )
        .get(groupId, ruleId, groupId)
    )
      throw new GroupRuleError(409, "该规则已在规则组内");
    const d = {
      id: "group:" + randomUUID(),
      ruleId,
      rule_id: ruleId,
      groupId,
      ruleGroupId: groupId,
      priority: 1,
      status: "标记",
      sourceStatus: 32,
      ...patch(body),
      updatedAt: new Date().toISOString(),
      modifier: "demo",
    };
    const destinations = [
      { module: "rulesGroup", parent_id: groupId, node_id: "" },
      ...mounts(groupId),
    ];
    for (const m of destinations) {
      const id =
        m.module === "rulesGroup" && m.parent_id === groupId
          ? d.id
          : "group-sync:" + randomUUID();
      write({
        id,
        scene_module: m.module,
        scene_id: m.parent_id,
        rule_id: ruleId,
        group_id: groupId,
        node_id: m.node_id,
        data: { ...d, id, nodeId: m.node_id },
      });
    }
    record(groupId, "修改");
    return { ...d, synced: destinations.length - 1 };
  });
  const update = db.transaction(
    (
      groupId: number,
      id: string,
      body: any,
      remove = false,
      published = false,
    ) => {
      const r = db
        .prepare(
          "SELECT * FROM source_configs WHERE id=? AND scene_module='rulesGroup' AND scene_id=?",
        )
        .get(id, groupId) as any;
      if (!r) throw new GroupRuleError(404, "规则组配置不存在");
      if (!published) assertEditable(r.group_id, r.rule_id);
      const p = remove ? {} : patch(body, published);
      const rows = targets(r.group_id, r.rule_id);
      for (const t of rows) {
        if (remove)
          db.prepare("DELETE FROM source_configs WHERE id=?").run(t.id);
        else
          write({
            ...t,
            data: {
              ...t.data,
              ...p,
              updatedAt: new Date().toISOString(),
              modifier: "demo",
            },
          });
      }
      for (const t of rows.filter((t) => t.id.startsWith("legacy-group:"))) {
        const legacy = Number(t.id.split(":")[1]);
        if (remove)
          db.prepare("DELETE FROM scene_rules WHERE id=?").run(legacy);
        else {
          const next = { ...t.data, ...p };
          db.prepare(
            "UPDATE scene_rules SET status=?,decision=?,priority=? WHERE id=?",
          ).run(next.status, next.decision || "", next.priority ?? 1, legacy);
        }
      }
      record(groupId, "修改");
      return { ok: true, synced: rows.length - 1 };
    },
  );
  const apply = (change: any) => {
    const row = db
      .prepare(
        "SELECT data FROM source_configs WHERE id=? AND scene_module='rulesGroup' AND scene_id=?",
      )
      .get(change.configId, Number(change.groupId)) as any;
    if (!row) throw new GroupRuleError(409, "待发布的规则组配置已不存在");
    const current = JSON.parse(row.data);
    if (
      change.before &&
      ["status", "decisionId", "decision", "priority"].some(
        (key) =>
          change.before[key] !== undefined &&
          current[key] !== change.before[key],
      )
    )
      throw new GroupRuleError(409, "规则组配置已变化，请重新创建变更");
    if (
      change.before?.updatedAt &&
      JSON.parse(row.data).updatedAt !== change.before.updatedAt
    )
      throw new GroupRuleError(409, "规则组配置已变化，请重新创建变更");
    return update(
      Number(change.groupId),
      String(change.configId),
      change.after || {},
      change.action === "删除",
      true,
    );
  };
  const publish = (change: any) => {
    const r = db
      .prepare("SELECT * FROM source_configs WHERE id=?")
      .get(change.configId) as any;
    if (!r) throw new GroupRuleError(409, "待发布配置已不存在");
    const before = targets(r.group_id, r.rule_id);
    apply(change);
    return {
      groupId: r.group_id,
      ruleId: r.rule_id,
      before,
      after: targets(r.group_id, r.rule_id),
    };
  };
  const rollback = (snapshot: any) => {
    const ordered = (rows: any[]) =>
      JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
    const current = targets(snapshot.groupId, snapshot.ruleId);
    if (ordered(current) !== ordered(snapshot.after))
      throw new GroupRuleError(409, "发布后的配置已被修改，不能直接回滚");
    for (const r of current)
      db.prepare("DELETE FROM source_configs WHERE id=?").run(r.id);
    for (const r of snapshot.before) {
      write(r);
      if (r.id.startsWith("legacy-group:"))
        db.prepare(
          "INSERT OR REPLACE INTO scene_rules(id,scene_module,scene_id,rule_id,status,decision,priority) VALUES(?,?,?,?,?,?,?)",
        ).run(
          Number(r.id.split(":")[1]),
          "rulesGroup",
          r.scene_id,
          r.rule_id,
          r.data.status,
          r.data.decision || "",
          r.data.priority ?? 1,
        );
    }
    record(snapshot.groupId, "修改");
  };
  return { list, add, update, mounts, apply, publish, rollback };
}
