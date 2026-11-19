import { ScenePolicyAdd } from "./ScenePolicyAdd";
import { GraphVersions } from "./GraphVersions";
import { GraphInfoEditor } from "./SourceSecondary";
import { formatDate } from "./date";
import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
} from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "./navigation";
import { useRemote, PageHeader, Section } from "./components";
import { api } from "./api";
import {
  Conditions,
  ObjectDetails,
  RawData,
  SourceConfigTable,
  SourceNotice,
} from "./SourceExamples";
import "@xyflow/react/dist/style.css";
const typeNames: Record<number, string> = {
  0: "识别节点",
  1: "路由节点",
  2: "决策加工",
  3: "决策节点",
  4: "决策输出",
  5: "决策总览",
  6: "策略模板",
};
function SourceNode({ data }: any) {
  return (
    <div
      className={
        "source-flow-node " + (data.isTemplate ? "source-flow-template" : "")
      }
    >
      <Handle type="target" position={Position.Top} />
      <div className="source-flow-title">
        <b>
          {data.nodePath} - {data.label}
        </b>
        <Tag color={data.isTemplate ? "purple" : "blue"}>{data.kind}</Tag>
      </div>
      {!data.isTemplate && (
        <div className="source-flow-counts">
          规则：{data.ruleCount}　规则组：{data.groupCount}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
      <Handle id="right" type="source" position={Position.Right} />
      <Handle id="left" type="target" position={Position.Left} />
    </div>
  );
}
const nodeTypes = { source: SourceNode };
export function buildSourceGraph(graph: any) {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];
  function layer(
    sourceNodes: any[],
    sourceEdges: any[],
    parent?: string,
  ): { width: number; height: number; offsetX: number; offsetY: number } {
    const minX = Math.min(
      0,
      ...sourceNodes.map((n) => Number(n.position?.[0] || 0)),
    );
    const minY = Math.min(
      0,
      ...sourceNodes.map((n) => Number(n.position?.[1] || 0)),
    );
    let width = 320,
      height = 180;
    for (const n of sourceNodes) {
      const path = parent ? parent + "-" + n.id : String(n.id);
      const d = n.data || {};
      const template = d.template;
      const x = Number(n.position?.[0] || 0) - minX + (parent ? 35 : 0),
        y = Number(n.position?.[1] || 0) - minY + (parent ? 75 : 0);
      const node: Node = {
        id: path,
        type: "source",
        position: { x, y },
        parentId: parent,
        data: {
          label: d.name || typeNames[n.componentType] || "节点",
          nodePath: path,
          kind: typeNames[n.componentType] || "节点 " + n.componentType,
          source: n,
          isTemplate: !!template,
          ruleCount: (d.ruleConfs || []).length,
          groupCount: (d.ruleGroups || []).length,
        },
        style: { width: 210, minHeight: 70 },
      };
      allNodes.push(node);
      if (template) {
        const bounds = layer(template.nodes || [], template.edges || [], path);
        node.style = { width: bounds.width, height: bounds.height };
        node.position.x += bounds.offsetX - 35;
        node.position.y += bounds.offsetY - 75;
      }
      const w = Number(node.style?.width) || 210,
        h = Number(node.style?.height) || 76;
      width = Math.max(width, node.position.x + w + 35);
      height = Math.max(height, node.position.y + h + 40);
    }
    sourceEdges.forEach((e, index) => {
      const source = (parent ? parent + "-" : "") + e.sourceNodeId,
        target = (parent ? parent + "-" : "") + e.targetNodeId;
      allEdges.push({
        id: (parent || "root") + "-edge-" + index,
        source,
        target,
        label: e.label || undefined,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#8b96a9", strokeWidth: 1.5 },
        data: { sourceData: e },
      });
    });
    return { width, height, offsetX: minX, offsetY: minY };
  }
  layer(graph.nodes || [], graph.edges || []);
  return { nodes: allNodes, edges: allEdges };
}
export function SourceGraphPage({ kind = "graph" }: { kind?: string }) {
  const [params] = useSearchParams();
  const id = Number(params.get("id"));
  const { data, error } = useRemote<any>("/source/archive/" + kind + "/" + id);
  const navigate = useNavigate();
  const [editInfo, setEditInfo] = useState(false);
  const rowRemote = useRemote<any>("/entities/layerScene/" + id);
  const version = params.get("version");
  const activeLocal = useRemote<any>(
    "/settings/graph-active-" + kind + "-" + id,
  );
  useEffect(() => {
    activeLocal.reload();
  }, [version, id, kind]);
  const historical = useRemote<any>(
    version && kind === "graph"
      ? "/source/graph/" + id + "/version/" + version
      : "",
  );
  return (
    <>
      <PageHeader
        title={
          data?.graph
            ? `[详情] ${id} - ${rowRemote.data?.name || data.graph.name} V${version || activeLocal.data?.version || data.graph.version}`
            : "分层场景详情"
        }
      >
        <Button onClick={() => setEditInfo(true)}>修改信息</Button>
        <Button onClick={() => navigate("/layerScene")}>返回分层场景</Button>
        {data && <RawData value={data} />}
      </PageHeader>
      {version && historical.error && (
        <Alert type="warning" message={historical.error} />
      )}
      {rowRemote.data && (
        <GraphInfoEditor
          row={rowRemote.data}
          open={editInfo}
          onClose={() => setEditInfo(false)}
          onSaved={rowRemote.reload}
        />
      )}
      {version &&
      kind === "template" &&
      String(version) !== String(data?.graph?.version) ? (
        <Alert
          type="warning"
          message="此模板历史版本未收录完整画布，不能显示当前画布代替历史版本。"
        />
      ) : error ? (
        <Alert type="error" message={error} />
      ) : version && historical.error ? null : version && historical.loading ? (
        <Spin />
      ) : data ? (
        <SourceGraphView
          key={version || "active"}
          id={id}
          archive={
            version && historical.data
              ? {
                  ...data,
                  graph: historical.data,
                  decisionTree: historical.data.decisionTreeArchive,
                }
              : activeLocal.data?.graph
                ? {
                    ...data,
                    graph: activeLocal.data.graph,
                    decisionTree: activeLocal.data.graph.decisionTreeArchive,
                  }
                : data
          }
          kind={kind}
          historical={!!version || !!activeLocal.data?.graph}
        />
      ) : (
        <Spin />
      )}
    </>
  );
}
export function SourceGraphView({
  id,
  archive,
  kind = "graph",
  historical = false,
}: {
  id: number;
  archive: any;
  kind?: string;
  historical?: boolean;
}) {
  const { message } = App.useApp();
  const [view, setView] = useState("识别树");
  const [selected, setSelected] = useState<any>();
  const [table, setTable] = useState(false);
  const { data: config } = useRemote<{ items: any[] }>(
    "/source/configs/" +
      (kind === "template" ? "graphTemplate" : "layerScene") +
      "/" +
      id,
  );
  const graph =
    view === "决策树" ? archive.decisionTree : archive.graph || archive;
  const converted = useMemo(() => buildSourceGraph(graph || {}), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(converted.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(converted.edges);
  useEffect(() => {
    setNodes(converted.nodes);
    setEdges(converted.edges);
  }, [converted, setNodes, setEdges]);
  const templates = converted.nodes.filter((n) => n.data.isTemplate);
  const historicConfs = converted.nodes.flatMap((n: any) =>
    [
      ...(n.data.source.data?.ruleConfs || []),
      ...(n.data.source.data?.ruleGroups || []).flatMap((g: any) =>
        (g.ruleConfs || g.confs || []).map((c: any) => ({
          ...c,
          groupId: g.id || g.ruleGroupId,
          ruleGroupName: g.ruleGroupName,
        })),
      ),
    ].map((c: any, i: number) => ({
      ...c,
      id: n.id + ":" + i,
      nodeId: n.id,
      ruleId: c.ruleId,
      name: c.ruleAlias || c.ruleName,
      sourceConfId: c.confId,
      updatedAt: c.modTime || c.modtime,
      sourceStatus: c.status,
      status:
        ({ 64: "生效", 32: "标记", 0: "离线" } as any)[c.status] ||
        String(c.status),
    })),
  );
  const nodeConfs = (path: string) =>
    (historical ? historicConfs : config?.items || []).filter(
      (c) => c.nodeId === path || c.nodeId?.startsWith(path + "-"),
    );
  async function saveLayout() {
    try {
      await api(
        "/settings/source-layout-" + kind + "-" + id + "-" + view,
        "PUT",
        { nodes: nodes.map((n) => ({ id: n.id, position: n.position })), view },
      );
      message.success("本地布局已保存");
    } catch (e: any) {
      message.error(e.message);
    }
  }
  async function restoreLayout() {
    try {
      const data = await api(
        "/settings/source-layout-" + kind + "-" + id + "-" + view,
      );
      if (!data.nodes) return message.info("暂无本地布局");
      setNodes((n) =>
        n.map((x) => ({
          ...x,
          position:
            data.nodes.find((y: any) => y.id === x.id)?.position || x.position,
        })),
      );
    } catch (e: any) {
      message.error(e.message);
    }
  }
  return (
    <>
      <SourceNotice />
      <div className="graph-toolbar">
        <Space>
          <Tabs
            activeKey={view}
            onChange={setView}
            items={["识别树", "决策树", "策略模板", "版本管理"].map(
              (label) => ({ key: label, label }),
            )}
          />
        </Space>
        <Space>
          <Button onClick={() => setTable((v) => !v)}>
            {table ? "画布视图" : "表格视图"}
          </Button>
          <Button onClick={restoreLayout}>读取本地布局</Button>
          <Button onClick={saveLayout}>保存本地布局</Button>
        </Space>
      </div>
      {view === "策略模板" ? (
        <Table<any>
          rowKey="id"
          dataSource={templates}
          columns={[
            { title: "节点", dataIndex: "id" },
            {
              title: "模板ID",
              render: (_, r: any) => r.data.source.data.template.id,
            },
            {
              title: "模板名称",
              render: (_, r: any) => r.data.source.data.name || "策略模板",
            },
            {
              title: "内部节点数",
              render: (_, r: any) =>
                r.data.source.data.template.nodes?.length || 0,
            },
            {
              title: "详情",
              render: (_, r: any) => (
                <Button type="link" onClick={() => setSelected(r)}>
                  查看模板配置
                </Button>
              ),
            },
          ]}
        />
      ) : view === "版本管理" ? (
        <GraphVersions
          id={id}
          kind={kind}
          current={archive.graph.version}
          versions={archive.versions || []}
        />
      ) : table ? (
        <SourceConfigTable
          readOnly={historical}
          items={historical ? historicConfs : config?.items || []}
        />
      ) : !graph ? (
        <Empty description="来源对象没有决策树" />
      ) : (
        <div className="source-graph-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            deleteKeyCode={null}
            fitView
            minZoom={0.02}
            maxZoom={2}
            onNodeClick={(_, node) => setSelected(node)}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      )}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(undefined)}
        width="min(1300px,90vw)"
        title={
          selected ? `${selected.id} - ${selected.data.label}` : "节点详情"
        }
        extra={selected && <RawData value={selected.data.source} />}
      >
        {selected && (
          <Section title="基本信息">
            <p>名称：{selected.data.label}</p>
            <p>备注：{selected.data.source.data?.remark || "—"}</p>
          </Section>
        )}
        {selected && (
          <Tabs
            items={[
              {
                key: "rules",
                label: `规则（${nodeConfs(selected.id).filter((c) => !c.groupId).length}条）`,
                children: (
                  <SourceConfigTable
                    sceneId={id}
                    readOnly={historical}
                    items={nodeConfs(selected.id).filter((c) => !c.groupId)}
                  />
                ),
              },
              {
                key: "groups",
                label: `规则组（${
                  new Set(
                    nodeConfs(selected.id)
                      .filter((c) => c.groupId)
                      .map((c) => c.groupId),
                  ).size
                }条）`,
                children: (
                  <Table<any>
                    rowKey="id"
                    dataSource={Array.from(
                      new Set(
                        nodeConfs(selected.id)
                          .filter((c) => c.groupId)
                          .map((c) => c.groupId),
                      ),
                    ).map((groupId) => ({
                      id: groupId,
                      items: nodeConfs(selected.id).filter(
                        (c) => c.groupId === groupId,
                      ),
                    }))}
                    columns={[
                      {
                        title: "规则组",
                        render: (_, r) => (
                          <Link target="_blank" to={"/rulesGroup?id=" + r.id}>
                            {r.id} {r.items[0]?.ruleGroupName}
                          </Link>
                        ),
                      },
                      { title: "规则数", render: (_, r) => r.items.length },
                    ]}
                    expandable={{
                      expandedRowRender: (r) => (
                        <SourceConfigTable
                          sceneId={id}
                          readOnly={historical}
                          items={r.items}
                        />
                      ),
                    }}
                  />
                ),
              },
              {
                key: "router",
                label: "路由条件",
                children: (
                  selected.data.source.data?.routerConditions || []
                ).map((c: any, i: number) => (
                  <Section key={i} title={c.label || "条件 " + (i + 1)}>
                    <Conditions conditions={c.ruleConditions} />
                    <pre className="code-editor">
                      {c.expression || c.interactiveExp}
                    </pre>
                    <RawData value={c} />
                  </Section>
                )),
              },
              {
                key: "short",
                label: "短路配置",
                children: (
                  <ObjectDetails
                    value={selected.data.source.data?.shortCircuit}
                  />
                ),
              },
              {
                key: "decision",
                label: "决策配置",
                children: (
                  <ObjectDetails
                    value={{
                      decisionNodeConf:
                        selected.data.source.data?.decisionNodeConf,
                      decisionNodeResult:
                        selected.data.source.data?.decisionNodeResult,
                      decisionOverview:
                        selected.data.source.data?.decisionOverview,
                    }}
                  />
                ),
              },
              {
                key: "template",
                label: "模板与节点属性",
                children: <ObjectDetails value={selected.data.source} />,
              },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
