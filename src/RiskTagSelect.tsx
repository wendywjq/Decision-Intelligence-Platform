import { useEffect, useState } from "react";
import { Tag, Tooltip, TreeSelect } from "antd";
import { api } from "./api";
import { riskTagTree, riskPath, type RiskTag } from "./risk-tags";
let cached: RiskTag[] | undefined, pending: Promise<RiskTag[]> | undefined;
export function useRiskTags() {
  const [items, setItems] = useState<RiskTag[]>(cached || []);
  useEffect(() => {
    let current = true;
    if (!pending)
      pending = api<any>("/source/risk-tags")
        .then((d) => {
          cached = d.items;
          return d.items;
        })
        .catch((e) => {
          pending = undefined;
          throw e;
        });
    pending
      .then((d) => {
        if (current) setItems(d);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return items;
}
export function RiskTagSelect({
  value,
  onChange,
  placeholder = "请选择风险标签",
  ...rest
}: {
  value?: number[];
  onChange?: (value: number[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const items = useRiskTags();
  return (
    <TreeSelect
      treeData={riskTagTree(items)}
      value={value || []}
      onChange={(v) => onChange?.(v.map(Number))}
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_PARENT}
      allowClear
      showSearch
      treeNodeFilterProp="search"
      placeholder={placeholder}
      style={{ minWidth: 220, width: "100%" }}
      maxTagCount="responsive"
      {...rest}
    />
  );
}
export function RiskTagChips({ ids }: { ids: any[] }) {
  const items = useRiskTags();
  return (
    <>
      {(ids || []).map((v) => {
        const id = Number(typeof v === "object" ? v.id : v),
          t = items.find((t) => Number(t.id) === id);
        return (
          <Tooltip key={id} title={riskPath(items, id)}>
            <Tag>{t?.name || (typeof v === "object" ? v.name : String(v))}</Tag>
          </Tooltip>
        );
      })}
    </>
  );
}
