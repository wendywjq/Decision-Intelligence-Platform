import { Descriptions, Space, Tag, Tooltip } from "antd";
import { useRemote } from "./components";
export function DecisionDistribution({ stats }: { stats: any }) {
  const source = stats?.sourceDecisionDistribution;
  const items = source?.length ? source : stats?.decisionDistribution || [];
  return (
    <Space wrap>
      {items.length ? (
        items.map((d: any) => (
          <Tooltip
            key={d.decisionId ?? d.name}
            title={source ? "Zeus 来源快照决策分布" : "当前副本引用配置"}
          >
            <Tag>
              {d.name}：
              {d.ratio !== undefined ? d.ratio + "%" : d.count + " 次"}
            </Tag>
          </Tooltip>
        ))
      ) : (
        <span className="muted">暂无引用</span>
      )}
    </Space>
  );
}
export function RuleReferenceStats({ id }: { id: number }) {
  const { data } = useRemote<any>("/rules/" + id + "/stats");
  return (
    <section className="detail-section">
      <h2>被引用统计</h2>
      <Descriptions
        items={[
          {
            key: "source",
            label: "Zeus快照被引用次数",
            children: data?.sourceReferenceCount ?? "—",
          },
          {
            key: "local",
            label: "当前副本引用配置数",
            children: data?.referenceCount ?? 0,
          },
          {
            key: "distribution",
            label: "被引用决策分布",
            children: <DecisionDistribution stats={data} />,
          },
        ]}
      />
    </section>
  );
}
