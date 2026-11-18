import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
} from "antd";
import { Link, useNavigate } from "react-router-dom";
import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import { api, entityPath } from "./api";
import { PageHeader, Section, useRemote, EntityEditor } from "./components";
import { FeatureList, RawData, SourceNotice } from "./SourceExamples";
import { moduleMap, type Row } from "./catalog";
import { formatDate } from "./date";
const route = (type: string, id: number) =>
  type === "rulePage"
    ? "/ruleDetails?id=" + id
    : type === "layerScene"
      ? "/layerScene/detail?id=" + id
      : type === "graphTemplate"
        ? "/layerScene/template/detail?id=" + id
        : "/" + type + "?id=" + id;
export function RuleUsage({ id, items }: { id: number; items: any[] }) {
  const [type, setType] = useState("scene"),
    [q, setQ] = useState(""),
    [status, setStatus] = useState<string>();
  const detail = useRemote<any>("/source/detail-rule/" + id + "?type=" + type);
  const remote = detail.data?.references?.[type];
  const labels: any = {
    scene: "场景",
    rulesGroup: "规则组",
    layerScene: "分层场景",
    graphTemplate: "策略模板",
    paint: "画布",
    rulePage: "规则",
  };
  const flatten = (source: any) => {
    const result: any[] = [];
    if (type === "rulePage")
      return (source.ruleList || []).map((r: any, i: number) => ({
        id: "referencing-rule:" + i,
        scene_module: type,
        scene_id: r.id,
        name: r.alias || r.name,
        conf: {
          ...r,
          status:
            ({ 64: "生效", 32: "标记", 0: "离线" } as any)[r.status] ||
            String(r.status),
          updatedAt: r.modtime,
        },
      }));
    function walk(value: any, context: any = {}) {
      if (Array.isArray(value)) {
        value.forEach((v) => walk(v, context));
        return;
      }
      if (!value || typeof value !== "object") return;
      const next = {
        ...context,
        scene_id:
          value.sceneId ||
          value.graphSceneId ||
          value.ruleGroupId ||
          context.scene_id,
        name:
          value.sceneName ||
          value.graphSceneName ||
          value.ruleGroupName ||
          context.name,
        node_id: value.nodeId || value.nodeIndex || context.node_id,
        group_id: value.ruleGroupId || context.group_id,
      };
      if (value.ruleId && Number(value.ruleId) === id) {
        result.push({
          ...next,
          id: "global:" + result.length,
          scene_module: type,
          conf: {
            ...value,
            status:
              ({ 64: "生效", 32: "标记", 0: "离线" } as any)[value.status] ||
              String(value.status),
            updatedAt: value.modtime,
          },
        });
      }
      Object.entries(value).forEach(([key, v]) => {
        if (typeof v === "object") walk(v, next);
      });
    }
    walk(source);
    return result;
  };
  const all: any[] = remote
    ? flatten(remote)
    : items.filter((r) => r.scene_module === type);
  const filtered = all.filter(
    (r) =>
      (!q ||
        `${r.scene_id} ${r.name} ${r.group_id} ${r.conf.ruleGroupName || ""}`.includes(
          q,
        )) &&
      (!status || r.conf.status === status),
  );

  return (
    <Section title="被引用情况">
      <Tabs
        activeKey={type}
        onChange={setType}
        items={Object.entries(labels).map(([key, label]) => ({
          key,
          label: `${label}（${(() => {
            const count = detail.data?.counts?.[key];
            if (count !== undefined) return count;
            const g = detail.data?.references?.[key];
            return g
              ? (g.sceneTotal ??
                  g.rule_group_total ??
                  g.graphSceneTotal ??
                  g.canvas_total ??
                  g.rule_total ??
                  0)
              : items.filter((r) => r.scene_module === key).length;
          })()}）`,
        }))}
      />
      <div className="source-table-filters">
        <Input.Search
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ID / 名称 / 规则组"
          allowClear
        />
        <Select
          allowClear
          placeholder="配置状态"
          value={status}
          onChange={setStatus}
          options={["生效", "标记", "离线"].map((value) => ({
            value,
            label: value,
          }))}
        />
      </div>
      <Table<any>
        rowKey="id"
        dataSource={filtered}
        pagination={{ pageSize: 20, showTotal: (n) => `共 ${n} 条配置` }}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: labels[type] + "ID-名称",
            render: (_, r) => (
              <Link
                target="_blank"
                rel="noopener noreferrer"
                to={route(type, r.scene_id)}
              >
                {r.scene_id} - {r.name || r.conf.sceneName || "查看对象"}
              </Link>
            ),
          },
          {
            title: "规则组",
            render: (_, r) =>
              r.group_id ? (
                <Link target="_blank" to={"/rulesGroup?id=" + r.group_id}>
                  {r.group_id} {r.conf.ruleGroupName}
                </Link>
              ) : (
                "—"
              ),
          },
          { title: "节点", dataIndex: "node_id" },
          {
            title: "配置状态",
            render: (_, r) => (
              <Tag color={r.conf.status === "生效" ? "green" : "default"}>
                {r.conf.status}
              </Tag>
            ),
          },
          { title: "优先级", render: (_, r) => r.conf.priority },
          {
            title: "决策",
            render: (_, r) => r.conf.decisionName || r.conf.decision,
          },
          { title: "附加信息", render: (_, r) => r.conf.extraInfo || "—" },
          { title: "理由", render: (_, r) => r.conf.reason || "—" },
          { title: "更新时间", render: (_, r) => formatDate(r.conf.updatedAt) },
          {
            title: "操作",
            render: (_, r) => <RawData value={r.conf} title="配置详情" />,
          },
        ]}
      />
      {remote?._capture && !remote._capture.complete && (
        <Alert
          type="warning"
          showIcon
          message={`源端总数 ${remote._capture.reportedTotal}，完整分页实际返回 ${remote._capture.returnedConfigs} 条配置。保留全部响应，不补造差额。`}
        />
      )}
      <div className="muted">
        {remote
          ? "引用统计范围：Zeus 全局来源响应。"
          : "引用统计范围：当前已导入场景、规则组与模板。"}
        重复配置分别保留。
      </div>
      {remote && (
        <Section title="Zeus 全局被引用信息">
          <RawData value={remote} title="查看完整来源引用" />
        </Section>
      )}
    </Section>
  );
}
function JsonBlock({ value }: { value: any }) {
  return (
    <pre className="code-editor">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
export function FeatureDetailContent({ row }: { row: Row }) {
  const { data, error } = useRemote<any>("/source/archive/feature/" + row.id);
  const lineage = useRemote<any>("/source/features/" + row.id + "/lineage");
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState("basic");
  const f = data?.detail || {},
    l = lineage.data;
  let expression: any;
  try {
    expression = JSON.parse(f.expression || "{}");
  } catch {
    expression = {};
  }
  const props: any = {
    特征ID: row.sourceId || row.id,
    特征类型:
      row.sourceKind === "param"
        ? f.type === 8
          ? "RPC特征"
          : "原始特征"
        : (
            {
              基础因子: "原始特征",
              衍生因子: "衍生特征",
              累计因子: "累计特征",
              扩展因子: "KV特征",
              模型因子: "模型特征",
            } as any
          )[row.type || ""] || row.type,
    风险域: "内容安全",
    中文名称: row.name,
    英文名称: row.enName,
    特征说明: f.description || f.remark || "—",
    值域管理: f.valueManageSwitch ? "是" : "否",
  };
  const fields = (v: any) => (
    <Descriptions
      bordered={false}
      column={1}
      labelStyle={{ width: 130 }}
      items={Object.entries(v).map(([label, value]) => ({
        key: label,
        label,
        children:
          typeof value === "object" ? (
            <JsonBlock value={value} />
          ) : (
            String(value ?? "—")
          ),
      }))}
    />
  );
  return (
    <>
      <PageHeader title="特征详情">
        <Tag color="green">状态：{row.status}</Tag>
        <Button onClick={() => nav("/featureService")}>返回列表</Button>
        <Button type="primary" onClick={() => setEdit(true)}>
          编辑
        </Button>
      </PageHeader>
      {error && <Alert message={error} type="error" />}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "basic",
            label: "基本信息",
            children: (
              <div className="feature-detail-layout">
                <div>
                  <Section title="属性信息">{fields(props)}</Section>
                  <Section title="逻辑信息">
                    {fields({
                      结果类型: row.dataType,
                      依赖特征: f.paramList || f.param_list || "—",
                    })}
                    {row.type === "模型因子" || data?.model ? (
                      <>
                        {fields({
                          模型服务:
                            data?.model?.id || expression.modelId || "—",
                          参数映射: expression,
                        })}
                      </>
                    ) : (
                      <JsonBlock
                        value={
                          row.expression ||
                          f.expression ||
                          "原始特征，无计算表达式"
                        }
                      />
                    )}
                  </Section>
                  {l?.fetcher && (
                    <Section title="数据接口">
                      <FetcherSummary item={l.fetcher} />
                      <Link
                        target="_blank"
                        to={"/fetcher/edit?id=" + l.fetcher.id}
                      >
                        查看接口详情
                      </Link>
                    </Section>
                  )}
                  <Section title="归属信息">
                    {fields({
                      创建人: f.creator,
                      创建时间: formatDate(f.addtime),
                      修改人: f.modifier,
                      修改时间: formatDate(f.modtime),
                      管理员: f.owners || row.owner,
                    })}
                  </Section>
                  <RawData value={data} title="完整特征属性" />
                </div>
                <aside>
                  <Section title="特征应用管理">
                    <p>已导入规则引用：{l?.rules?.length || 0}</p>
                    <Button type="link" onClick={() => setTab("lineage")}>
                      查看被引用情况
                    </Button>
                  </Section>
                  <Section title="值域分布 TOP10">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="快照未包含线上流量分布"
                    />
                  </Section>
                </aside>
              </div>
            ),
          },
          {
            key: "lineage",
            label: "特征血缘",
            children: l ? <FeatureLineage data={l} /> : <Spin />,
          },
          {
            key: "rpc",
            label: "数据接口",
            children: l?.fetcher ? (
              <>
                <FetcherSummary item={l.fetcher} />
                <Section title="输入参数映射">
                  <MappingTable values={l.dependency?.inputDependentConfig} />
                </Section>
                <Section title="输出参数映射">
                  <MappingTable values={l.dependency?.outputDependentConfig} />
                </Section>
                <Button
                  onClick={() =>
                    window.open(
                      "/#/fetcher/edit?id=" + l.fetcher.id,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  接口详情
                </Button>
              </>
            ) : (
              <Empty
                description={
                  f.type === 8
                    ? "该接口映射尚未包含在来源快照中"
                    : "该特征未直接绑定数据接口"
                }
              />
            ),
          },
          {
            key: "versions",
            label: "特征版本",
            children: (
              <Table
                rowKey="id"
                dataSource={[f]}
                columns={[
                  {
                    title: "版本",
                    render: () => f.version || f.versionId || "采集时生效定义",
                  },
                  { title: "状态", render: () => row.status },
                  { title: "创建人", dataIndex: "creator" },
                  { title: "修改人", dataIndex: "modifier" },
                  { title: "更新时间", render: () => formatDate(f.modtime) },
                  {
                    title: "操作",
                    render: () => <RawData value={data} title="查看定义" />,
                  },
                ]}
              />
            ),
          },
        ]}
      />
      <EntityEditor
        module={moduleMap.featureService}
        row={row}
        open={edit}
        onClose={() => setEdit(false)}
        onSaved={() => location.reload()}
      />
    </>
  );
}
export function MappingTable({ values }: { values: any }) {
  let parsed = values;
  try {
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {}
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed).map(([key, value]) => ({ key, value }))
      : [];
  const definitions = rows.some((r: any) => r.name !== undefined);
  return (
    <Table<any>
      size="small"
      rowKey={(_, i) => String(i)}
      pagination={false}
      dataSource={rows}
      columns={
        definitions
          ? [
              { title: "参数名称", dataIndex: "name" },
              { title: "参数类型", dataIndex: "type" },
              {
                title: "方向",
                render: (_, r) =>
                  [r.inputParam ? "入参" : "", r.outputParam ? "出参" : ""]
                    .filter(Boolean)
                    .join(" / "),
              },
              { title: "必填", render: (_, r) => (r.required ? "是" : "否") },
              { title: "无效值", dataIndex: "invalidValues" },
              { title: "有效值", dataIndex: "validValues" },
              { title: "描述", dataIndex: "comment" },
            ]
          : [
              { title: "接口参数", dataIndex: "key" },
              {
                title: "特征映射",
                render: (_, r) =>
                  typeof r.value === "object" ? (
                    <RawData value={r.value} title="映射配置" />
                  ) : (
                    String(r.value ?? "—")
                  ),
              },
            ]
      }
    />
  );
}

function FeatureLineage({ data }: { data: any }) {
  const [kind, setKind] = useState("upstream"),
    [q, setQ] = useState("");
  const list = (data[kind] || []).filter(
    (r: any) => !q || `${r.id} ${r.name} ${r.enName}`.includes(q),
  );
  const graph = useMemo(() => {
    const nodes = data.nodes.map((n: any, i: number) => ({
      id: n.id,
      position: {
        x: n.root
          ? 650
          : n.direction === "downstream"
            ? 1000 + (i % 2) * 280
            : 70 + (i % 2) * 280,
        y: n.root ? 200 : 50 + Math.floor(i / 2) * 180,
      },
      data: {
        label: (
          <>
            <b>{n.name}</b>
            <div>{n.enName}</div>
            <Tag>{n.type}</Tag>
          </>
        ),
      },
      style: {
        width: 240,
        borderColor: n.root ? "#3977eb" : "#ccd3de",
        background: n.root ? "#edf4ff" : "white",
      },
    }));
    return {
      nodes,
      edges: data.edges.map((e: any, i: number) => ({
        ...e,
        id: String(i),
        markerEnd: { type: MarkerType.ArrowClosed },
        type: "smoothstep",
      })),
    };
  }, [data]);
  return (
    <>
      <Tabs
        activeKey={kind}
        onChange={setKind}
        items={[
          { key: "upstream", label: `依赖情况（${data.upstream.length}）` },
          {
            key: "downstream",
            label: `被引用情况（${data.downstream.length + data.rules.length}）`,
          },
          { key: "graph", label: "血缘拓扑图" },
        ]}
      />
      {kind === "graph" ? (
        <div className="lineage-canvas">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            fitView
            nodesDraggable={true}
            onNodeClick={(_, node) =>
              window.open(
                node.id.startsWith("rule:")
                  ? "/#/ruleDetails?id=" + node.id.slice(5)
                  : "/#/featureDetails?id=" + node.id,
                "_blank",
                "noopener",
              )
            }
          >
            <Controls />
            <Background />
          </ReactFlow>
        </div>
      ) : (
        <>
          <Input.Search
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索特征 ID / 名称"
          />
          <FeatureList items={list} />
          {kind === "downstream" && (
            <Section title="引用规则">
              <Table<any>
                rowKey="id"
                dataSource={data.rules.filter(
                  (r: any) => !q || `${r.id} ${r.name}`.includes(q),
                )}
                columns={[
                  { title: "规则ID", dataIndex: "id" },
                  {
                    title: "名称",
                    render: (_, r) => (
                      <Link target="_blank" to={"/ruleDetails?id=" + r.id}>
                        {r.name}
                      </Link>
                    ),
                  },
                  { title: "英文名称", dataIndex: "enName" },
                  { title: "状态", dataIndex: "status" },
                ]}
              />
            </Section>
          )}
        </>
      )}
      <div className="muted">
        范围：{data.scope}；拓扑展开至 4 层，依赖环路不重复展开。
      </div>
    </>
  );
}
export function FetcherSummary({ item }: { item: any }) {
  const f = item.detail || item;
  return (
    <Descriptions
      bordered
      column={2}
      items={Object.entries({
        接口ID: f.id,
        接口名称: f.name,
        AppID: f.appId,
        调用方式: f.callMethod,
        "超时（ms）": f.timeout,
        状态: f.status === 64 ? "生效" : f.status,
        负责人: f.owners,
        描述: f.description,
        异步接口: f.asyncName,
        异步超时: f.asyncTimeout,
      }).map(([label, value]) => ({
        key: label,
        label,
        children: String(value ?? "—"),
      }))}
    />
  );
}
export function FetcherPage({ id }: { id: number }) {
  const { data, error } = useRemote<any>("/source/fetcher/" + id);
  return (
    <>
      <PageHeader title="数据接口详情">
        <Link to="/featureService">返回特征服务</Link>
      </PageHeader>
      {error ? (
        <Alert message={error} type="error" />
      ) : !data ? (
        <Spin />
      ) : (
        <Tabs
          items={[
            {
              key: "basic",
              label: "基本信息",
              children: (
                <>
                  <FetcherSummary item={data} />
                  <Section title="入参定义">
                    <MappingTable values={data.params} />
                  </Section>
                  <RawData value={data} />
                </>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
export function GraphInfoEditor({
  row,
  open,
  onClose,
  onSaved,
}: {
  row: Row;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  return (
    <Modal
      title="修改场景"
      open={open}
      onCancel={onClose}
      destroyOnClose
      onOk={async () => {
        try {
          const values = await form.validateFields();
          await api(entityPath("layerScene", row.id), "PUT", {
            ...row,
            ...values,
            owner: values.manager,
            description: values.remark,
            attrs: row.attrs,
          });
          message.success("场景信息已保存");
          onSaved();
          onClose();
        } catch (e: any) {
          if (e.message) message.error(e.message);
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: row.name,
          manager: row.owner,
          remark: row.description,
          recallMode: row.attrs?.recallMode || 0,
        }}
      >
        <Form.Item name="name" label="场景名称" rules={[{ required: true }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="manager" label="负责人" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={4} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
