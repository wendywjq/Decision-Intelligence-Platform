import { FeatureDetailContent, RuleUsage } from "./SourceSecondary";
import { formatDate } from "./date";
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
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tree,
} from "antd";
import {
  ArrowLeftOutlined,
  CopyOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, entityPath } from "./api";
import { EntityEditor, PageHeader, Section, useRemote } from "./components";
import { moduleMap, type Row } from "./catalog";
export function SourceNotice() {
  return (
    <Alert
      type="info"
      showIcon
      message="Zeus 来源快照 · 所有修改仅保存到本地数据库，不会写回源平台。"
    />
  );
}
export function RawData({
  value,
  title = "完整来源数据",
}: {
  value: any;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const json = JSON.stringify(value, null, 2) || "";
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        {title}
      </Button>
      <Modal
        width="85vw"
        title={title}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Input.Search
          placeholder="查找字段或内容"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <pre className="source-json">
          {q
            ? json
                .split("\n")
                .filter((l) => l.toLowerCase().includes(q.toLowerCase()))
                .join("\n")
            : json}
        </pre>
        <Button
          icon={<CopyOutlined />}
          onClick={() => navigator.clipboard.writeText(json)}
        >
          复制JSON
        </Button>
      </Modal>
    </>
  );
}
function Value({ value }: { value: any }) {
  if (value === null || value === undefined)
    return <span className="muted">—</span>;
  if (typeof value === "object")
    return (
      <RawData
        value={value}
        title={
          Array.isArray(value) ? `${value.length} 项 · 查看内容` : "查看配置"
        }
      />
    );
  return <span className="source-value">{String(value)}</span>;
}
export function ObjectDetails({ value }: { value: any }) {
  if (!value) return <Empty />;
  return (
    <Descriptions
      bordered
      column={2}
      size="small"
      items={Object.entries(value).map(([key, value]) => ({
        key,
        label: key,
        children: <Value value={value} />,
      }))}
    />
  );
}
export function Conditions({ conditions = [] }: { conditions?: any[] }) {
  if (typeof conditions === "string") {
    try {
      conditions = JSON.parse(conditions);
    } catch {
      conditions = [];
    }
  }
  if (!Array.isArray(conditions)) conditions = [];
  const parse = (value: any) => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  const variable = (value: any): string => {
    const p = parse(value);
    if (Array.isArray(p)) return p.map(variable).join(", ");
    if (p && typeof p === "object") {
      if (p.funcName)
        return `${p.funcAlias || p.funcName}(${(p.params || []).map(variable).join(", ")})`;
      return p.alias
        ? `${p.alias}${p.value && p.alias !== p.value ? " · " + p.value : ""}`
        : String(p.value ?? JSON.stringify(p));
    }
    return p === null || p === undefined ? "—" : String(p);
  };
  return (
    <Table<any>
      rowKey={(r, i) => String(r.index ?? i)}
      size="small"
      pagination={false}
      dataSource={conditions}
      columns={[
        { title: "条件", dataIndex: "index", width: 75 },
        {
          title: "左变量",
          dataIndex: "leftParamValue",
          render: (v) => <span className="source-value">{variable(v)}</span>,
        },
        {
          title: "操作符",
          dataIndex: "operatorName",
          width: 140,
          render: (v) =>
            (
              ({
                greaterEqual: "大于等于 ≥",
                lessEqual: "小于等于 ≤",
                greater: "大于 >",
                less: "小于 <",
                equal: "等于",
                notEqual: "不等于",
                contain: "包含",
                notContain: "不包含",
              }) as any
            )[v] || v,
        },
        {
          title: "右变量",
          dataIndex: "rightParamValue",
          render: (v) => <span className="source-value">{variable(v)}</span>,
        },
        {
          title: "详细配置",
          render: (_, r) => <RawData value={r} title="条件详情" />,
        },
      ]}
    />
  );
}
export function SourceConfigTable({
  items,
  groupColumn = true,
  readOnly = false,
}: {
  items: any[];
  groupColumn?: boolean;
  readOnly?: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>();
  const [edit, setEdit] = useState<any>();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [local, setLocal] = useState<Record<string, any>>({});
  const rows = items
    .map((r) => ({ ...r, ...local[r.id] }))
    .filter(
      (r) =>
        (!q ||
          `${r.ruleId} ${r.rule?.name || r.name} ${r.ruleGroupName || ""}`
            .toLowerCase()
            .includes(q.toLowerCase())) &&
        (!status || r.status === status),
    );
  return (
    <>
      <div className="source-table-filters">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索规则ID、名称或规则组"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          allowClear
          placeholder="全部状态"
          value={status}
          onChange={setStatus}
          style={{ width: 140 }}
          options={["生效", "标记", "灰度", "离线"].map((value) => ({
            value,
            label: value,
          }))}
        />
        <span className="muted">共 {rows.length} 条配置</span>
      </div>
      <Table<any>
        rowKey="id"
        size="small"
        dataSource={rows}
        scroll={{ x: 1050 }}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (n) => `共 ${n} 条`,
        }}
        columns={[
          { title: "配置ID", dataIndex: "sourceConfId", width: 110 },
          {
            title: "规则/规则组",
            render: (_, r) => (
              <>
                <Link
                  target="_blank"
                  rel="noopener noreferrer"
                  to={"/ruleDetails?id=" + r.ruleId}
                >
                  {r.ruleId}-{r.rule?.name || r.name || r.ruleName}
                </Link>
                <div className="secondary-name">
                  {r.rule?.enName || r.ruleName}
                </div>
                {groupColumn && r.groupId > 0 && (
                  <div className="secondary-name">
                    规则组：{r.groupId} {r.ruleGroupName}
                  </div>
                )}
              </>
            ),
          },
          {
            title: "决策/附加信息/理由/衍生参数",
            render: (_, r) => (
              <>
                <span>{r.decision || r.decisionId}</span>
                <div className="secondary-name">
                  {r.extraInfoName ||
                    r.extraInfo ||
                    `附加信息 ${r.extraInfoId || 0}`}
                </div>
                <div className="secondary-name">
                  {r.reasonName || r.reason || "无理由"}
                  {r.derivedParamsId ? ` / 衍生参数 ${r.derivedParamsId}` : ""}
                </div>
              </>
            ),
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 80,
            render: (v) => (
              <Tag
                color={
                  v === "生效" ? "green" : v === "标记" ? "blue" : "default"
                }
              >
                {v}
              </Tag>
            ),
          },
          { title: "优先级", dataIndex: "priority", width: 80 },
          {
            title: "最后修改",
            render: (_, r) => (
              <>
                {formatDate(r.updatedAt)}
                <div>{r.modifier}</div>
              </>
            ),
          },
          {
            title: "操作",
            width: 150,
            render: (_, r) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  disabled={readOnly}
                  onClick={() => {
                    setEdit(r);
                    form.setFieldsValue(r);
                  }}
                >
                  编辑
                </Button>
                <RawData value={r} title="详情" />
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="编辑本地策略配置"
        open={!!edit}
        onCancel={() => setEdit(undefined)}
        onOk={async () => {
          try {
            const v = await form.validateFields();
            await api(
              "/source/config/" + encodeURIComponent(edit.id),
              "PUT",
              v,
            );
            setLocal((old) => ({ ...old, [edit.id]: v }));
            setEdit(undefined);
            message.success("本地配置已保存");
          } catch (e: any) {
            if (!e.errorFields) message.error(e.message);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="status" label="状态">
            <Select
              options={["生效", "标记", "灰度", "离线"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="decision" label="决策">
            <Input />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function ImportedSceneRules({
  module,
  id,
}: {
  module: string;
  id: number;
}) {
  const { data, error } = useRemote<{ items: any[] }>(
    "/source/configs/" + module + "/" + id,
  );
  const [flat, setFlat] = useState(false);
  const [groupQuery, setGroupQuery] = useState("");
  const groups = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const r of data?.items || []) {
      const group = r.groupId || 0;
      map.set(group, [...(map.get(group) || []), r]);
    }
    return [...map].map(([id, items]) => ({
      id,
      name: id ? items[0].ruleGroupName || "规则组 " + id : "直挂规则",
      items,
      count: items.length,
    }));
  }, [data]);
  if (error) return <Alert type="error" message={error} />;
  if (!data) return <Spin />;
  return (
    <div className="source-nested">
      <div className="source-nested-heading">
        <Space>
          <b>{module === "rulesGroup" ? "规则组配置" : "场景策略配置"}</b>
          <Tag>{data.items.length} 条规则配置</Tag>
          <Tag>{groups.filter((g) => g.id).length} 个规则组</Tag>
        </Space>
        <Space>
          <Input
            placeholder="搜索规则组"
            allowClear
            value={groupQuery}
            onChange={(e) => setGroupQuery(e.target.value)}
          />
          <Button onClick={() => setFlat((v) => !v)}>
            {flat ? "分组展示" : "平铺展示"}
          </Button>
        </Space>
      </div>
      {flat || module === "rulesGroup" ? (
        <SourceConfigTable items={data.items} />
      ) : (
        <Table<any>
          rowKey="id"
          size="small"
          dataSource={groups.filter(
            (g) => !groupQuery || `${g.id} ${g.name}`.includes(groupQuery),
          )}
          pagination={{ pageSize: 15, showTotal: (n) => `共 ${n} 组` }}
          columns={[
            {
              title: "类型",
              width: 100,
              render: (_, r) => (r.id ? "规则组" : "规则"),
            },
            {
              title: "规则/规则组",
              render: (_, r) => (
                <>
                  <Link to={"/rulesGroup?id=" + r.id}>
                    {r.id || ""} {r.name}
                  </Link>
                </>
              ),
            },
            { title: "规则配置数", dataIndex: "count", width: 140 },
          ]}
          expandable={{
            expandedRowRender: (r) => (
              <SourceConfigTable items={r.items} groupColumn={false} />
            ),
            expandRowByClick: true,
          }}
        />
      )}
    </div>
  );
}
export function ImportedRulePage({ id, row }: { id: number; row: Row }) {
  const navigate = useNavigate();
  const { data, error } = useRemote<any>("/source/archive/rule/" + id);
  const refs = useRemote<{ items: Row[] }>("/source/rules/" + id + "/features");
  const usage = useRemote<{ items: any[] }>(
    "/source/rules/" + id + "/references",
  );
  const metadata = useRemote<any>("/source/rules/" + id + "/metadata");
  const [display, setDisplay] = useState("交互式");
  const [edit, setEdit] = useState(false);
  const rule = data?.logic || data?.detail?.basicInfo?.rule;
  const detail = data?.detail;
  const current = detail?.basicInfo;
  const conditions =
    rule?.ruleConditions || current?.rule?.ruleConditions || [];
  if (error) return <Alert type="error" message={error} />;
  if (!rule) return <Spin />;
  return (
    <>
      <PageHeader title="规则详情">
        <Button onClick={() => setEdit(true)}>编辑属性信息</Button>
        <RawData value={data} />
      </PageHeader>
      <div className="detail-status">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/rulePage")}
        >
          返回规则列表
        </Button>
        <Tag color="green">{row.status}</Tag>
        <span className="muted">
          来源版本 {rule.versionId || current?.rule?.versionId || "当前快照"}
        </span>
      </div>
      <SourceNotice />
      <Tabs
        items={[
          {
            key: "basic",
            label: "基本信息",
            children: (
              <>
                <Section title="逻辑信息">
                  <Descriptions
                    column={3}
                    items={[
                      { key: "id", label: "ID", children: id },
                      { key: "name", label: "中文名称", children: row.name },
                      { key: "en", label: "英文名称", children: rule.name },
                      {
                        key: "owner",
                        label: "修改人",
                        children: rule.modifier,
                      },
                      {
                        key: "mode",
                        label: "编辑模式",
                        children:
                          ({ 7: "交互式", 8: "决策表", 9: "代码模式" } as any)[
                            rule.editMode
                          ] || rule.editMode,
                      },
                      {
                        key: "remark",
                        label: "备注",
                        children: rule.ruleRemark || "—",
                      },
                    ]}
                  />
                  <Tabs
                    activeKey={display}
                    onChange={setDisplay}
                    items={["交互式", "表达式", "解析信息"].map((label) => ({
                      key: label,
                      label,
                    }))}
                  />
                  {display === "交互式" ? (
                    <>
                      <Conditions conditions={conditions} />
                      <div className="condition-logic">
                        条件间逻辑：<code>{rule.expression}</code>
                      </div>
                    </>
                  ) : (
                    <pre className="code-editor">
                      {display === "表达式"
                        ? row.expression
                        : typeof rule.parsedExpInfo === "string"
                          ? rule.parsedExpInfo
                          : JSON.stringify(rule.parsedExpInfo, null, 2)}
                    </pre>
                  )}
                </Section>
                <Section title="测试用例列表">
                  <Table<any>
                    rowKey={(r, i) => String(r.id ?? i)}
                    dataSource={current?.testCaseList || []}
                    columns={[
                      {
                        title: "输入",
                        render: (_, r) => (
                          <RawData value={r} title="查看测试数据" />
                        ),
                      },
                      { title: "模式", dataIndex: "mode" },
                      { title: "期望输出", dataIndex: "expectResult" },
                      { title: "实际输出", dataIndex: "actualResult" },
                    ]}
                    locale={{ emptyText: "该来源快照未包含历史测试用例" }}
                  />
                </Section>
                <Section title="标签">
                  <Space wrap>
                    {(metadata.data?.tags || []).map((t: any) => (
                      <Tag key={t.id} color={t.objType === 5 ? "red" : "blue"}>
                        {t.name}
                      </Tag>
                    ))}
                  </Space>
                  {current?.tagList && (
                    <RawData value={current.tagList} title="完整标签配置" />
                  )}
                </Section>
                <Section title="添加话术">
                  <ObjectDetails value={current?.ruleKefu || {}} />
                </Section>
              </>
            ),
          },
          {
            key: "features",
            label: `引用特征信息（${refs.data?.items.length || 0}）`,
            children: <FeatureList items={refs.data?.items || []} />,
          },
          {
            key: "versions",
            label: "版本信息",
            children: (
              <Table<any>
                rowKey={(r, i) => String(r.id ?? i)}
                dataSource={detail?.versionInfo || []}
                columns={[
                  { title: "版本", dataIndex: "version_id" },
                  { title: "创建人", dataIndex: "creator" },
                  { title: "表达式", dataIndex: "expression" },
                  { title: "详情", render: (_, r) => <RawData value={r} /> },
                ]}
              />
            ),
          },
          {
            key: "usage",
            label: "被引用情况",
            children: <RuleUsage id={id} items={usage.data?.items || []} />,
          },
        ]}
      />
      <EntityEditor
        module={moduleMap.rulePage}
        row={row}
        open={edit}
        onClose={() => setEdit(false)}
        onSaved={() => location.reload()}
      />
    </>
  );
}
export function FeatureList({ items }: { items: Row[] }) {
  return (
    <Table<any>
      rowKey="id"
      dataSource={items}
      columns={[
        { title: "特征ID", render: (_, r) => r.sourceId || r.id },
        {
          title: "名称",
          render: (_, r) => (
            <Link to={"/featureDetails?id=" + r.id}>
              {r.name}
              <div className="secondary-name">{r.enName}</div>
            </Link>
          ),
        },
        { title: "特征类型", dataIndex: "type" },
        { title: "结果类型", dataIndex: "dataType" },
        { title: "状态", dataIndex: "status" },
      ]}
    />
  );
}
export function ImportedFeaturePage() {
  const [params] = useSearchParams();
  const id = Number(params.get("id"));
  const { data: row, error } = useRemote<Row>(entityPath("featureService", id));
  return error ? (
    <Alert type="error" message={error} />
  ) : row ? (
    <ImportedFeature row={row} />
  ) : (
    <Spin />
  );
}
export function ImportedFeature({ row }: { row: Row }) {
  return <FeatureDetailContent row={row} />;
}

export function RiskTagExplorer() {
  const { data, loading } = useRemote<{ items: any[] }>("/source/risk-tags");
  const [selected, setSelected] = useState<number>();
  const [q, setQ] = useState("");
  const items = data?.items || [];
  const byParent = new Map<number, any[]>();
  for (const t of items)
    byParent.set(t.parentId || 0, [
      ...(byParent.get(t.parentId || 0) || []),
      t,
    ]);
  const nodes = (id: number, ancestors: number[] = []): any[] =>
    ancestors.includes(id)
      ? []
      : (byParent.get(id) || []).map((t) => ({
          key: t.id,
          title: `${t.name} (${t.tagCode || t.id})`,
          children: nodes(t.id, [...ancestors, id]),
        }));
  const roots = items.filter((t) => !items.some((p) => p.id === t.parentId));
  const tree = roots.map((t) => ({
    key: t.id,
    title: t.name,
    children: nodes(t.id),
  }));
  const allowed = new Set<number>();
  const visit = (id: number) => {
    if (allowed.has(id)) return;
    allowed.add(id);
    for (const c of byParent.get(id) || []) visit(c.id);
  };
  if (selected) visit(selected);
  const rows = items.filter(
    (t) =>
      (!selected || allowed.has(t.id)) &&
      (!q ||
        `${t.id} ${t.name} ${t.tagCode}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <>
      <div className="source-table-filters">
        <Input.Search
          placeholder="搜索全部风险标签的ID、名称或编码"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Tag>全部 {items.length} 个风险标签</Tag>
        <Button onClick={() => setSelected(undefined)}>显示全部</Button>
      </div>
      <div className="risk-tag-layout">
        <div className="risk-tag-tree">
          <Tree
            treeData={tree}
            selectedKeys={selected ? [selected] : []}
            onSelect={(keys) => setSelected(keys[0] as number)}
          />
        </div>
        <Table<any>
          loading={loading}
          rowKey="id"
          dataSource={rows}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            showTotal: (n) => `共 ${n} 条`,
          }}
          columns={[
            { title: "标签ID", dataIndex: "id" },
            { title: "标签名称", dataIndex: "name" },
            { title: "编码", dataIndex: "tagCode" },
            {
              title: "父标签",
              render: (_, r) =>
                items.find((t) => t.id === r.parentId)?.name || "根标签",
            },
            { title: "优先级", dataIndex: "priority" },
            { title: "详情", render: (_, r) => <RawData value={r} /> },
          ]}
        />
      </div>
    </>
  );
}
