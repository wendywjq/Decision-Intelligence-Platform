import { Link } from "./navigation";
import { App, Button, Descriptions, Popconfirm, Space, Table, Tag } from "antd";
import { api } from "./api";
export function ChangeReview({
  task,
  onChanged,
}: {
  task: any;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  return (
    <>
      <Descriptions
        items={[
          { key: "name", label: "任务", children: task?.name },
          { key: "phase", label: "阶段", children: task?.phase },
        ]}
      />
      <Table<any>
        rowKey={(c, i) => c.changeId || String(i)}
        dataSource={task?.localChanges || []}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 900 }}
        columns={[
          { title: "对象", dataIndex: "objectType" },
          {
            title: "目标",
            render: (_, c) => (
              <Space direction="vertical">
                <Link target="_blank" to={"/ruleDetails?id=" + c.ruleId}>
                  规则 {c.ruleId}
                </Link>
                {c.sceneModule === "scene" && (
                  <Link
                    target="_blank"
                    to={
                      "/scene?id=" +
                      c.sceneId +
                      "&configId=" +
                      encodeURIComponent(c.configId)
                    }
                  >
                    场景 {c.sceneId} · 配置{" "}
                    {c.before?.sourceConfId || c.configId}
                  </Link>
                )}
                {c.groupId > 0 && <span>规则组 {c.groupId}</span>}
              </Space>
            ),
          },
          {
            title: "操作",
            render: (_, c) => (
              <Tag color={c.action === "删除" ? "red" : "blue"}>{c.action}</Tag>
            ),
          },
          {
            title: "变更前",
            render: (_, c) => <ChangeValue value={c.before} />,
          },
          {
            title: "变更后",
            render: (_, c) =>
              c.action === "删除" ? (
                "删除该对象"
              ) : (
                <ChangeValue value={c.after} />
              ),
          },
          {
            title: "操作",
            render: (_, c, i) => (
              <Popconfirm
                title="撤销这一项草稿变更？"
                onConfirm={async () => {
                  try {
                    await api(
                      "/changes/" +
                        task.id +
                        "/items/" +
                        encodeURIComponent(c.changeId || String(i)),
                      "DELETE",
                    );
                    onChanged();
                  } catch (e: any) {
                    message.error(e.message);
                  }
                }}
              >
                <Button type="link" disabled={task?.phase !== "实验"}>
                  撤销
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  );
}
function ChangeValue({ value }: { value: any }) {
  if (!value) return <span>—</span>;
  return (
    <Space direction="vertical">
      {[
        "name",
        "expression",
        "status",
        "decision",
        "decisionId",
        "priority",
        "owner",
      ]
        .filter((k) => value[k] !== undefined)
        .map((k) => (
          <span key={k}>
            {
              (
                {
                  name: "名称",
                  expression: "表达式",
                  status: "状态",
                  decision: "决策",
                  decisionId: "决策ID",
                  priority: "优先级",
                  owner: "管理员",
                } as any
              )[k]
            }
            ：<code>{String(value[k])}</code>
          </span>
        ))}
    </Space>
  );
}
