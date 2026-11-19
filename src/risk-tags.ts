export type RiskTag = {
  id: number;
  name: string;
  parentId?: number;
  tagCode?: number | string;
};
export function riskTagTree(items: RiskTag[]) {
  const byId = new Map(items.map((t) => [Number(t.id), t]));
  const children = new Map<number, RiskTag[]>();
  for (const t of items) {
    const p = Number(t.parentId) || 0;
    children.set(p, [...(children.get(p) || []), t]);
  }
  const node = (t: RiskTag, seen: number[]): any => ({
    value: Number(t.id),
    key: Number(t.id),
    title: t.name,
    search: t.id + " " + t.name + " " + (t.tagCode || ""),
    children: seen.includes(Number(t.id))
      ? []
      : (children.get(Number(t.id)) || [])
          .filter((c) => !seen.includes(Number(c.id)))
          .map((c) => node(c, [...seen, Number(t.id)])),
  });
  return items
    .filter((t) => !byId.has(Number(t.parentId)))
    .map((t) => node(t, []));
}
export function tagDescendants(items: RiskTag[], ids: number[]) {
  const set = new Set(ids.map(Number));
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of items)
      if (set.has(Number(t.parentId)) && !set.has(Number(t.id))) {
        set.add(Number(t.id));
        changed = true;
      }
  }
  return set;
}
export function riskPath(items: RiskTag[], id: number) {
  const map = new Map(items.map((t) => [Number(t.id), t]));
  const names: string[] = [];
  const seen = new Set<number>();
  let t = map.get(Number(id));
  while (t && !seen.has(Number(t.id))) {
    seen.add(Number(t.id));
    names.unshift(t.name);
    t = map.get(Number(t.parentId));
  }
  return names.join(" / ");
}
