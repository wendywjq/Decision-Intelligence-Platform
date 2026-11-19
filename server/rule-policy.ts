import type Database from "better-sqlite3";
import { GroupRuleError } from "./group-rules.ts";
export const isEffective = (status: any) =>
  [64, 48, 80].includes(Number(status)) || ["生效", "灰度"].includes(status);
export function ruleReferences(db: Database.Database, id: number) {
  const source = (
    db.prepare("SELECT * FROM source_configs WHERE rule_id=?").all(id) as any[]
  ).map((r) => ({ ...r, ...JSON.parse(r.data) }));
  const local = (
    db
      .prepare(
        "SELECT * FROM scene_rules WHERE rule_id=? AND scene_module!='rulesGroup'",
      )
      .all(id) as any[]
  ).map((r) => ({ ...r, id: "legacy:" + r.id }));
  return [...source, ...local];
}
export function assertRuleMutable(db: Database.Database, id: number) {
  const refs = ruleReferences(db, id).filter(
    (r) =>
      !["rulesGroup", "graphTemplate"].includes(r.scene_module) &&
      isEffective(r.status ?? r.sourceStatus),
  );
  if (refs.length)
    throw new GroupRuleError(
      409,
      "该规则已在场景中生效，请进入策略变更环境修改或删除",
      {
        code: "CHANGE_REQUIRED",
        ruleId: id,
        references: refs.map((r) => ({
          id: r.id,
          module: r.scene_module,
          sceneId: r.scene_id,
          nodeId: r.node_id,
          status: r.status,
        })),
      },
    );
}
export function ruleStats(db: Database.Database, id: number) {
  const refs = ruleReferences(db, id);
  const counts = new Map<string, any>();
  for (const r of refs) {
    const key = String(r.decisionId ?? r.decision ?? "未配置");
    const v = counts.get(key) || {
      decisionId: r.decisionId,
      name: r.decision || r.decisionName || key,
      count: 0,
    };
    v.count++;
    counts.set(key, v);
  }
  const e = db
    .prepare("SELECT data FROM entities WHERE module='rulePage' AND id=?")
    .get(id) as any;
  const source = e ? JSON.parse(e.data).refCount : undefined;
  const archive = db
    .prepare(
      "SELECT data FROM source_archives WHERE kind='rule' AND id=? AND version=''",
    )
    .get(id) as any;
  const distribution = archive
    ? JSON.parse(archive.data).catalogInfo?.decisionDistribution
    : undefined;
  const sourceDecisionDistribution = distribution?.map((d: any) => {
    const row = db
      .prepare("SELECT data FROM entities WHERE module='decisionList' AND id=?")
      .get(d.decisionId) as any;
    return {
      ...d,
      name: row ? JSON.parse(row.data).name : "决策 " + d.decisionId,
    };
  });
  return {
    referenceCount: refs.length,
    sourceReferenceCount: source,
    sourceDecisionDistribution,
    decisionDistribution: [...counts.values()],
    effective: refs.some(
      (r) =>
        !["rulesGroup", "graphTemplate"].includes(r.scene_module) &&
        isEffective(r.status ?? r.sourceStatus),
    ),
  };
}
