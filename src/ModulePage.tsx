import { ChangeReview } from "./ChangeReview";
import { enterChangeEnvironment } from "./change-context";
import { RiskTagSelect } from "./RiskTagSelect";
import { DecisionDistribution } from "./RuleReferenceStats";
import { GroupRules } from "./GroupRules";
import { GraphInfoEditor } from "./SourceSecondary";
import { GraphVersionDrawer } from "./GraphVersions";
import { formatDate } from "./date";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import {
  DownOutlined,
  PlusSquareOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Module, Row } from "./catalog";
import {
  EntityEditor,
  FieldControl,
  PageHeader,
  Section,
  useRemote,
} from "./components";
import { api, entityPath } from "./api";
import { SceneRules } from "./SceneRules";
import { GraphEditor } from "./graph";
import {
  ImportedSceneRules,
  ImportedFeature,
  RiskTagExplorer,
} from "./SourceExamples";
import { ReleaseCreator } from "./SourceRelease";
import { ToolsPage } from "./ToolsPage";
export function ModulePage({ module: m }: { module: Module }) {
  const nav = useNavigate();
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const [graphInfo, setGraphInfo] = useState<Row>();
  const [graphVersion, setGraphVersion] = useState<Row>();
  const [releaseCreate, setReleaseCreate] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [tab, setTab] = useState(m.tabs?.[0]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [edit, setEdit] = useState<Row>();
  const [editor, setEditor] = useState(false);
  const [detail, setDetail] = useState<Row>();
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [flat, setFlat] = useState(false);
  const [searchMode, setSearchMode] = useState("模糊搜索");
  const [batchMode, setBatchMode] = useState(false);
  const [chart, setChart] = useState<Row>();
  useEffect(() => {
    if (params.get("id")) setFilters({ id: params.get("id")! });
  }, [params]);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(searchMode === "精确搜索" ? { searchMode: "exact" } : {}),
    ...(m.tabs && m.key !== "scene" ? { view: tab || m.tabs[0] } : {}),
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const { data, loading, error, reload } = useRemote<{
    items: Row[];
    total: number;
  }>(m.kind === "audit" ? "/audit" : entityPath(m.key) + "?" + query);
  const tools = [
    "investigate",
    "cumulative",
    "probe",
    "logConfig",
    "relation",
    "expression",
    "lineage",
    "health",
  ];
  const mutation = async (path: string, method = "POST", body?: any) => {
    try {
      await api(path, method, body);
      reload();
      message.success("操作成功");
    } catch (e: any) {
      message.error(e.message);
    }
  };
  function openDetail(r: Row) {
    if (r.sourceImported && m.kind === "graph") {
      nav(
        (r.sourceKind === "template"
          ? "/layerScene/template/detail"
          : "/layerScene/detail") +
          "?id=" +
          r.id,
      );
      return;
    }
    if (r.sourceImported && m.key === "fetcher") {
      nav("/fetcher/edit?id=" + r.id);
      return;
    }
    if (r.sourceImported && m.key === "featureService") {
      nav("/featureDetails?id=" + r.id);
      return;
    }
    if (r.sourceImported && m.kind === "release") {
      nav("/release/detail?id=" + r.id);
      return;
    }
    if (m.kind === "scene") return;
    else if (m.kind === "rule") nav("/ruleDetails?id=" + r.id);
    else if (m.kind === "analysis") setChart(r);
    else setDetail(r);
  }
  async function batch(action: string) {
    if (!selected.length) {
      setBatchMode(true);
      return message.info("请选择记录，再执行批量操作");
    }
    try {
      await Promise.all(
        (data?.items || [])
          .filter((r) => selected.includes(r.id))
          .map((r) =>
            api(entityPath(m.key, r.id), "PUT", { ...r, status: action }),
          ),
      );
      reload();
      setSelected([]);
      message.success("批量配置已更新");
    } catch (e: any) {
      message.error(e.message);
    }
  }
  const columns: any[] = [
    ...m.columns.map(([key, title]) => ({
      title,
      dataIndex: key,
      key,
      width:
        key === "id"
          ? 100
          : m.key === "scene" && ["owner", "type"].includes(key)
            ? 130
            : undefined,
      render: (v: any, r: Row) => {
        if (key === "referenceCount")
          return (
            <span>
              {r.ruleStats?.sourceReferenceCount ??
                r.ruleStats?.referenceCount ??
                0}
            </span>
          );
        if (key === "decisionDistribution")
          return <DecisionDistribution stats={r.ruleStats} />;
        if (key === "id" && m.key === "featureService") return r.sourceId || v;
        if (key === "name")
          return (
            <>
              <button
                className="text-link row-name"
                onClick={() => openDetail(r)}
              >
                {v}
              </button>
              {r.enName && <div className="secondary-name">{r.enName}</div>}
              {m.kind === "release" && (
                <div className="secondary-name">
                  变更任务ID:{r.id}, 变更人:{r.owner}
                </div>
              )}
            </>
          );
        if (key === "updatedAt" || key === "createdAt")
          return (
            <span>
              {formatDate(v)}
              <br />
              <span className="muted">{r.modifier || r.owner}</span>
            </span>
          );
        if (key === "status")
          return (
            <span className={"status status-" + (v === "生效" ? "on" : "off")}>
              {v || "—"}
            </span>
          );
        if (key === "progress")
          return (
            <div className="release-progress">
              <div>
                实验阶段{" "}
                <Tag color={r.phase === "实验" ? "blue" : "green"}>
                  {r.phase === "实验" ? "待启动" : "已完成"}
                </Tag>
              </div>
              <div>
                审批阶段{" "}
                <Tag>
                  {r.phase === "审批"
                    ? "待审批"
                    : ["灰度", "完成"].includes(r.phase)
                      ? "已通过"
                      : "待审批"}
                </Tag>
              </div>
              <div>
                灰度阶段{" "}
                <Tag>{r.progress ? `进度：${r.progress}%` : "待启动"}</Tag>
              </div>
            </div>
          );
        return Array.isArray(v)
          ? v.map((t) => <Tag key={t}>{t}</Tag>)
          : (v ?? "—");
      },
    })),
  ];
  if (m.create || m.kind === "scene" || m.kind === "audit")
    columns.push({
      title: m.kind === "release" ? "进度操作 / 信息操作" : "操作",
      key: "actions",
      width: m.kind === "release" ? 340 : 180,
      render: (_: any, r: Row) =>
        m.kind === "release" && r.sourceImported ? (
          <Space wrap>
            <Button
              size="small"
              onClick={() => nav("/release/detail?id=" + r.id)}
            >
              变更内容
            </Button>
            <Button
              size="small"
              onClick={() => nav("/release/experiment-detail?id=" + r.id)}
            >
              实验详情
            </Button>
            <Button
              size="small"
              onClick={() => nav("/release/gray-detail?id=" + r.id)}
            >
              灰度详情
            </Button>
          </Space>
        ) : m.kind === "release" ? (
          <Space wrap>
            <Button size="small" onClick={() => setDetail(r)}>
              变更内容
            </Button>
            {r.phase === "实验" && (
              <Button size="small" onClick={() => setDetail(r)}>
                去实验
              </Button>
            )}
            {r.phase === "审批" && (
              <Button size="small" onClick={() => setDetail(r)}>
                审批详情
              </Button>
            )}
            {r.phase === "灰度" && (
              <Button
                size="small"
                onClick={() =>
                  mutation("/releases/" + r.id + "/advance", "POST", {
                    action: "下一步",
                  })
                }
              >
                下一步
              </Button>
            )}
            {r.phase === "灰度" && (
              <Popconfirm
                title="中止本地示例变更？"
                onConfirm={() =>
                  mutation("/releases/" + r.id + "/advance", "POST", {
                    action: "中止",
                  })
                }
              >
                <Button size="small">中止</Button>
              </Popconfirm>
            )}
            {r.phase === "完成" && (
              <Popconfirm
                title="回滚本地示例变更？"
                onConfirm={() =>
                  mutation("/releases/" + r.id + "/advance", "POST", {
                    action: "回滚",
                  })
                }
              >
                <Button size="small">回滚</Button>
              </Popconfirm>
            )}
          </Space>
        ) : r.sourceImported && m.kind === "graph" ? (
          <Space direction="vertical" size={2}>
            <Button type="link" onClick={() => setGraphInfo(r)}>
              修改信息
            </Button>
            <Button type="link" onClick={() => setGraphVersion(r)}>
              版本管理
            </Button>
          </Space>
        ) : (
          <Space size={12}>
            <button
              className="text-link"
              onClick={() => {
                if (m.key === "rulesFuseList") nav("/rulesFuseAdd?id=" + r.id);
                else if (m.kind === "audit") setDetail(r);
                else {
                  setEdit(r);
                  setEditor(true);
                }
              }}
            >
              {m.kind === "scene"
                ? "设置"
                : m.kind === "audit"
                  ? "详情"
                  : "编辑"}
            </button>
            {m.kind !== "audit" && (
              <>
                <button
                  className="text-link"
                  onClick={() => mutation(entityPath(m.key, r.id) + "/copy")}
                >
                  复制
                </button>
                <Popconfirm
                  title={"确定删除“" + r.name + "”？"}
                  description="这会删除本地数据库中的该示例记录。"
                  onConfirm={() => mutation(entityPath(m.key, r.id), "DELETE")}
                >
                  <button className="text-link">删除</button>
                </Popconfirm>
              </>
            )}
          </Space>
        ),
    });
  if (tools.includes(m.kind || "")) return <ToolsPage module={m} />;
  const rows =
    m.kind === "audit"
      ? (data?.items || []).filter(
          (r) => !filters.q || `${r.entityId} ${r.name}`.includes(filters.q),
        )
      : data?.items || [];
  return (
    <>
      {graphInfo && (
        <GraphInfoEditor
          row={graphInfo}
          open={!!graphInfo}
          onClose={() => setGraphInfo(undefined)}
          onSaved={reload}
        />
      )}
      {graphVersion && (
        <GraphVersionDrawer
          id={graphVersion.id}
          kind={graphVersion.sourceKind === "template" ? "template" : "graph"}
          open={!!graphVersion}
          onClose={() => setGraphVersion(undefined)}
        />
      )}
      <PageHeader title={m.title}>
        {m.key === "featureService" && (
          <Button onClick={() => nav("/fetcher")}>数据接口</Button>
        )}
        {m.key === "release/list" && (
          <>
            <Button onClick={() => setFilters({ status: "已完成" })}>
              历史实验任务
            </Button>
            <Button onClick={() => setFilters({ status: "已完成" })}>
              历史发布任务
            </Button>
          </>
        )}
        {m.create && (
          <Button
            type="primary"
            icon={<PlusSquareOutlined />}
            onClick={() => {
              if (m.key === "rulesFuseList") {
                nav("/rulesFuseAdd");
                return;
              }
              if (m.kind === "release") {
                setReleaseCreate(true);
                return;
              }
              if (m.kind === "rule") {
                nav("/addRulePage");
                return;
              }
              setEdit(undefined);
              setEditor(true);
            }}
          >
            {m.create}
          </Button>
        )}
        {["scene", "tag"].includes(m.key) && (
          <Dropdown
            menu={{
              items: [
                { key: "生效", label: "批量生效" },
                { key: "标记", label: "批量标记" },
                { key: "停用", label: "批量停用" },
              ],
              onClick: ({ key }) => batch(key),
            }}
          >
            <Button>
              {m.key === "scene" ? "批量编辑配置" : "批量操作"} <DownOutlined />
            </Button>
          </Dropdown>
        )}
      </PageHeader>
      {m.tabs && (
        <Tabs
          activeKey={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
            if (m.key === "scene" && v === "路由场景") nav("/routerSceneList");
            else if (m.key === "tag")
              setFilters(v === "管理标签" ? {} : { type: v });
          }}
          items={m.tabs.map((label) => ({ key: label, label }))}
        />
      )}
      {m.key === "featureService" && (
        <div className="feature-search">
          <Select
            defaultValue="全部风险域"
            options={[{ value: "全部风险域", label: "全部风险域" }]}
          />
          <Input.Search
            placeholder="请输入特征关键字全局搜索"
            onSearch={(q) => {
              setFilters((v) => ({ ...v, q }));
              setPage(1);
            }}
          />
        </div>
      )}
      {m.filters.length > 0 && (
        <div
          className={
            "filter-panel " + (m.key === "scene" ? "scene-filter" : "")
          }
        >
          {m.filters.map((f, i) => (
            <label key={f.key} className="filter-field">
              <span>{f.label}:</span>
              <div className="filter-control">
                {f.key === "tags" &&
                ["scene", "rulePage", "rulesGroup"].includes(m.key) ? (
                  <RiskTagSelect
                    value={(filters.riskTags || "")
                      .split(",")
                      .filter(Boolean)
                      .map(Number)}
                    onChange={(ids) => {
                      setFilters((old) => ({
                        ...old,
                        riskTags: ids.join(","),
                      }));
                      setPage(1);
                    }}
                  />
                ) : m.key === "scene" && i === 0 ? (
                  <Space.Compact style={{ width: "100%" }}>
                    <Select
                      value={searchMode}
                      onChange={(v) => {
                        setSearchMode(v);
                        setPage(1);
                      }}
                      options={["模糊搜索", "精确搜索"].map((value) => ({
                        value,
                        label: value,
                      }))}
                      style={{ width: 115 }}
                    />
                    <Input
                      allowClear
                      placeholder={f.placeholder}
                      value={filters[f.key]}
                      onChange={(e) => {
                        setFilters((v) => ({ ...v, [f.key]: e.target.value }));
                        setPage(1);
                      }}
                    />
                  </Space.Compact>
                ) : (
                  <FieldControl
                    field={f}
                    value={filters[f.key]}
                    onChange={(v) => {
                      setFilters((old) => ({ ...old, [f.key]: v || "" }));
                      setPage(1);
                    }}
                  />
                )}
              </div>
            </label>
          ))}
          {m.key === "scene" && (
            <div className="filter-options">
              <Checkbox
                checked={flat}
                onChange={(e) => setFlat(e.target.checked)}
              >
                平铺展示规则组内规则
              </Checkbox>
              <Button
                type="link"
                onClick={() => {
                  Modal.info({
                    title: "标签搜索",
                    content: (
                      <RiskTagSelect
                        onChange={(ids) =>
                          setFilters((old) => ({
                            ...old,
                            riskTags: ids.join(","),
                          }))
                        }
                      />
                    ),
                  });
                }}
              >
                标签搜索 ☷
              </Button>
            </div>
          )}
        </div>
      )}
      {m.key === "decisionList" && (
        <Alert
          showIcon
          type="info"
          closable
          message="公告：【决策优先级】仅作为【分层场景】中的决策加工组件的决策合并依据，不影响普通/路由场景中的执行。存量决策（未配置优先级）默认置为最低值9999。"
        />
      )}
      {m.key === "rulesFuseList" && (
        <Alert
          type="info"
          showIcon
          message="公告：规则熔断V2.0已上线，熔断监控单元将存在报出屏蔽期。"
        />
      )}
      {error && (
        <Alert
          type="error"
          message={error}
          action={<Button onClick={reload}>重试</Button>}
        />
      )}
      {m.key === "tag" && tab === "风险标签" ? (
        <RiskTagExplorer />
      ) : (
        <Table
          className="data-table"
          rowKey="id"
          columns={columns}
          loading={loading}
          dataSource={rows}
          scroll={{ x: "max-content" }}
          rowSelection={
            batchMode || m.key === "tag"
              ? { selectedRowKeys: selected, onChange: setSelected }
              : undefined
          }
          expandable={
            m.kind === "scene"
              ? {
                  expandedRowRender: (r) =>
                    m.key === "rulesGroup" ? (
                      <GroupRules id={r.id} />
                    ) : r.sourceImported ? (
                      <ImportedSceneRules module={m.key} id={r.id} />
                    ) : (
                      <SceneRules module={m.key} id={r.id} />
                    ),
                  expandRowByClick: true,
                }
              : undefined
          }
          pagination={{
            total: m.kind === "audit" ? rows.length : data?.total,
            current: page,
            pageSize,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (n) => "共 " + n + " 条",
            onChange: (p, s) => {
              setPage(p);
              setPageSize(s);
            },
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无数据"
              />
            ),
          }}
        />
      )}
      <ReleaseCreator
        open={releaseCreate}
        onClose={() => setReleaseCreate(false)}
        onSaved={reload}
      />
      <EntityEditor
        module={m}
        defaults={{ view: tab }}
        row={edit}
        open={editor}
        onClose={() => setEditor(false)}
        onSaved={reload}
      />
      <Drawer
        title={m.kind === "graph" ? detail?.name || "详情" : m.label + "详情"}
        open={!!detail}
        onClose={() => setDetail(undefined)}
        width={m.kind === "graph" ? "calc(100vw - 200px)" : 1000}
        extra={
          detail && (
            <Button
              onClick={() => {
                setEdit(detail);
                setEditor(true);
              }}
            >
              编辑属性信息
            </Button>
          )
        }
      >
        {detail &&
          (m.kind === "graph" ? (
            <GraphEditor module={m.key} row={detail} />
          ) : m.kind === "release" ? (
            <ReleaseDetail
              row={detail}
              onChanged={() => {
                reload();
                api<Row>(entityPath(m.key, detail.id)).then(setDetail);
              }}
            />
          ) : (
            <>
              <Tabs
                items={["基本信息", "版本信息", "被引用情况"].map((label) => ({
                  key: label,
                  label,
                  children:
                    label === "基本信息" ? (
                      <Descriptions
                        bordered
                        column={2}
                        items={Object.entries(detail)
                          .filter(([k]) => !["nodes", "edges"].includes(k))
                          .map(([key, value]) => ({
                            key,
                            label:
                              m.fields.find((f) => f.key === key)?.label ||
                              m.columns.find((c) => c[0] === key)?.[1] ||
                              key,
                            children:
                              typeof value === "object"
                                ? JSON.stringify(value)
                                : String(value ?? "—"),
                          }))}
                      />
                    ) : label === "版本信息" ? (
                      <VersionList module={m.key} id={detail.id} />
                    ) : (
                      <Empty description="暂无引用记录" />
                    ),
                }))}
              />
              {m.key === "dataSourceList" && <DataEntries row={detail} />}
            </>
          ))}
      </Drawer>
      <Drawer
        title={chart?.name}
        open={!!chart}
        onClose={() => setChart(undefined)}
        width={1000}
      >
        {chart && (
          <>
            <Alert message="以下为本地示例趋势，未连接线上监控数据。" />
            <svg
              viewBox="0 0 800 300"
              className="chart"
              role="img"
              aria-label="示例规则命中量趋势"
            >
              <path d="M50 20V260H780" fill="none" stroke="#ddd" />
              {[0, 1, 2, 3].map((i) => (
                <line
                  key={i}
                  x1="50"
                  y1={50 + i * 60}
                  x2="780"
                  y2={50 + i * 60}
                  stroke="#eee"
                />
              ))}
              <path
                d="M50 210L120 180L190 195L260 130L330 150L400 90L470 110L540 65L610 95L680 45L750 70"
                fill="none"
                stroke="#3869e8"
                strokeWidth="3"
              />
            </svg>
            <Button
              onClick={() => {
                setEdit(chart);
                setEditor(true);
              }}
            >
              编辑图表
            </Button>
          </>
        )}
      </Drawer>
    </>
  );
}
export function ReleaseDetail({
  row,
  onChanged,
}: {
  row: Row;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [experiment, setExperiment] = useState("双跑");
  const [ratio, setRatio] = useState(10);
  const [urgentReason, setUrgentReason] = useState("");
  async function advance(action: string) {
    try {
      await api("/releases/" + row.id + "/advance", "POST", {
        action,
        experiment,
        ratio,
      });
      onChanged();
      message.success("变更任务已更新");
    } catch (e: any) {
      message.error(e.message);
    }
  }
  return (
    <>
      <Alert
        message={
          row.phase === "完成"
            ? "变更已发布"
            : "变更环境与线上配置隔离，发布完成后统一生效。"
        }
        type="info"
      />
      <Space style={{ margin: "16px 0" }}>
        <Button
          type="primary"
          disabled={
            row.phase !== "实验" ||
            ["已中止", "已完成", "已回滚"].includes(row.status || "")
          }
          onClick={() => enterChangeEnvironment(row.id, "/scene")}
        >
          进入变更环境
        </Button>
      </Space>
      <Tabs
        defaultActiveKey={row.activeTab || "content"}
        items={[
          {
            key: "content",
            label: "变更内容",
            children: (
              <>
                <Descriptions
                  bordered
                  items={[
                    { key: "name", label: "变更名称", children: row.name },
                    { key: "mode", label: "变更模式", children: row.type },
                    { key: "phase", label: "当前阶段", children: row.phase },
                    {
                      key: "description",
                      label: "变更说明",
                      children: row.description,
                    },
                  ]}
                />
                {!!row.localChanges?.length && (
                  <ChangeReview task={row} onChanged={onChanged} />
                )}
              </>
            ),
          },
          {
            key: "experiment",
            label: "实验详情",
            children: (
              <Section title="实验配置">
                <Space direction="vertical">
                  <Select
                    value={experiment}
                    onChange={setExperiment}
                    options={["双跑", "回溯", "样本实验"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                  <Select
                    value={ratio}
                    onChange={setRatio}
                    options={[1, 5, 10, 25, 50, 100].map((value) => ({
                      value,
                      label: `${value}%`,
                    }))}
                  />
                  <Button
                    type="primary"
                    disabled={row.phase !== "实验"}
                    onClick={() => advance("实验")}
                  >
                    启动实验
                  </Button>
                </Space>
              </Section>
            ),
          },
          {
            key: "approval",
            label: "审批详情",
            children: (
              <Section title="审批阶段">
                <p>
                  当前状态：
                  {row.phase === "审批" ? "待审批" : "当前阶段为 " + row.phase}
                </p>
                <Button
                  disabled={row.phase !== "审批"}
                  onClick={() => advance("审批")}
                >
                  审批通过
                </Button>
              </Section>
            ),
          },
          {
            key: "gray",
            label: "灰度详情",
            children: (
              <Section title="灰度发布">
                {row.urgentMode && row.phase === "实验" && (
                  <>
                    <Alert
                      type="warning"
                      message="紧急变更将跳过实验配置，仍须审核与灰度发布。"
                    />
                    <Input.TextArea
                      style={{ margin: "16px 0" }}
                      value={urgentReason}
                      onChange={(e) => setUrgentReason(e.target.value)}
                      placeholder="请输入紧急变更原因"
                    />
                    <Button
                      type="primary"
                      danger
                      onClick={async () => {
                        try {
                          await api("/changes/" + row.id + "/urgent", "POST", {
                            reason: urgentReason,
                          });
                          onChanged();
                        } catch (e: any) {
                          message.error(e.message);
                        }
                      }}
                    >
                      提交紧急变更
                    </Button>
                  </>
                )}
                <p>灰度进度：{row.progress || 0}%</p>
                <Button
                  type="primary"
                  disabled={row.phase !== "灰度"}
                  onClick={() => advance("下一步")}
                >
                  下一步（25%）
                </Button>
              </Section>
            ),
          },
        ]}
      />
    </>
  );
}
export function VersionList({ module, id }: { module: string; id: number }) {
  const { message } = App.useApp();
  const { data, reload } = useRemote<{ items: any[] }>(
    entityPath(module, id) + "/versions",
  );
  return (
    <Table
      rowKey="id"
      dataSource={data?.items || []}
      columns={[
        { title: "版本", dataIndex: "id" },
        { title: "名称", render: (_, r) => r.data.name },
        { title: "保存时间", dataIndex: "createdAt" },
        {
          title: "操作",
          render: (_, r) => (
            <Popconfirm
              title="恢复到该版本？"
              onConfirm={async () => {
                try {
                  await api(
                    entityPath(module, id) + "/restore/" + r.id,
                    "POST",
                  );
                  reload();
                  message.success("版本已恢复，请重新打开详情查看");
                } catch (e: any) {
                  message.error(e.message);
                }
              }}
            >
              <Button type="link">恢复版本</Button>
            </Popconfirm>
          ),
        },
      ]}
    />
  );
}
function DataEntries({ row }: { row: Row }) {
  const { message } = App.useApp();
  const [value, setValue] = useState("");
  const { data, reload } = useRemote<any>("/settings/data-" + row.id);
  useEffect(() => {
    if (data) setValue(data.content || "");
  }, [data]);
  return (
    <Section title="数据条目">
      <Input.TextArea
        rows={6}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="每行一条数据"
      />
      <Button
        onClick={async () => {
          try {
            await api("/settings/data-" + row.id, "PUT", { content: value });
            reload();
            message.success("数据已保存");
          } catch (e: any) {
            message.error(e.message);
          }
        }}
      >
        保存数据
      </Button>
    </Section>
  );
}
