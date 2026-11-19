import dayjs from "dayjs";
import { useEffect, useState } from "react";
import {
  DatePicker,
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useRemote } from "./components";
import {
  enterChangeEnvironment,
  leaveChangeEnvironment,
} from "./change-context";
import { ChangeReview } from "./ChangeReview";
import { Link } from "./navigation";
const kinds = [
  { key: "scene", label: "场景" },
  { key: "graph_template", label: "模版" },
  { key: "rule_group", label: "规则组" },
  { key: "rule", label: "规则" },
];
function target(r: any) {
  return r.module === "rulePage"
    ? "/ruleDetails?id=" + r.id
    : r.module === "layerScene"
      ? "/layerScene/detail?id=" + r.id
      : "/" + r.module + "?id=" + r.id;
}
function duration(seconds?: number) {
  if (seconds === undefined || seconds === null) return "—";
  const n = Math.max(0, Math.ceil(seconds / 60));
  return `${String(Math.floor(n / 1440)).padStart(2, "0")}天${String(Math.floor((n % 1440) / 60)).padStart(2, "0")}小时${String(n % 60).padStart(2, "0")}分`;
}
export function ExperimentConfigPage({
  id,
  detail = false,
}: {
  id: number;
  detail?: boolean;
}) {
  const { data, error, reload } = useRemote<any>(
    "/releases/" + id + "/experiment-config",
  );
  const [config, setConfig] = useState<any>(),
    [shown, setShown] = useState(kinds.map((k) => k.key)),
    [filterOpen, setFilterOpen] = useState(false),
    [review, setReview] = useState(false),
    [business, setBusiness] = useState(false),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const nav = useNavigate();
  useEffect(() => {
    if (data) setConfig(data.config);
  }, [data]);
  if (error) return <Alert type="error" message={error} />;
  if (!data || !config) return <Spin />;
  const editable = data.isEditable && !detail;
  const update = (key: string, v: any) =>
    setConfig({ ...config, [key]: { ...config[key], ...v } });
  const choose = (types: string[]) =>
    setConfig({ ...config, trafficSourceTypes: types });
  async function enter() {
    try {
      setBusy(true);
      if (editable)
        await api("/releases/" + id + "/experiment-config", "PUT", config);
      enterChangeEnvironment(id, "/scene");
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    try {
      setBusy(true);
      await api("/releases/" + id + "/experiment-config/start", "POST", config);
      message.success("实验配置已提交");
      nav("/release/experiment-detail?id=" + id);
      reload();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const sources = (
    <div className="experiment-source-tags">
      {data.trafficSources.length ? (
        data.trafficSources.map((s: any) => (
          <Tag key={s.module + ":" + s.id} title={s.label}>
            {s.label}
          </Tag>
        ))
      ) : (
        <span className="muted">暂无影响场景</span>
      )}
    </div>
  );
  const sampleTable = (rows: any[]) => (
    <Table<any>
      size="small"
      rowKey={(r: any) => r.key || r.id}
      dataSource={rows}
      pagination={false}
      scroll={{ y: 195 }}
      locale={{
        emptyText: <Empty image={null} description="暂无数据" />,
      }}
      columns={[
        {
          title: "场景",
          render: (_, r) => (
            <span>
              {r.id}-{r.name}
            </span>
          ),
        },
        {
          title: "投放量级",
          dataIndex: "sampleCount",
          width: 100,
          sorter: (a: any, b: any) =>
            (a.sampleCount || 0) - (b.sampleCount || 0),
        },
      ]}
    />
  );
  return (
    <div className="experiment-config-page">
      <div className="experiment-page-heading">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button
            type="text"
            aria-label="返回变更管理"
            icon={<ArrowLeftOutlined />}
            onClick={() => nav("/release/list")}
          />
          <h1>{detail ? "实验数据详情" : "变更实验项配置"}</h1>
        </div>
        <Space>
          <Button
            onClick={() => {
              leaveChangeEnvironment("/release/list");
            }}
          >
            取消变更
          </Button>
          <Button
            type="primary"
            disabled={!data.isEditable}
            loading={busy}
            onClick={enter}
          >
            变更环境
          </Button>
          {detail ? (
            <Button
              type="primary"
              disabled={
                data.task.phase !== "审批" && data.task.phase !== "灰度"
              }
              onClick={() => nav("/release/gray-config?id=" + id)}
            >
              去灰度
            </Button>
          ) : (
            <Button
              type="primary"
              disabled={!editable}
              loading={busy}
              onClick={start}
            >
              去实验
            </Button>
          )}
        </Space>
      </div>
      <section className="experiment-basic">
        <h2>变更基础信息</h2>
        <div>
          <span className="experiment-label">变更名称</span>
          <span>{data.task.name}</span>
        </div>
      </section>
      <div className="experiment-section-heading">
        <h2>{detail ? "实验流量信息" : "实验流量配置"}</h2>
        <Checkbox.Group
          value={config.trafficSourceTypes}
          disabled={!editable}
          onChange={(v) => choose(v as string[])}
        >
          <Checkbox value="0">双跑</Checkbox>
          <Checkbox value="1">历史</Checkbox>
          <Checkbox value="3" disabled={data.sampleRequired || !editable}>
            基准评测实验
          </Checkbox>
        </Checkbox.Group>
        {data.sampleRequired && (
          <span className="experiment-required-tip">
            <b>*</b>存在必做基准评测实验业务且不可取消，
            <Button type="link" onClick={() => setBusiness(true)}>
              业务明细
            </Button>
          </span>
        )}
      </div>
      <div
        className="experiment-flow-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, config.trafficSourceTypes.length)},minmax(0,1fr))`,
        }}
      >
        {config.trafficSourceTypes.includes("0") && (
          <section className="experiment-flow-card">
            <div className="experiment-card-heading">
              <h3>双跑</h3>
              <Tooltip title="来源快照的预估耗时；无来源估算时显示 —">
                <span>
                  <ClockCircleOutlined />
                  {duration(data.estimates.parallel)}
                </span>
              </Tooltip>
            </div>
            <div className="experiment-field">
              <label>
                <b>*</b>流量比例
              </label>
              <InputNumber
                aria-label="流量比例"
                min={0.01}
                max={100}
                value={config.parallel.rate}
                onChange={(v) => update("parallel", { rate: v })}
                disabled={!editable}
                addonAfter="%"
              />
              <Tooltip title="双跑实验使用的线上流量比例">
                <InfoCircleOutlined className="experiment-field-help" />
              </Tooltip>
            </div>
            <div className="experiment-field">
              <label>
                <b>*</b>结束时间
              </label>
              <DatePicker
                aria-label="结束时间"
                showTime
                format="YYYY-MM-DD HH:mm:ss"
                value={
                  config.parallel.endTime
                    ? dayjs(config.parallel.endTime)
                    : null
                }
                onChange={(v) =>
                  update("parallel", { endTime: v?.toISOString() || "" })
                }
                disabled={!editable}
                allowClear={false}
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
            <div className="experiment-field experiment-sources">
              <label>流量来源</label>
              {sources}
            </div>
            <div className="experiment-field">
              <label>流量筛选</label>
              <Button
                type="primary"
                onClick={() => {
                  form.setFieldsValue({ filters: config.parallel.filters });
                  setFilterOpen(true);
                }}
              >
                {editable ? "添加条件" : "查看条件"}(
                {config.parallel.filters.length})
              </Button>
            </div>
          </section>
        )}
        {config.trafficSourceTypes.includes("1") && (
          <section className="experiment-flow-card">
            <div className="experiment-card-heading">
              <h3>历史</h3>
              <span>
                <ClockCircleOutlined />
                {duration(data.estimates.history)}
              </span>
            </div>
            <div className="experiment-field">
              <label>
                <b>*</b>历史时长
              </label>
              <InputNumber
                aria-label="历史时长"
                min={1}
                max={30}
                precision={0}
                disabled={!editable}
                value={config.history.days}
                onChange={(v) => update("history", { days: v })}
                addonAfter="天"
              />
              <Tooltip title="回放最近指定天数的历史流量">
                <InfoCircleOutlined className="experiment-field-help" />
              </Tooltip>
            </div>
            <div className="experiment-field experiment-sources">
              <label>流量来源</label>
              {sources}
            </div>
          </section>
        )}
        {config.trafficSourceTypes.includes("3") && (
          <section className="experiment-flow-card experiment-benchmark">
            <div className="experiment-card-heading">
              <h3>
                <b>*</b>基准评测实验{" "}
                <Tooltip title="使用受影响业务对应的必防与回归样本">
                  <InfoCircleOutlined />
                </Tooltip>
              </h3>
              <span>
                <ClockCircleOutlined />
                {duration(data.estimates.sample)}
              </span>
            </div>
            <h4>
              <b>*</b>必防样本实验{" "}
              <Tooltip title="用于确认必须识别的风险样本">
                <InfoCircleOutlined />
              </Tooltip>
            </h4>
            {sampleTable(data.benchmark.blockSamples)}
            <h4>
              <b>*</b>回归样本实验{" "}
              <Tooltip title="包含黑样本与白样本的回归验证">
                <InfoCircleOutlined />
              </Tooltip>
            </h4>
            {sampleTable(
              [
                ...data.benchmark.regressBlackSamples,
                ...data.benchmark.regressWhiteSamples,
              ].map((s: any, i: number) => ({ ...s, key: s.id + "-" + i })),
            )}
          </section>
        )}
      </div>
      {!config.trafficSourceTypes.length && (
        <Alert type="warning" message="请至少选择一种实验流量" />
      )}
      <div className="experiment-section-heading experiment-content-heading">
        <h2>实验内容</h2>
        <Button type="primary" onClick={() => setReview(true)}>
          查看实验内容
        </Button>
        <Checkbox.Group
          value={shown}
          onChange={(v) => setShown(v as string[])}
          options={kinds.map((k) => ({ value: k.key, label: k.label }))}
        />
      </div>
      <div
        className="experiment-impact-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(shown.length, 1)},minmax(0,1fr))`,
        }}
      >
        {kinds
          .filter((k) => shown.includes(k.key))
          .map((k) => (
            <section className="experiment-impact-card" key={k.key}>
              <div className="experiment-card-heading">
                <h3>影响{k.label}</h3>
                <span>
                  <SearchOutlined />☷{data.affected[k.key].length}
                </span>
              </div>
              <Table<any>
                size="small"
                rowKey={(r) => r.module + ":" + r.id}
                dataSource={data.affected[k.key]}
                pagination={{
                  pageSize: 5,
                  showSizeChanger: false,
                  showQuickJumper: true,
                  showTotal: (n) => `共 ${n} 条`,
                  hideOnSinglePage: false,
                }}
                locale={{
                  emptyText: <Empty image={null} description="暂无数据" />,
                }}
                columns={[
                  {
                    title: "影响" + k.label + "ID",
                    dataIndex: "id",
                    width: "42%",
                  },
                  {
                    title: "影响" + k.label + "名称",
                    ellipsis: true,
                    render: (_, r) => (
                      <Link
                        to={target(r)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {r.name}
                      </Link>
                    ),
                  },
                ]}
              />
              {!data.affected[k.key].length && (
                <Pagination
                  total={0}
                  pageSize={5}
                  hideOnSinglePage={false}
                  showTotal={() => "共 0 条"}
                  showQuickJumper
                  size="small"
                  style={{
                    marginTop: "auto",
                    paddingTop: 16,
                    justifyContent: "flex-end",
                  }}
                />
              )}
            </section>
          ))}
      </div>
      <Modal
        title="流量筛选"
        open={filterOpen}
        width={820}
        onCancel={() => setFilterOpen(false)}
        okText={editable ? "确定" : "关闭"}
        onOk={async () => {
          if (!editable) return setFilterOpen(false);
          try {
            const v = await form.validateFields();
            update("parallel", { filters: v.filters || [] });
            setFilterOpen(false);
          } catch {}
        }}
      >
        <p className="muted">多个条件之间使用“且”组合。</p>
        <Form form={form} layout="vertical" disabled={!editable}>
          <Form.List name="filters">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline">
                    <Form.Item
                      {...rest}
                      name={[name, "field"]}
                      rules={[{ required: true, message: "请输入变量" }]}
                    >
                      <Input
                        aria-label={"筛选变量" + (name + 1)}
                        placeholder="特征英文名 / 输入变量"
                      />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, "operator"]}
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label={"筛选运算符" + (name + 1)}
                        style={{ width: 100 }}
                        options={[
                          "==",
                          "!=",
                          ">",
                          ">=",
                          "<",
                          "<=",
                          "包含",
                          "不包含",
                        ].map((value) => ({ value, label: value }))}
                      />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, "value"]}
                      rules={[{ required: true, message: "请输入值" }]}
                    >
                      <Input
                        aria-label={"筛选值" + (name + 1)}
                        placeholder="值"
                      />
                    </Form.Item>
                    {editable && (
                      <Button onClick={() => remove(name)}>删除</Button>
                    )}
                  </Space>
                ))}
                {editable && (
                  <Button onClick={() => add({ operator: "==" })}>
                    添加条件
                  </Button>
                )}
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal
        title="实验内容"
        open={review}
        width={1100}
        footer={null}
        onCancel={() => setReview(false)}
      >
        {data.task.sourceImported ? (
          <Table<any>
            rowKey={(r, i) => r.drillRecordId || String(i)}
            dataSource={data.changeItems}
            pagination={{ pageSize: 5 }}
            columns={[
              {
                title: "对象",
                render: (_, r) => r.objAlias || r.objName || r.objId,
              },
              {
                title: "变更前",
                dataIndex: "preContext",
                render: (v) => (
                  <pre style={{ whiteSpace: "pre-wrap" }}>{v}</pre>
                ),
              },
              {
                title: "变更后",
                dataIndex: "changedContext",
                render: (v) => (
                  <pre style={{ whiteSpace: "pre-wrap" }}>{v}</pre>
                ),
              },
            ]}
          />
        ) : (
          <ChangeReview task={data.task} onChanged={reload} />
        )}
      </Modal>
      <Modal
        title="基准评测实验业务明细"
        open={business}
        onCancel={() => setBusiness(false)}
        footer={<Button onClick={() => setBusiness(false)}>关闭</Button>}
        width={850}
      >
        {sampleTable(data.benchmark.blockSamples)}
      </Modal>
    </div>
  );
}
