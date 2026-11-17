import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { App, Button, Drawer, Form, Input, Select, Space } from "antd";
import { api, entityPath } from "./api";
import type { Row } from "./catalog";
const initialNodes: Node[] = [
  {
    id: "start",
    type: "input",
    position: { x: 350, y: 30 },
    data: { label: "开始" },
  },
  { id: "feature", position: { x: 350, y: 150 }, data: { label: "特征计算" } },
  { id: "rule", position: { x: 350, y: 270 }, data: { label: "规则判断" } },
  { id: "decision", position: { x: 350, y: 390 }, data: { label: "决策加工" } },
  {
    id: "end",
    type: "output",
    position: { x: 350, y: 510 },
    data: { label: "结束" },
  },
];
const initialEdges: Edge[] = ["start", "feature", "rule", "decision"].map(
  (id, i) => ({
    id: "edge-" + i,
    source: id,
    target: ["feature", "rule", "decision", "end"][i],
    markerEnd: { type: MarkerType.ArrowClosed },
  }),
);
export function GraphEditor({ module, row }: { module: string; row: Row }) {
  const { message } = App.useApp();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    row.nodes || initialNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    row.edges || initialEdges,
  );
  const [selected, setSelected] = useState<Node>();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((e) =>
        addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, e),
      ),
    [setEdges],
  );
  const add = (label: string) => {
    const id = crypto.randomUUID();
    setNodes((n) => [
      ...n,
      {
        id,
        position: {
          x: 100 + Math.random() * 300,
          y: 100 + Math.random() * 300,
        },
        data: { label },
      },
    ]);
  };
  async function save() {
    try {
      setSaving(true);
      await api(entityPath(module, row.id), "PUT", { ...row, nodes, edges });
      message.success("画布已保存到数据库");
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="graph-toolbar">
        <Space>
          <span>版本 {row.version || "v1"}</span>
          <Button onClick={() => add("规则判断")}>添加规则节点</Button>
          <Button onClick={() => add("规则组")}>添加规则组</Button>
          <Button onClick={() => add("特征计算")}>添加特征</Button>
          <Button onClick={() => add("决策加工")}>添加决策</Button>
        </Space>
        <Button type="primary" loading={saving} onClick={save}>
          保存画布
        </Button>
      </div>
      <div className="graph-layout">
        <div className="graph-palette">
          <h3>组件</h3>
          {[
            "开始",
            "规则判断",
            "规则组",
            "特征计算",
            "条件分支",
            "决策加工",
            "自定义组件",
            "结束",
          ].map((label) => (
            <button key={label} onClick={() => add(label)}>
              {label}
            </button>
          ))}
          <p className="muted">
            拖动节点调整位置；从连接点拖线；双击节点编辑；选择节点或连线后按
            Delete 删除。
          </p>
        </div>
        <div className="graph-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={(_, node) => {
              setSelected(node);
              form.setFieldsValue(node.data);
            }}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background gap={18} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </div>
      <Drawer
        title="节点策略配置"
        open={!!selected}
        onClose={() => setSelected(undefined)}
        width={460}
        extra={
          <Button
            type="primary"
            onClick={async () => {
              const values = await form.validateFields();
              setNodes((n) =>
                n.map((x) =>
                  x.id === selected?.id
                    ? { ...x, data: { ...x.data, ...values } }
                    : x,
                ),
              );
              setSelected(undefined);
            }}
          >
            确定
          </Button>
        }
      >
        <Form layout="vertical" form={form}>
          <Form.Item label="节点名称" name="label" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="规则ID" name="ruleId">
            <Input placeholder="输入本地示例规则ID" />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={["生效", "标记", "灰度", "停用"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item label="决策" name="decision">
            <Select
              options={["通过", "拒绝", "人工审核"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
