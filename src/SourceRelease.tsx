import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tabs,
  Tag,
} from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, entityPath } from "./api";
import { ObjectDetails, RawData, SourceNotice } from "./SourceExamples";
import { PageHeader, Section, useRemote } from "./components";
const sourceNames: Record<string, string> = {
  "0": "双跑",
  "1": "回溯",
  "2": "回溯",
  "3": "基准评测实验",
};
function percent(v: any) {
  return v === undefined || v === null || Number(v) < 0
    ? "—"
    : (Number(v) * 100).toFixed(2) + "%";
}
function Metric({ value }: { value: any }) {
  if (value === null || value === undefined) return <>—</>;
  if (typeof value !== "object") return <>{String(value)}</>;
  if ("hitCount" in value || "hitRate" in value)
    return (
      <>
        {value.hitCount ?? "—"} / {percent(value.hitRate)}
      </>
    );
  if ("recallRate" in value) return <>{percent(value.recallRate)}</>;
  return <RawData value={value} title="查看指标" />;
}
function DiffContext({ value, after }: { value: any; after?: boolean }) {
  let parsed = value;
  try {
    parsed = JSON.parse(value);
  } catch {}
  if (!Array.isArray(parsed))
    return (
      <pre className="source-diff-code">
        {typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}
      </pre>
    );
  return (
    <div className="source-diff-context">
      {parsed.map((line: any, i: number) => (
        <div key={i} className="source-diff-line">
          {(Array.isArray(line) ? line : [line]).map((x: any, j: number) => (
            <span
              key={j}
              className={
                x.changed ? (after ? "diff-added" : "diff-removed") : ""
              }
            >
              {typeof x === "object" ? String(x.value ?? "") : String(x)}{" "}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
export function ReleaseCreator({
  open,
  onClose,
  onSaved,
  copy,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  copy?: any;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function save() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api(entityPath("release/list"), "POST", {
        name: values.name,
        changeSource: values.changeSource,
        phase: "实验",
        status: "待启动",
        progress: 0,
        type: "普通变更",
        copiedFrom: copy?.id || copy?.basic?.id,
        localChanges: Array.isArray(copy?.changes)
          ? copy.changes
          : copy?.changes?.list || [],
        experimentConfig: { trafficSourceTypes: ["0"], rate: 10 },
        grayConfig: [
          { stage: 1, grayRate: 1, grayTime: 5 },
          { stage: 2, grayRate: 10, grayTime: 10 },
          { stage: 3, grayRate: 50, grayTime: 10 },
          { stage: 4, grayRate: 100, grayTime: 10 },
        ],
      });
      message.success("本地变更任务已创建");
      onSaved();
      onClose();
      form.resetFields();
    } catch (e: any) {
      if (!e.errorFields) message.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="新建变更任务"
      width={550}
      open={open}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      okText="创建"
      cancelText="取消"
    >
      <Form
        form={form}
        labelCol={{ span: 6 }}
        initialValues={{ changeSource: "手动变更" }}
        style={{ paddingTop: 20 }}
      >
        <Form.Item
          name="name"
          label="任务名称"
          rules={[
            {
              required: true,
              pattern: /^[\u4e00-\u9fa5_a-zA-Z0-9]{1,100}$/,
              message: "支持中英文、数字、下划线、最多100字",
            },
          ]}
        >
          <Input
            maxLength={100}
            placeholder="支持中英文、数字、下划线、最多100字"
          />
        </Form.Item>
        <Form.Item name="changeSource" label="变更来源">
          <Radio.Group optionType="button" options={["手动变更", "AI变更"]} />
        </Form.Item>
        {copy && (
          <Alert
            type="info"
            message={
              copy.id
                ? `将复制任务 ${copy.id} 的变更内容到新的本地任务。`
                : "将所选策略调整保存到变更任务，发布完成后应用。"
            }
          />
        )}
        <p className="muted">
          创建后在「Zeus → 策略变更 →
          变更管理」生成本地变更任务。所有实验、审批和发布均限本地副本。
        </p>
      </Form>
    </Modal>
  );
}
export function SourceReleasePage() {
  const [params] = useSearchParams();
  const id = Number(params.get("id"));
  const route = useLocation().pathname;
  const tab = route.includes("experiment")
    ? "experiment"
    : route.includes("gray")
      ? "gray"
      : "changes";
  const { data, error } = useRemote<any>("/source/archive/release/" + id);
  const nav = useNavigate();
  const [create, setCreate] = useState(false);
  const active = tab;
  const [stage, setStage] = useState(0);
  if (error) return <Alert type="error" message={error} />;
  if (!data) return <Spin />;
  const basic = data.basic;
  const changeItems = data.changes?.list || [];
  return (
    <>
      <PageHeader
        title={
          active === "experiment"
            ? "实验数据详情"
            : active === "gray"
              ? "灰度详情"
              : "变更内容"
        }
      >
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => nav("/release/list")}
        >
          返回变更管理
        </Button>
        <Button onClick={() => setCreate(true)}>新建变更</Button>
        <RawData value={data} />
      </PageHeader>
      <SourceNotice />
      <Section title="变更基础信息">
        <Descriptions
          column={3}
          items={[
            { key: "name", label: "变更名称", children: basic.name },
            { key: "id", label: "任务ID", children: id },
            {
              key: "status",
              label: "实验进度",
              children: (
                <Tag color="green">
                  {basic.status === 9
                    ? "灰度阶段-发布完成"
                    : String(basic.status)}
                </Tag>
              ),
            },
            { key: "creator", label: "发起人", children: basic.creator },
            {
              key: "time",
              label: "发起时间",
              children: new Date(
                basic.startDeployTime || basic.addTime,
              ).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
            },
            {
              key: "mode",
              label: "发布模式",
              children: basic.deployMode === 0 ? "紧急发布" : "灰度发布",
            },
          ]}
        />
        <p>
          {data.summary?.changeSummary}　{data.summary?.affectedSummary}
        </p>
      </Section>
      <Tabs
        activeKey={active}
        onChange={(key) =>
          nav(
            "/release/" +
              (key === "changes" ? "detail" : key + "-detail") +
              "?id=" +
              id,
          )
        }
        items={[
          {
            key: "changes",
            label: "变更内容",
            children: (
              <>
                <p>
                  共变更了{" "}
                  <b>{data.changes?.changeNum ?? changeItems.length}</b>{" "}
                  条内容，将对 <b>{data.changes?.sceneNum ?? 0}</b>{" "}
                  个场景产生影响
                </p>
                <Table<any>
                  rowKey={(r, i) => String(r.drillRecordId ?? i)}
                  dataSource={changeItems}
                  scroll={{ x: 1100 }}
                  pagination={{ defaultPageSize: 10, showSizeChanger: true }}
                  columns={[
                    {
                      title: "变更类型",
                      dataIndex: "objType",
                      width: 100,
                      render: (v) =>
                        (
                          ({
                            0: "场景",
                            1: "规则组",
                            2: "规则",
                            3: "因子",
                            4: "参数",
                            17: "分层场景",
                            26: "分层模板",
                          }) as any
                        )[v] || v,
                    },
                    { title: "ID", dataIndex: "objId", width: 100 },
                    {
                      title: "名称",
                      render: (_, r) => <span>{r.objAlias || r.objName}</span>,
                      width: 220,
                    },
                    {
                      title: "变更前",
                      dataIndex: "preContext",
                      render: (v) => <DiffContext value={v} />,
                    },
                    {
                      title: "变更后",
                      dataIndex: "changedContext",
                      render: (v) => <DiffContext value={v} after />,
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (r) => (
                      <Section title="受影响场景">
                        <Table<any>
                          rowKey={(x, i) => String(x.sceneId ?? i)}
                          dataSource={r.drillRecordAffectedSceneVoList || []}
                          columns={[
                            { title: "场景ID", dataIndex: "sceneId" },
                            { title: "场景名称", dataIndex: "sceneName" },
                            { title: "类型", dataIndex: "type" },
                          ]}
                        />
                        <RawData value={r} />
                      </Section>
                    ),
                  }}
                />
              </>
            ),
          },
          {
            key: "experiment",
            label: "实验详情",
            children: (
              <>
                <Section title="实验数据">
                  {(data.experimentResults || []).map((r: any, i: number) => (
                    <Section
                      key={i}
                      title={
                        sourceNames[r.trafficSourceType] ||
                        "实验 " + r.trafficSourceType
                      }
                    >
                      <SummaryStatistics data={r.statistics} />
                      <Section title="数据对比">
                        <CompareTable
                          data={r.comparison}
                          sample={r.trafficSourceType === "3"}
                        />
                      </Section>
                      <RequestIds data={r.details} />
                    </Section>
                  ))}
                </Section>
                <Section title="实验配置与执行过程">
                  <Tabs
                    items={(data.experiments || []).map((e: any) => ({
                      key: String(e.id),
                      label: "实验任务 " + e.id,
                      children: (
                        <>
                          <ObjectDetails value={e.detail?.trafficSource} />
                          <Table<any>
                            rowKey={(r, i) => String(r.id ?? i)}
                            pagination={false}
                            dataSource={e.detail?.experimentalProcess || []}
                            columns={[
                              { title: "时间", dataIndex: "time" },
                              { title: "过程", dataIndex: "desc" },
                            ]}
                          />
                        </>
                      ),
                    }))}
                  />
                </Section>
                <Affected data={data.affected} />
              </>
            ),
          },
          {
            key: "gray",
            label: "灰度详情",
            children: (
              <>
                <Section title="灰度发布配置">
                  <Table<any>
                    rowKey={(r, i) => String(r.stage ?? i)}
                    pagination={false}
                    dataSource={basic.autoDeployConfig || []}
                    columns={[
                      { title: "阶段", dataIndex: "stage" },
                      {
                        title: "灰度比例",
                        dataIndex: "grayRate",
                        render: (v) => `${v}%`,
                      },
                      {
                        title: "持续时长",
                        dataIndex: "grayTime",
                        render: (v) => `${v} 分钟`,
                      },
                      {
                        title: "完整配置",
                        render: (_, r) => <RawData value={r} />,
                      },
                    ]}
                  />
                </Section>
                <Section title="灰度数据">
                  <Tabs
                    activeKey={String(stage)}
                    onChange={(v) => setStage(Number(v))}
                    items={(data.grayStages || []).map((g: any, i: number) => ({
                      key: String(i),
                      label: `阶段 ${g.config?.stage} · ${g.config?.grayRate}%`,
                      children: (
                        <>
                          <SummaryStatistics data={g.statistics} />
                          <Section title="数据对比">
                            <CompareTable data={g.comparison} gray />
                          </Section>
                          <RequestIds data={g.details} />
                        </>
                      ),
                    }))}
                  />
                </Section>
              </>
            ),
          },
        ]}
      />
      <ReleaseCreator
        open={create}
        onClose={() => setCreate(false)}
        onSaved={() => nav("/release/list")}
        copy={{ id, changes: changeItems }}
      />
    </>
  );
}
function CompareTable({
  data,
  sample,
  gray,
}: {
  data: any;
  sample?: boolean;
  gray?: boolean;
}) {
  const rows = data?.items?.length
    ? data.items
    : data?.sceneCompareDatas || data?.list || [];
  const columns: any[] = [
    {
      title: "场景",
      render: (_: any, r: any) =>
        `${r.sceneId ?? r.id ?? ""}-${r.sceneName || r.name || ""}`,
    },
  ];
  const keys = sample
    ? [
        ["blockRecallData", "必防样本-召回率"],
        ["regressionRecallData", "回归样本-召回率"],
        ["regressionFalsePositiveData", "回归样本-误伤率"],
      ]
    : gray
      ? [
          ["grayHitData", "灰度命中"],
          ["onlineHitData", "线上命中"],
        ]
      : [
          ["labHitData", "实验命中"],
          ["labIndependentHitData", "实验独立命中"],
          ["onlineHitData", "线上命中"],
          ["onlineIndependentHitData", "线上独立命中"],
        ];
  for (const [key, title] of keys)
    columns.push({
      title,
      dataIndex: key,
      render: (v: any, r: any) => (
        <Metric
          value={
            v ??
            r[key.replace("HitData", "Data")] ??
            r[key.replace("Data", "Rate")]
          }
        />
      ),
    });
  columns.push({
    title: "详细数据",
    render: (_: any, r: any) => <RawData value={r} />,
  });
  return (
    <>
      <>
        {data?.sourceCountMismatch && (
          <Alert
            type="warning"
            message={`源平台报告 ${data.total} 条，分页实际返回 ${data.capturedCount} 条；已保留所有返回数据。`}
          />
        )}
      </>
      <Table<any>
        rowKey={(r, i) => String(r.sceneId ?? r.id ?? i)}
        dataSource={rows}
        columns={columns}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (n) => `共 ${n} 条`,
        }}
      />
    </>
  );
}
function RequestIds({ data }: { data: any }) {
  const items = data?.items || data?.requestIds || [];
  const [q, setQ] = useState("");
  return (
    <Section title={`数据明细（共 ${data?.total ?? items.length} 条）`}>
      <Input.Search
        style={{ maxWidth: 500, marginBottom: 16 }}
        placeholder="搜索已导入的请求ID"
        allowClear
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Table<any>
        rowKey={(r: any) => r.requestId}
        dataSource={items
          .map((x: any, i: number) => ({
            id: i + 1,
            requestId:
              typeof x === "string" ? x : x.requestId || JSON.stringify(x),
          }))
          .filter((r: any) => !q || r.requestId.includes(q))}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "请求ID", dataIndex: "requestId" },
        ]}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      />
    </Section>
  );
}
function Affected({ data }: { data: any }) {
  return (
    <Section title="实验内容">
      <Tabs
        items={Object.entries(data || {}).map(
          ([key, value]: [string, any]) => ({
            key,
            label:
              (
                {
                  scene: "影响场景",
                  template: "影响模板",
                  graph_template: "影响模板",
                  rule_group: "影响规则组",
                  rule: "影响规则",
                } as any
              )[key] || key,
            children: (
              <Table<any>
                rowKey="id"
                dataSource={value?.[key] || []}
                columns={[
                  { title: "ID", dataIndex: "id" },
                  { title: "名称", dataIndex: "name" },
                ]}
                pagination={{
                  defaultPageSize: 10,
                  showTotal: (n) => `共 ${n} 条`,
                }}
              />
            ),
          }),
        )}
      />
    </Section>
  );
}

function SummaryStatistics({ data }: { data: any }) {
  const names: Record<string, string> = {
    labData: "实验数据",
    onlineData: "线上数据",
    grayData: "灰度数据",
    blockRecallData: "必防样本召回",
    regressionRecallData: "回归样本召回",
    regressionFalsePositiveData: "回归样本误伤",
    labRecallData: "实验召回",
    labPrecisionData: "实验精确率",
  };
  if (!data) return <Empty description="该任务没有此类实验数据" />;
  return (
    <>
      <Descriptions
        bordered
        column={3}
        items={Object.entries(names)
          .filter(([key]) => data[key])
          .map(([key, label]) => ({
            key,
            label,
            children: (
              <>
                <Metric value={data[key]} />
                <div className="muted">
                  请求量 {data[key].requestCount ?? "—"}
                </div>
              </>
            ),
          }))}
      />
      <div style={{ marginTop: 12 }}>
        <RawData value={data} title="查看完整指标、时序与SQL" />
      </div>
    </>
  );
}
