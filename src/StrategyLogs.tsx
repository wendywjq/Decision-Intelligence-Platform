import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tree,
} from "antd";
import {useNavigate,useSearchParams} from "react-router-dom";
import {Link} from "./navigation";
import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import { PageHeader, Section, useRemote } from "./components";
import { RawData } from "./SourceExamples";
import { api } from "./api";
import { formatDate } from "./date";
const cvIds = [
  "1300247749367",
  "255319025253",
  "255319725675",
  "255319033440",
  "255317666688",
  "1300276491424",
];
const sceneLink = (s: any) => (
  <Link target="_blank" to={"/scene?id=" + s.id}>
    [{s.id}] {s.name}
  </Link>
);
function RuleLinks({ items = [] }: { items?: any[] }) {
  return (
    <div className="log-rule-links">
      {items.length ? (
        items.map((r: any) => (
          <Link
            key={r.id}
            target="_blank"
            rel="noopener noreferrer"
            to={"/ruleDetails?id=" + r.id}
          >
            [{r.id}] {r.alias || r.name}
          </Link>
        ))
      ) : (
        <span className="muted">未命中任何规则</span>
      )}
    </div>
  );
}
export function StrategyLogs() {
  const [params, setParams] = useSearchParams();
  const [cv, setCv] = useState(params.get("cvId") || cvIds[0]),
    [requestId, setRequestId] = useState(params.get("requestId") || ""),
    [sceneId, setSceneId] = useState(params.get("sceneId") || ""),
    [query, setQuery] = useState(params.get("cvId") || cvIds[0]),
    [mode, setMode] = useState("自定义列表"),
    [sql, setSql] = useState(false),
    [headers, setHeaders] = useState(false),
    [cols, setCols] = useState([
      "time",
      "request",
      "scene",
      "effect",
      "marked",
      "decisions",
      "action",
    ]),
    [start, setStart] = useState(params.get("start") || ""),
    [end, setEnd] = useState(params.get("end") || "");
  const [filters, setFilters] = useState<any>(() => ({
    requestId: params.get("requestId") || "",
    sceneId: params.get("sceneId") || "",
    ...(params.get("start")
      ? {
          startTime: String(
            Math.floor(new Date(params.get("start")!).getTime() / 1000),
          ),
        }
      : {}),
    ...(params.get("end")
      ? {
          endTime: String(
            Math.floor(new Date(params.get("end")!).getTime() / 1000),
          ),
        }
      : {}),
  }));
  useEffect(() => {
    const cvId = params.get("cvId") || cvIds[0];
    setCv(cvId);
    setQuery(cvId);
    setRequestId(params.get("requestId") || "");
    setSceneId(params.get("sceneId") || "");
    setStart(params.get("start") || "");
    setEnd(params.get("end") || "");
    setFilters({
      requestId: params.get("requestId") || "",
      sceneId: params.get("sceneId") || "",
      ...(params.get("start")
        ? {
            startTime: String(
              Math.floor(new Date(params.get("start")!).getTime() / 1000),
            ),
          }
        : {}),
      ...(params.get("end")
        ? {
            endTime: String(
              Math.floor(new Date(params.get("end")!).getTime() / 1000),
            ),
          }
        : {}),
    });
  }, [params]);
  const remote = useRemote<any>(
    "/source/logs?" +
      new URLSearchParams({
        cvId: query,
        ...filters,
        ...(mode === "特征平铺" ? { flat: "1" } : {}),
      }),
  );
  const nav = useNavigate();
  const { message } = App.useApp();
  const captured = remote.data?.queries?.[0]?.window;
  const run = () => {
    setParams(
      Object.fromEntries(
        Object.entries({ cvId: cv, requestId, sceneId, start, end }).filter(
          ([, v]) => v,
        ),
      ),
    );
    setQuery(cv);
    setFilters({
      requestId,
      sceneId,
      ...(start
        ? { startTime: String(Math.floor(new Date(start).getTime() / 1000)) }
        : {}),
      ...(end
        ? { endTime: String(Math.floor(new Date(end).getTime() / 1000)) }
        : {}),
    });
    remote.reload();
  };
  const columns: any[] = [
    {
      key: "time",
      title: (
        <>
          <b>时间</b>
          <div className="secondary-name">logTime</div>
        </>
      ),
      width: 160,
      render: (_: any, r: any) => (
        <>
          {formatDate(r.logTime)}
          <div>
            <Tag>实时日志</Tag>
          </div>
        </>
      ),
    },
    {
      key: "request",
      title: "Zeus请求ID",
      dataIndex: "requestId",
      width: 300,
      render: (v: string) => <span className="source-value">{v}</span>,
    },
    {
      key: "scene",
      title: "场景 / 子场景",
      width: 270,
      render: (_: any, r: any) => (
        <>
          {sceneLink(r.sceneInfo)}
          {r.subSceneList?.map((s: any) => (
            <div key={s.id}>{sceneLink(s)}</div>
          ))}
        </>
      ),
    },
    {
      key: "effect",
      title: "生效规则-决策",
      width: 300,
      render: (_: any, r: any) => <RuleLinks items={r.takenEffectRuleList} />,
    },
    {
      key: "marked",
      title: "标记规则-决策",
      width: 300,
      render: (_: any, r: any) => <RuleLinks items={r.markedRuleList} />,
    },
    {
      key: "decisions",
      title: "Zeus决策",
      width: 170,
      render: (_: any, r: any) =>
        (r.decisionList || []).map((d: any) => (
          <div key={d.id}>
            [{d.id}] {d.name}
          </div>
        )),
    },
    {
      key: "action",
      title: "操作",
      fixed: "right",
      width: 100,
      render: (_: any, r: any) => (
        <Link
          target="_blank"
          to={
            "/strategyCheckLog/detail?requestId=" +
            encodeURIComponent(r.requestId) +
            "&returnTo=" +
            encodeURIComponent("/strategyCheckLog?" + params.toString())
          }
        >
          查看
        </Link>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="策略排查">
        <Button
          onClick={() => {
            setCv("");
            setQuery("");
            setFilters({});
          }}
        >
          查看全部示例
        </Button>
      </PageHeader>
      <div className="strategy-query">
        <div className="query-caption">
          策略排查 <span className="muted">日志查询</span>
        </div>
        <Space>
          <Button
            onClick={async () => {
              await api("/settings/log-query-favorite", "PUT", {
                cv,
                requestId,
                sceneId,
              });
              message.success("查询条件已收藏");
            }}
          >
            ☆ 收藏
          </Button>
          <Button
            onClick={async () => {
              const p = await api("/settings/log-query-favorite");
              setCv(p.cv || "");
              setRequestId(p.requestId || "");
              setSceneId(p.sceneId || "");
            }}
          >
            查看收藏
          </Button>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(
                location.origin +
                  "/#/strategyCheckLog?cvId=" +
                  encodeURIComponent(cv),
              );
              message.success("查询链接已复制");
            }}
          >
            分享
          </Button>
        </Space>
        <div className="log-time-range">
          <label>时间范围</label>
          <Input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <span>~</span>
          <Input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <Tag color="blue">近1天</Tag>
          {captured && (
            <span className="muted">
              采集窗口：{formatDate(captured.startTime)} ～{" "}
              {formatDate(captured.endTime)}
            </span>
          )}
        </div>
        <div className="log-query-fields">
          <label>
            目标类型
            <Select
              value="实时"
              options={[{ value: "实时", label: "实时日志" }]}
            />
          </label>
          <label>
            请求ID requestId
            <Input
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
            />
          </label>
          <label>
            场景 sceneId
            <Input
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
            />
          </label>
          <label>
            cvId
            <Input
              value={cv}
              onChange={(e) => setCv(e.target.value)}
              placeholder="支持逗号分隔多个 CVID"
            />
          </label>
        </div>
        <div className="log-query-actions">
          <Space wrap>
            {cvIds.map((id) => (
              <Button
                key={id}
                size="small"
                type={cv === id ? "primary" : "default"}
                onClick={() => setCv(id)}
              >
                {id}
              </Button>
            ))}
          </Space>
          <Space>
            <Button
              onClick={() => {
                setCv("");
                setRequestId("");
                setSceneId("");
                setStart("");
                setEnd("");
                setQuery("");
                setFilters({});
              }}
            >
              重置
            </Button>
            <Button type="primary" onClick={run}>
              查询
            </Button>
          </Space>
        </div>
      </div>
      <Section title={`查询结果（共${remote.data?.total || 0}条）`}>
        <div className="log-result-toolbar">
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={["自定义列表", "特征平铺"]}
          />
          <Space>
            <Button onClick={() => setHeaders(true)}>自定义表头</Button>
            <Button onClick={() => setSql(true)}>查看SQL</Button>
          </Space>
        </div>
        {remote.error && <Alert type="error" message={remote.error} />}
        <Table<any>
          rowKey="requestId"
          loading={remote.loading}
          dataSource={remote.data?.items || []}
          columns={
            mode === "特征平铺"
              ? [
                  columns[0],
                  columns[1],
                  { title: "cvId", dataIndex: "cvId" },
                  columns[2],
                  {
                    key: "features",
                    title: "特征值",
                    width: 650,
                    render: (_: any, r: any) => (
                      <div style={{ maxHeight: 280, overflow: "auto" }}>
                        {Object.entries(r.featureValues || {}).map(
                          ([name, value]) => (
                            <div key={name}>
                              <b>{name}</b>：
                              <span className="source-value">
                                {typeof value === "string"
                                  ? value
                                  : JSON.stringify(value)}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    ),
                  },
                  columns[6],
                ]
              : columns.filter((c) => cols.includes(c.key))
          }
          scroll={{ x: 1400 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (n) => `共 ${n} 条`,
          }}
          locale={{ emptyText: "当前快照内没有符合条件的请求" }}
        />
      </Section>
      <Modal
        title="自定义表头"
        open={headers}
        onCancel={() => setHeaders(false)}
        onOk={() => setHeaders(false)}
      >
        <Checkbox.Group
          value={cols}
          onChange={(v) => setCols(v as string[])}
          options={columns.map((c) => ({
            value: c.key,
            label: typeof c.title === "string" ? c.title : "时间",
          }))}
        />
      </Modal>
      <Modal
        title="查询SQL（本地快照）"
        open={sql}
        onCancel={() => setSql(false)}
        footer={null}
      >
        <pre className="code-editor">
          {"SELECT * FROM source_request_logs WHERE cv_id IN (" +
            query
              .split(/[,，\s]+/)
              .filter(Boolean)
              .map((x) => "'" + x.replaceAll("'", "''") + "'")
              .join(", ") +
            ") ORDER BY log_time DESC;"}
        </pre>
      </Modal>
    </>
  );
}
function LogFeatureList({ detail }: { detail: any }) {
  const [type, setType] = useState("all"),
    [q, setQ] = useState(""),
    [format, setFormat] = useState("KV格式"),
    [selected, setSelected] = useState<any>(),
    [nulls, setNulls] = useState(true);
  const defs = useRemote<any>("/source/features/catalog");
  const byName = new Map(
    (defs.data?.items || []).map((f: any) => [f.enName, f]),
  );
  const values = useMemo(
    () =>
      Object.entries({
        ...detail.paramContext,
        ...detail.factorContext,
        ...detail.zeusSystemParams,
        ...detail.extraContext,
      }).map(([name, value]) => ({
        name,
        value,
        origin:
          detail.factorContext && name in detail.factorContext
            ? "factor"
            : detail.zeusSystemParams && name in detail.zeusSystemParams
              ? "system"
              : "param",
      })),
    [detail],
  );
  const rows = values.filter(
    (r) =>
      (!q ||
        `${r.name} ${typeof r.value === "object" ? JSON.stringify(r.value) : r.value}`
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (nulls || r.value !== null) &&
      (type === "all" ||
        (type === "param"
          ? r.origin === "param"
          : type === "system"
            ? r.origin === "system"
            : (byName.get(r.name) as any)?.type === type)),
  );
  return (
    <>
      <div className="source-table-filters">
        <Input.Search
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索特征名称或取值"
        />
        <Checkbox checked={nulls} onChange={(e) => setNulls(e.target.checked)}>
          显示 null 特征
        </Checkbox>
        <Radio.Group
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          options={["KV格式", "JSON格式"]}
        />
      </div>
      <div className="log-feature-layout">
        <Tabs
          tabPosition="left"
          activeKey={type}
          onChange={setType}
          items={[
            ["all", "全部特征"],
            ["param", "业务传参"],
            ["基础因子", "原始特征"],
            ["扩展因子", "KV特征"],
            ["累计因子", "累计特征"],
            ["衍生因子", "衍生特征"],
            ["RPC特征", "RPC特征"],
            ["模型因子", "模型特征"],
            ["system", "决策信息"],
          ].map(([key, label]) => ({ key, label }))}
        />
        <div className="log-feature-content">
          {format === "JSON格式" ? (
            <pre className="code-editor">
              {JSON.stringify(
                Object.fromEntries(rows.map((r) => [r.name, r.value])),
                null,
                2,
              )}
            </pre>
          ) : (
            <Table<any>
              rowKey="name"
              dataSource={rows}
              pagination={{
                pageSize: 30,
                showSizeChanger: true,
                showTotal: (n) => `共 ${n} 个特征`,
              }}
              columns={[
                {
                  title: "特征",
                  width: 370,
                  render: (_, r) => {
                    const f = byName.get(r.name) as any;
                    return (
                      <>
                        <Button type="link" onClick={() => setSelected(r)}>
                          {r.name}
                        </Button>
                        {f && (
                          <div className="secondary-name">
                            {f.name} · {f.type}
                          </div>
                        )}
                      </>
                    );
                  },
                },
                {
                  title: "取值",
                  render: (_, r) => (
                    <span className="log-feature-value">
                      {r.value === null ? (
                        <Tag>null</Tag>
                      ) : typeof r.value === "object" ? (
                        JSON.stringify(r.value)
                      ) : (
                        String(r.value)
                      )}
                    </span>
                  ),
                },
                {
                  title: "操作",
                  width: 110,
                  render: (_, r) => (
                    <Button
                      size="small"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          typeof r.value === "string"
                            ? r.value
                            : JSON.stringify(r.value),
                        )
                      }
                    >
                      复制
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>
      <Drawer
        width="75vw"
        open={!!selected}
        onClose={() => setSelected(undefined)}
        title={selected?.name}
      >
        {selected && (
          <>
            <pre className="code-editor">
              {JSON.stringify(selected.value, null, 2)}
            </pre>
            {byName.has(selected.name) && (
              <Link
                target="_blank"
                to={
                  "/featureDetails?id=" + (byName.get(selected.name) as any).id
                }
              >
                查看特征定义 / 血缘
              </Link>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
function RequestFlow({ basic, detail }: { basic: any; detail: any }) {
  const [selected, setSelected] = useState<any>();
  const scenes = basic.subSceneList?.length
    ? basic.subSceneList
    : [basic.sceneInfo];
  const nodes: any[] = [
    {
      id: "root",
      position: { x: 20, y: 110 },
      data: { label: `[${basic.sceneInfo.id}] ${basic.sceneInfo.name}` },
      style: { background: "#eef4ff", border: "1px solid #3977eb", width: 250 },
    },
  ];
  const edges: any[] = [];
  scenes.forEach((s: any, i: number) => {
    const id = "scene" + i;
    nodes.push({
      id,
      position: { x: 350, y: i * 140 },
      data: { label: `[${s.id}] ${s.name}` },
      style: { width: 260 },
      source: s,
    });
    edges.push({
      id: "e" + i,
      source: "root",
      target: id,
      markerEnd: { type: MarkerType.ArrowClosed },
    });
    const hit = [
      ...(detail?.takenEffectRules || []),
      ...(detail?.markedRules || []),
    ].filter((r: any) => String(r.sceneId) === String(s.id));
    nodes.push({
      id: "decision" + i,
      position: { x: 720, y: i * 140 },
      data: {
        label: hit.length ? `${hit.length} 条规则命中` : "未命中规则 · 通过",
      },
      style: { width: 220, background: "#f3fbf6" },
    });
    edges.push({ id: "d" + i, source: id, target: "decision" + i });
  });
  return (
    <>
      <div className="request-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onNodeClick={(_, node) => setSelected(node)}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <Drawer
        title="执行节点详情"
        open={!!selected}
        onClose={() => setSelected(undefined)}
        width={650}
      >
        <RawData value={selected} title="节点信息" />
        {detail && (
          <>
            <Section title="识别树节点执行状态">
              <RawData
                value={
                  detail.paramContext?.__GRAPH_SCENE_NODE_STATES__ ||
                  detail.zeusSystemParams?.__GRAPH_SCENE_NODE_STATES__ ||
                  {}
                }
              />
            </Section>
            <Section title="决策树执行详情">
              <RawData
                value={
                  detail.zeusSystemParams?.__DECISION_TREE_HIT_DETAIL__ || {}
                }
              />
            </Section>
          </>
        )}
      </Drawer>
    </>
  );
}
export function StrategyLogDetail() {
  const [params] = useSearchParams();
  const id = params.get("requestId") || "";
  const { data, error } = useRemote<any>(
    "/source/logs/" + encodeURIComponent(id),
  );
  const [ruleType, setRuleType] = useState("takenEffectRules");
  const nav = useNavigate();
  if (error) return <Alert type="error" message={error} />;
  if (!data) return <Spin />;
  const { basic: b, detail: d } = data;
  return (
    <>
      <PageHeader title="请求详情">
        <Button
          onClick={() =>
            nav(
              params.get("returnTo")?.startsWith("/strategyCheckLog?")
                ? params.get("returnTo")!
                : "/strategyCheckLog?cvId=" + data.cvId,
            )
          }
        >
          返回查询
        </Button>
        <RawData value={data} title="完整请求日志" />
      </PageHeader>
      <Section title="基本信息">
        <Descriptions
          column={3}
          items={[
            { key: "time", label: "请求时间", children: formatDate(b.logTime) },
            { key: "id", label: "requestId（Zeus）", children: b.requestId },
            {
              key: "tt",
              label: "requestId（TT）",
              children: b.ttRequestId || "—",
            },
            { key: "cv", label: "cvId", children: data.cvId },
            { key: "scene", label: "场景", children: sceneLink(b.sceneInfo) },
            {
              key: "sub",
              label: "子场景",
              children: b.subSceneList?.map((s: any) => (
                <div key={s.id}>{sceneLink(s)}</div>
              )),
            },
            { key: "type", label: "目标类型", children: "实时日志" },
            { key: "mode", label: "其他", children: d?.modeName || "默认模式" },
            {
              key: "decision",
              label: "最终决策",
              children:
                b.finalDecisionList?.map((r: any) => r.name).join("，") || "—",
            },
          ]}
        />
        <Tabs
          activeKey={ruleType}
          onChange={setRuleType}
          items={[
            {
              key: "takenEffectRules",
              label: `生效规则（${d?.takenEffectRules?.length || 0}）`,
            },
            {
              key: "markedRules",
              label: `标记规则（${d?.markedRules?.length || 0}）`,
            },
            {
              key: "grayRules",
              label: `灰度规则（${d?.grayRules?.length || 0}）`,
            },
          ]}
        />
        <Table<any>
          size="small"
          rowKey={(_, i) => String(i)}
          dataSource={d?.[ruleType] || []}
          columns={[
            {
              title: "规则",
              render: (_, r) => (
                <Link target="_blank" to={"/ruleDetails?id=" + r.id}>
                  [{r.priority}] [{r.id}] {r.name}
                </Link>
              ),
            },
            { title: "场景", dataIndex: "sceneId" },
            { title: "节点", dataIndex: "nodeId" },
            { title: "决策", dataIndex: "decisionId" },
            { title: "理由", dataIndex: "reasonCode" },
          ]}
        />
      </Section>
      {d ? (
        <>
          <Section title="策略还原">
            <RequestFlow basic={b} detail={d} />
          </Section>
          <Section title="特征详情">
            <LogFeatureList detail={d} />
          </Section>
          <Section title="数据接口与特征异常">
            <RawData
              value={{
                fetcherErrors: d.zeusFetcherErrorLog,
                exception: d.exceptionMessage,
                factorTools: d.factorToolExecuteDetail,
              }}
              title="查看执行异常信息"
            />
          </Section>
        </>
      ) : (
        <Alert
          type="warning"
          message="来源查询没有返回该请求的详细日志；仅展示已取得的基础信息。"
        />
      )}
    </>
  );
}
