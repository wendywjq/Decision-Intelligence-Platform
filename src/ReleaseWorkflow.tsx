import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowLeftOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useRemote, Section } from "./components";
import { enterChangeEnvironment } from "./change-context";
import { ChangeReview } from "./ChangeReview";
import { CompareTable, RequestIds, SummaryStatistics } from "./ReleaseMetrics";
import { Link } from "./navigation";
import { RawData } from "./SourceExamples";
import { formatDate } from "./date";
const types: any = {
  "0": "双跑",
  "1": "历史",
  "2": "历史",
  "3": "基准评测实验",
};
const kinds = [
  ["scene", "场景"],
  ["graph_template", "模版"],
  ["rule_group", "规则组"],
  ["rule", "规则"],
];
function path(r: any) {
  return (
    (r.module === "rulePage"
      ? "/ruleDetails"
      : r.module === "layerScene"
        ? "/layerScene/detail"
        : "/" + r.module) +
    "?id=" +
    r.id
  );
}
export function WorkflowImpacts({ data }: { data: any }) {
  const [shown, setShown] = useState(kinds.map((x) => x[0]));
  return (
    <>
      <div className="experiment-section-heading">
        <h2>变更影响</h2>
        <Checkbox.Group
          value={shown}
          onChange={(v) => setShown(v as string[])}
          options={kinds.map(([value, label]) => ({ value, label }))}
        />
      </div>
      <div
        className="experiment-impact-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(shown.length, 1)},minmax(0,1fr))`,
        }}
      >
        {kinds
          .filter(([key]) => shown.includes(key))
          .map(([key, label]) => (
            <section className="experiment-impact-card" key={key}>
              <h3>
                影响{label} <small>共 {data?.[key]?.length || 0} 条</small>
              </h3>
              <Table<any>
                rowKey={(r) => r.module + ":" + r.id}
                size="small"
                dataSource={data?.[key] || []}
                pagination={{
                  pageSize: 5,
                  showSizeChanger: false,
                  showTotal: (n) => `共 ${n} 条`,
                }}
                columns={[
                  { title: "影响" + label + "ID", dataIndex: "id", width: 110 },
                  {
                    title: "影响" + label + "名称",
                    ellipsis: true,
                    render: (_, r) => (
                      <Link
                        target="_blank"
                        rel="noopener noreferrer"
                        to={path(r)}
                      >
                        {r.name}
                      </Link>
                    ),
                  },
                ]}
              />
            </section>
          ))}
      </div>
    </>
  );
}
function ChangeContent({ data, reload }: { data: any; reload: () => void }) {
  return data.isSource ? (
    <Table<any>
      rowKey={(r, i) => r.drillRecordId || String(i)}
      dataSource={data.archive.changes?.list || []}
      pagination={{ pageSize: 5 }}
      columns={[
        { title: "名称", render: (_, r) => r.objAlias || r.objName || r.objId },
        {
          title: "变更前",
          dataIndex: "preContext",
          render: (v) => <pre className="source-diff-code">{v}</pre>,
        },
        {
          title: "变更后",
          dataIndex: "changedContext",
          render: (v) => <pre className="source-diff-code">{v}</pre>,
        },
      ]}
    />
  ) : (
    <ChangeReview task={data.task} onChanged={reload} />
  );
}
function TrafficInfo({ data, type }: { data: any; type: string }) {
  const c = data.config;
  return (
    <Descriptions
      bordered
      className="workflow-traffic-info"
      styles={{
        label: { whiteSpace: "nowrap", width: 110, minWidth: 110 },
        content: { minWidth: 0 },
      }}
      size="small"
      column={2}
      items={[
        { key: "type", label: "流量类型", children: types[type] },
        {
          key: "rate",
          label: type === "1" ? "历史时长" : "流量比例",
          children:
            type === "1"
              ? c.history.days + " 天"
              : type === "0"
                ? c.parallel.rate + "%"
                : "基准样本",
        },
        {
          key: "end",
          label: "结束时间",
          children: type === "0" ? formatDate(c.parallel.endTime) : "—",
        },
        {
          key: "sources",
          label: "流量来源",
          children: (
            <div className="experiment-source-tags">
              {data.trafficSources.map((s: any) => (
                <Tag key={s.module + ":" + s.id}>{s.label}</Tag>
              ))}
            </div>
          ),
        },
        {
          key: "filters",
          label: "流量筛选",
          children: c.parallel.filters?.length
            ? c.parallel.filters.map((f: any, i: number) => (
                <Tag key={i}>
                  {f.field} {f.operator} {f.value}
                </Tag>
              ))
            : "无",
        },
      ]}
    />
  );
}
function DataObservation({
  result,
  sample = false,
  gray = false,
}: {
  result: any;
  sample?: boolean;
  gray?: boolean;
}) {
  const [q, setQ] = useState("");
  const all =
    result?.comparison?.items ||
    result?.comparison?.sceneCompareDatas ||
    result?.comparison?.list ||
    [];
  const filtered = {
    ...result?.comparison,
    items: all.filter(
      (r: any) =>
        !q ||
        JSON.stringify([r.sceneId, r.sceneName, r.name, r.ruleId])
          .toLowerCase()
          .includes(q.toLowerCase()),
    ),
  };
  return (
    <>
      <SummaryStatistics data={result?.statistics} />
      <Tabs
        destroyOnHidden
        items={[
          {
            key: "compare",
            label: "数据对比（命中量级/命中率）",
            children: (
              <>
                <Input.Search
                  placeholder="按场景ID、场景名称筛选"
                  allowClear
                  style={{ maxWidth: 360, marginBottom: 16 }}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <CompareTable data={filtered} sample={sample} gray={gray} />
              </>
            ),
          },
          {
            key: "details",
            label: "数据明细",
            children: <RequestIds data={result?.details} />,
          },
        ]}
      />
    </>
  );
}
export function ReleaseWorkflowPage({
  id,
  mode,
  urgent = false,
}: {
  id: number;
  mode: "experiment" | "gray-config" | "gray-detail" | "approval";
  urgent?: boolean;
}) {
  const { data, error, reload } = useRemote<any>(
    "/releases/" + id + "/workflow",
  );
  const gray = useRemote<any>(
    mode === "gray-config"
      ? "/releases/" + id + "/gray-config" + (urgent ? "?deployMode=0" : "")
      : "",
  );
  const [config, setConfig] = useState<any>(),
    [review, setReview] = useState(false),
    [approveOpen, setApproveOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [type, setType] = useState<string>(),
    [stage, setStage] = useState("0");
  const { message } = App.useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!gray.data) return;
    let draft: any;
    try {
      draft = JSON.parse(
        sessionStorage.getItem("zeus-gray-draft:" + id) || "null",
      );
    } catch {}
    setConfig(
      gray.data.isEditable && draft?.deployMode === gray.data.config.deployMode
        ? draft
        : gray.data.config,
    );
  }, [gray.data, id]);
  if (error || gray.error)
    return <Alert type="error" message={error || gray.error} />;
  if (!data || (mode === "gray-config" && !config)) return <Spin />;
  const r = data.task;
  const ended = ["已中止", "已完成", "已回滚"].includes(r.status);
  const editable = mode === "gray-config" && gray.data?.isEditable;
  const activeType =
    type ||
    String(
      data.config.trafficSourceTypes[0] ||
        data.experimentResults[0]?.trafficSourceType ||
        "0",
    );
  const actions = async (action: string, extra: any = {}) => {
    try {
      setBusy(true);
      await api("/releases/" + id + "/workflow/action", "POST", {
        action,
        ...extra,
      });
      reload();
      gray.reload();
      message.success("操作已保存");
      return true;
    } catch (e: any) {
      message.error(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const confirmAction = (action: string, title = action + "当前变更任务？") =>
    Modal.confirm({ title, onOk: () => actions(action).then(() => {}) });
  const update = (patch: any) => setConfig({ ...config, ...patch });
  const mutateStage = (i: number, patch: any) =>
    update({
      stages: config.stages.map((s: any, j: number) =>
        i === j ? { ...s, ...patch } : s,
      ),
    });
  const submit = () =>
    Modal.confirm({
      title: "确认信息",
      content: "是否确认发布，确认后您可以到变更管理中查看变更进度和变更详情。",
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        try {
          setBusy(true);
          await api("/releases/" + id + "/gray-config/submit", "POST", config);
          sessionStorage.removeItem("zeus-gray-draft:" + id);
          message.success("变更已发起审批，请勿重复操作");
          nav("/release/approval-detail?id=" + id);
          reload();
          gray.reload();
        } catch (e: any) {
          message.error(e.message);
          throw e;
        } finally {
          setBusy(false);
        }
      },
    });
  const currentStages = data.grayConfig.stages || [];
  const grayRows = data.grayStages || [];
  const activeGray = grayRows[Number(stage)] || {};
  const title =
    mode === "experiment"
      ? "实验数据详情"
      : mode === "gray-config"
        ? "灰度任务配置"
        : mode === "approval"
          ? "审批详情"
          : "灰度数据观察";
  return (
    <div className="experiment-config-page release-workflow-page">
      <div className="experiment-page-heading">
        <div className="workflow-title">
          <Button
            type="text"
            aria-label="返回变更管理"
            icon={<ArrowLeftOutlined />}
            onClick={() => nav("/release/list")}
          />
          <h1>{title}</h1>
          {(urgent || r.deployMode === 0) && <Tag color="red">紧急变更</Tag>}
        </div>
        <Space wrap>
          {mode === "gray-config" ? (
            <>
              <Button onClick={() => nav("/release/list")}>取消变更</Button>
              {config.deployMode === 0 && (
                <Button
                  type="primary"
                  disabled={!editable || r.phase !== "实验"}
                  onClick={async () => {
                    try {
                      sessionStorage.setItem(
                        "zeus-gray-draft:" + id,
                        JSON.stringify(config),
                      );
                      enterChangeEnvironment(id, "/scene");
                    } catch (e: any) {
                      message.error(e.message);
                    }
                  }}
                >
                  变更环境
                </Button>
              )}
              <Button onClick={() => setReview(true)}>变更内容</Button>
              {config.deployMode !== 0 && (
                <Button
                  onClick={() => nav("/release/experiment-detail?id=" + id)}
                >
                  实验详情
                </Button>
              )}
              <Button
                type="primary"
                loading={busy}
                disabled={!editable}
                onClick={submit}
              >
                去审批
              </Button>
            </>
          ) : mode === "experiment" ? (
            <>
              <Button
                disabled={
                  data.isSource ||
                  !r.experimentStartedAt ||
                  r.phase !== "审批" ||
                  !!r.approvalSubmittedAt ||
                  ended
                }
                onClick={() => confirmAction("中止实验")}
              >
                中止实验
              </Button>
              <Button
                type="primary"
                disabled={data.isSource || r.phase !== "实验" || ended}
                loading={busy}
                onClick={async () => {
                  try {
                    setBusy(true);
                    await api(
                      "/releases/" + id + "/experiment-config/start",
                      "POST",
                      data.config,
                    );
                    reload();
                  } catch (e: any) {
                    message.error(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                启动实验
              </Button>
              <Button
                type="primary"
                disabled={data.isSource || !r.experimentStartedAt || ended}
                onClick={() => nav("/release/gray-config?id=" + id)}
              >
                去变更
              </Button>
              {r.status === "已中止" && (
                <Button onClick={() => actions("重启")}>重启</Button>
              )}
            </>
          ) : mode === "approval" ? (
            <>
              <Button onClick={() => nav("/release/gray-config?id=" + id)}>
                灰度配置
              </Button>
              <Button
                disabled={
                  data.isSource || r.approvalState !== "待审批" || ended
                }
                onClick={() => confirmAction("撤回")}
              >
                撤回
              </Button>
              <Button
                danger
                disabled={
                  data.isSource || r.approvalState !== "待审批" || ended
                }
                onClick={() => setApproveOpen(true)}
              >
                驳回
              </Button>
              <Button
                type="primary"
                disabled={
                  data.isSource || r.approvalState !== "待审批" || ended
                }
                onClick={async () => {
                  if (await actions("审批通过"))
                    nav("/release/gray-detail?id=" + id);
                }}
              >
                审批通过
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setReview(true)}>变更内容</Button>
              {r.phase === "灰度" && !ended && (
                <>
                  <Button
                    type="primary"
                    disabled={data.isSource}
                    loading={busy}
                    onClick={() =>
                      confirmAction(
                        (r.grayStageIndex ?? -1) < 0 ? "启动灰度" : "下一步",
                        "确认推进到下一灰度阶段？",
                      )
                    }
                  >
                    {(r.grayStageIndex ?? -1) < 0 ? "去灰度" : "下一步"}
                  </Button>
                  <Button
                    danger
                    disabled={data.isSource}
                    onClick={() => confirmAction("中止")}
                  >
                    中止
                  </Button>
                </>
              )}
              {r.status === "已中止" && (
                <Button
                  disabled={data.isSource}
                  onClick={() => confirmAction("重启")}
                >
                  重启
                </Button>
              )}
              {data.canRollback && (
                <Button
                  danger
                  onClick={() =>
                    confirmAction(
                      "回滚",
                      "确定回滚已发布变更？相关场景配置将恢复到发布前。",
                    )
                  }
                >
                  回滚
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={reload}>
                刷新
              </Button>
            </>
          )}
        </Space>
      </div>
      <Section title={mode === "experiment" ? "变更基础信息" : "基础信息"}>
        <Descriptions
          column={3}
          items={[
            {
              key: "name",
              label: mode === "experiment" ? "变更名称" : "变更任务",
              children: r.name,
            },
            {
              key: "status",
              label: mode === "experiment" ? "实验进度" : "灰度进度",
              children: (
                <Tag
                  color={
                    r.status === "已完成"
                      ? "green"
                      : r.status === "已中止"
                        ? "red"
                        : "blue"
                  }
                >
                  {data.isSource ? "来源快照 · " + r.status : r.status}
                </Tag>
              ),
            },
            {
              key: "mode",
              label: "变更模式",
              children: urgent || r.deployMode === 0 ? "紧急变更" : "日常变更",
            },
            {
              key: "start",
              label: "开始时间",
              children: formatDate(
                r.experimentStartedAt || r.grayStartedAt || r.createdAt,
              ),
            },
            { key: "id", label: "变更任务ID", children: id },
            {
              key: "actor",
              label: "最后修改人",
              children: r.modifier || r.owner || "—",
            },
          ]}
        />
        {!data.isSource && (
          <p className="muted workflow-local-note">
            本地流程演示；指标仅展示已导入的数据，实验及灰度操作不切换真实线上流量。
          </p>
        )}
      </Section>
      {mode === "gray-config" && (
        <>
          <h2>变更配置</h2>
          <div className="workflow-gray-layout">
            <Form
              layout="horizontal"
              labelCol={{ span: 5 }}
              wrapperCol={{ span: 19 }}
              disabled={!editable}
            >
              <Form.Item label="变更模式">
                {config.deployMode === 0 ? "紧急变更" : "日常变更"}
              </Form.Item>
              {config.deployMode === 0 && (
                <>
                  <Form.Item label="紧急变更原因" required>
                    <Input.TextArea
                      aria-label="紧急变更原因"
                      rows={3}
                      value={config.urgentReason}
                      onChange={(e) => update({ urgentReason: e.target.value })}
                      placeholder="请输入紧急变更原因"
                    />
                  </Form.Item>
                  <Form.Item label="是否灰度变更">
                    <Radio.Group
                      value={config.grayEnabled}
                      onChange={(e) => update({ grayEnabled: e.target.value })}
                      options={[
                        { label: "灰度变更", value: true },
                        { label: "全量变更", value: false },
                      ]}
                    />
                  </Form.Item>
                </>
              )}
              {config.grayEnabled && (
                <Form.Item label="变更进程" required>
                  <Table<any>
                    size="small"
                    rowKey={(_, i) => String(i)}
                    dataSource={config.stages}
                    pagination={false}
                    columns={[
                      { title: "阶段", render: (_, s, i) => "阶段" + (i + 1) },
                      {
                        title: "灰度比例",
                        render: (_, s, i) => (
                          <InputNumber
                            aria-label={"阶段" + (i + 1) + "灰度比例"}
                            min={1}
                            max={100}
                            precision={0}
                            addonAfter="%"
                            value={s.grayRate}
                            disabled={
                              !editable || i === config.stages.length - 1
                            }
                            onChange={(v) => mutateStage(i, { grayRate: v })}
                          />
                        ),
                      },
                      {
                        title: "灰度时间",
                        render: (_, s, i) =>
                          i === config.stages.length - 1 ? (
                            "—"
                          ) : (
                            <InputNumber
                              aria-label={"阶段" + (i + 1) + "灰度时间"}
                              min={config.deployMode === 0 ? 1 : 10}
                              precision={0}
                              addonAfter="分钟"
                              value={s.grayTime}
                              disabled={!editable}
                              onChange={(v) => mutateStage(i, { grayTime: v })}
                            />
                          ),
                      },
                      {
                        title: "操作",
                        render: (_, s, i) => (
                          <Button
                            type="link"
                            disabled={
                              !editable ||
                              i === config.stages.length - 1 ||
                              config.stages.length <= 2
                            }
                            onClick={() =>
                              update({
                                stages: config.stages.filter(
                                  (_: any, j: number) => i !== j,
                                ),
                              })
                            }
                          >
                            删除
                          </Button>
                        ),
                      },
                    ]}
                  />
                  <Button
                    type="link"
                    icon={<PlusOutlined />}
                    disabled={!editable || config.stages.length >= 15}
                    onClick={() => {
                      const a = [...config.stages];
                      a.splice(a.length - 1, 0, {
                        grayRate: Math.min(99, (a.at(-2)?.grayRate || 1) + 10),
                        grayTime: config.deployMode === 0 ? 1 : 10,
                        notify: true,
                      });
                      update({ stages: a });
                    }}
                  >
                    添加
                  </Button>
                </Form.Item>
              )}
              <Form.Item label="变更说明" required>
                <Input.TextArea
                  aria-label="变更说明"
                  rows={3}
                  maxLength={2000}
                  value={config.description}
                  onChange={(e) => update({ description: e.target.value })}
                  placeholder="请输入变更说明"
                />
              </Form.Item>
              <Form.Item label="指定审批人" required>
                <Input
                  aria-label="指定审批人"
                  value={config.approver}
                  onChange={(e) => update({ approver: e.target.value })}
                  placeholder="请输入MIS ID"
                  style={{ maxWidth: 280 }}
                />{" "}
                <Tooltip title="本副本使用本地审批，不发送大象通知">
                  <InfoCircleOutlined />
                </Tooltip>
              </Form.Item>
              <Form.Item label="通知人">
                <Select
                  aria-label="通知人"
                  mode="tags"
                  value={config.notifyUsers}
                  onChange={(v) => update({ notifyUsers: v })}
                  tokenSeparators={[",", " "]}
                  placeholder="输入完misid后回车生效"
                />
                <span className="muted">
                  系统默认包含创建人；本地操作仅保存通知人配置。
                </span>
              </Form.Item>
            </Form>
            <aside className="workflow-gray-help">
              <strong>
                {config.deployMode === 0
                  ? "紧急变更：适用于紧急对抗策略迭代变更。"
                  : "日常变更：灰度比例和时间由用户配置。"}
              </strong>
              <p>1）初步灰度流量比例不低于1%，不超过10%。</p>
              <p>
                2）单次灰度比例增幅不超过50%，每阶段灰度时间不低于
                {config.deployMode === 0 ? "1" : "10"}分钟。
              </p>
              <p>3）最后阶段固定为100%。审批通过后按配置阶段推进。</p>
              {config.deployMode === 0 && (
                <p>全量变更同样需要提交审批，审批通过后才执行发布。</p>
              )}
            </aside>
          </div>
        </>
      )}
      {mode === "experiment" && (
        <>
          <div className="experiment-section-heading">
            <h2>实验数据</h2>
            <Button onClick={() => setReview(true)}>查看实验内容</Button>
            <Button onClick={() => nav("/release/experiment-config?id=" + id)}>
              流量配置
            </Button>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
          </div>
          <Tabs
            activeKey={activeType}
            onChange={setType}
            items={[
              ...new Set<string>([
                ...(data.config.trafficSourceTypes || []),
                ...data.experimentResults.map((x: any) =>
                  String(x.trafficSourceType),
                ),
              ]),
            ].map((t) => ({
              key: t,
              label: types[t] || t,
              children: (
                <>
                  <DataObservation
                    result={data.experimentResults.find(
                      (x: any) => String(x.trafficSourceType) === t,
                    )}
                    sample={t === "3"}
                  />
                  <Section title="实验流量信息">
                    <TrafficInfo data={data} type={t} />
                  </Section>
                </>
              ),
            }))}
          />
        </>
      )}
      {mode === "gray-detail" && (
        <>
          <Section title="变更进程">
            <Progress
              percent={r.progress || 0}
              status={
                r.status === "已中止"
                  ? "exception"
                  : r.phase === "完成"
                    ? "success"
                    : "active"
              }
            />
            {r.status === "灰度中" && r.grayStageStartedAt && (
              <Remaining
                end={
                  Date.parse(r.grayStageStartedAt) +
                  (currentStages[r.grayStageIndex]?.grayTime || 0) * 60000
                }
              />
            )}
            <Steps
              size="small"
              current={
                r.grayStageIndex ??
                (r.phase === "完成" ? currentStages.length : -1)
              }
              status={r.status === "已中止" ? "error" : "process"}
              items={currentStages.map((s: any, i: number) => ({
                title: "阶段" + (i + 1),
                description:
                  s.grayRate +
                  "% / " +
                  (s.grayTime ? s.grayTime + "分钟" : "全量"),
              }))}
            />
          </Section>
          <Section title="变更配置">
            <Descriptions
              bordered
              column={3}
              items={[
                {
                  key: "description",
                  label: "变更说明",
                  children: r.description || "—",
                },
                {
                  key: "approver",
                  label: "指定审批人",
                  children: r.approver || "—",
                },
                {
                  key: "notify",
                  label: "通知人",
                  children: (r.notifyUsers || []).join("、") || "—",
                },
              ]}
            />
          </Section>
          <h2>灰度数据</h2>
          <Tabs
            activeKey={stage}
            onChange={setStage}
            items={(grayRows.length
              ? grayRows
              : currentStages.map((s: any) => ({ config: s }))
            ).map((g: any, i: number) => ({
              key: String(i),
              label:
                "阶段 " +
                (g.config?.stage || i + 1) +
                " · " +
                g.config?.grayRate +
                "%",
              children: (
                <>
                  <DataObservation result={g} gray />
                  <Trend
                    data={
                      g.statistics?.timeDatas ||
                      g.statistics?.grayTimeData ||
                      []
                    }
                  />
                </>
              ),
            }))}
          />
        </>
      )}
      {mode === "approval" && (
        <Section title="审批信息">
          <Descriptions
            bordered
            items={[
              {
                key: "state",
                label: "审批状态",
                children: r.approvalState || "尚未提交审批",
              },
              {
                key: "approver",
                label: "指定审批人",
                children: r.approver || "—",
              },
              {
                key: "time",
                label: "申请时间",
                children: formatDate(r.approvalSubmittedAt),
              },
              {
                key: "description",
                label: "变更说明",
                children: r.description || "—",
              },
              {
                key: "reason",
                label: "驳回理由",
                children: r.approvalReason || "—",
              },
            ]}
          />
          <p className="muted">
            本副本的审批由页面操作完成，不发送外部审批请求。
          </p>
          <ChangeContent data={data} reload={reload} />
        </Section>
      )}
      {!data.isSource && r.publishedAt && (
        <Alert
          showIcon
          type={r.status === "已回滚" ? "info" : "success"}
          style={{ margin: "20px 0" }}
          message={
            r.status === "已回滚"
              ? "已回滚，相关场景配置已恢复到发布前。"
              : `发布完成，已同步 ${data.publicationSummary.configurationCount} 项引用配置。`
          }
        />
      )}
      <WorkflowImpacts data={data.affected} />
      {!!data.events.length && (
        <Section title="操作记录">
          <Table<any>
            size="small"
            rowKey={(_, i) => String(i)}
            pagination={{ pageSize: 8 }}
            dataSource={data.events}
            columns={[
              { title: "时间", dataIndex: "time", render: formatDate },
              { title: "操作", dataIndex: "action" },
              { title: "操作人", dataIndex: "actor" },
              { title: "阶段", dataIndex: "phase" },
              { title: "状态", dataIndex: "status" },
              {
                title: "灰度进度",
                dataIndex: "progress",
                render: (v) => v + "%",
              },
            ]}
          />
        </Section>
      )}
      <Modal
        title="变更内容"
        open={review}
        onCancel={() => setReview(false)}
        width={1100}
        footer={null}
      >
        <ChangeContent data={data} reload={reload} />
      </Modal>
      <Modal
        title="审批驳回"
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={async () => {
          if (await actions("审批驳回", { reason })) setApproveOpen(false);
        }}
      >
        <Input.TextArea
          aria-label="驳回理由"
          placeholder="请输入驳回理由"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
function Trend({ data }: { data: any[] }) {
  const values = data.map((p: any) =>
    Number(p.grayHitRate ?? p.grayData?.hitRate ?? p.grayHitCount ?? NaN),
  );
  const finite = values.filter(Number.isFinite);
  const max = Math.max(...finite, 1);
  return (
    <Section title="灰度数据趋势">
      {finite.length ? (
        <svg
          viewBox="0 0 720 160"
          role="img"
          aria-label="灰度数据趋势"
          style={{ width: "100%", maxHeight: 200 }}
        >
          <line x1="20" y1="140" x2="700" y2="140" stroke="#d9d9d9" />
          <polyline
            fill="none"
            stroke="#1677ff"
            strokeWidth="2"
            points={values
              .map((v, i) =>
                Number.isFinite(v)
                  ? `${20 + (i * 680) / Math.max(values.length - 1, 1)},${140 - (v / max) * 120}`
                  : "",
              )
              .filter(Boolean)
              .join(" ")}
          />
        </svg>
      ) : (
        <Empty image={null} description="暂无数据" />
      )}
    </Section>
  );
}

function Remaining({ end }: { end: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const n = Math.max(0, Math.ceil((end - now) / 1000));
  return (
    <p className="muted">
      距离本阶段观察时间结束：{Math.floor(n / 60)}分{n % 60}秒
    </p>
  );
}
