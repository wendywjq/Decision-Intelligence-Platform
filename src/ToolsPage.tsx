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
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import type { Module } from "./catalog";
import { api } from "./api";
import { FieldControl, PageHeader, Section, useRemote } from "./components";
export function ToolsPage({ module: m }: { module: Module }) {
  const { message } = App.useApp();
  const [tab, setTab] = useState(m.tabs?.[0]);
  const [values, setValues] = useState<Record<string, any>>({
    objectType: "规则",
    status: "生效",
    queryMode: "实时查询",
    cumulativeType: "读累计",
    resourceType: "CANVAS",
    match: "PREFIX",
  });
  const [result, setResult] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [expression, setExpression] = useState("riskScore > 0.9");
  const [input, setInput] = useState('{"riskScore":0.95}');
  const [custom, setCustom] = useState(false);
  const [sql, setSql] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form] = Form.useForm();
  const [health, setHealth] = useState<React.Key[]>([]);
  const update = (key: string, value: any) =>
    setValues((v) => ({ ...v, [key]: value }));
  const settings = useRemote<any>(
    "/settings/logConfig-" + (tab || "实时日志接入"),
  );
  useEffect(() => {
    if (m.kind === "logConfig" && settings.data) {
      form.resetFields();
      form.setFieldsValue(settings.data);
    }
  }, [settings.data, m.kind, form]);
  async function query(kind = m.kind) {
    setBusy(true);
    try {
      if (kind === "expression") {
        const data = await api("/evaluate", "POST", { expression, input });
        setResult(data);
      } else if (kind === "relation" || kind === "lineage") {
        if (!values.id) throw Error("请输入检索对象标识");
        setResult(await api("/relations?id=" + encodeURIComponent(values.id)));
      } else if (kind === "probe") {
        if (!values.requestId || !values.ruleId || !values.sceneId)
          throw Error("请填写RequestId、规则和场景");
        setResult(await api("/probe", "POST", values));
      } else if (kind === "cumulative") {
        if (!values.factor) throw Error("请选择累计因子");
        setResult(
          await api(
            "/cumulative?factor=" +
              values.factor +
              "&key=" +
              encodeURIComponent(values.key || ""),
          ),
        );
      } else
        setResult(
          await api("/requests?q=" + encodeURIComponent(values.q || "")),
        );
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const control = (
    key: string,
    label: string,
    options?: string[],
    required = false,
  ) => (
    <label className="tool-field" key={key}>
      <span>
        {required && <b className="required">* </b>}
        {label}:
      </span>
      <FieldControl
        field={{ key, label, options }}
        value={values[key]}
        onChange={(v) => update(key, v)}
      />
    </label>
  );
  const resultTable = (
    <Table
      rowKey="id"
      dataSource={result?.items || []}
      columns={
        result?.columns || [
          { title: "RequestId", dataIndex: "requestId" },
          { title: "场景", dataIndex: "scene" },
          { title: "决策", dataIndex: "decision" },
          { title: "命中规则", dataIndex: "ruleId" },
          { title: "时间", dataIndex: "time" },
        ]
      }
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={result ? "暂无匹配的示例数据" : "暂无数据"}
          />
        ),
      }}
    />
  );
  return (
    <>
      <PageHeader title={m.title}>
        {m.kind === "investigate" && (
          <>
            <Button
              onClick={() =>
                message.info("参见仓库 README 和 docs/coverage.md")
              }
            >
              策略排查用户手册
            </Button>
            <Button onClick={() => message.info("请到仓库 Issues 提交反馈")}>
              问题反馈
            </Button>
          </>
        )}
      </PageHeader>
      {m.tabs && (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={m.tabs.map((label) => ({ key: label, label }))}
        />
      )}
      {m.kind === "investigate" && (
        <>
          <Tabs
            items={["策略排查", "日志查询"].map((label) => ({
              key: label,
              label,
            }))}
          />
          <div className="query-toolbar">
            <span>新查询</span>
            <Space>
              <Button
                onClick={async () => {
                  try {
                    await api("/settings/favorite-query", "PUT", values);
                    setSaved(true);
                    message.success("查询条件已收藏");
                  } catch (e: any) {
                    message.error(e.message);
                  }
                }}
              >
                {saved ? "已收藏" : "☆ 收藏"}
              </Button>
              <Button
                onClick={async () => {
                  const data = await api("/settings/favorite-query");
                  setValues(data);
                }}
              >
                查看收藏
              </Button>
              <Button
                onClick={() => {
                  navigator.clipboard
                    .writeText(location.href)
                    .then(() => message.success("链接已复制"))
                    .catch(() => message.info(location.href));
                }}
              >
                分享
              </Button>
            </Space>
          </div>
          <div className="query-panel">
            <label className="tool-field">
              <span>时间范围:</span>
              <Input type="datetime-local" />
              <span>~</span>
              <Input type="datetime-local" />
            </label>
            <div className="quick-times">
              {[
                "近5分钟",
                "近10分钟",
                "近1小时",
                "近6小时",
                "近12小时",
                "近1天",
                "近3天",
                "近7天",
                "近15天",
              ].map((t) => (
                <Button
                  key={t}
                  type={values.time === t ? "primary" : "link"}
                  onClick={() => update("time", t)}
                >
                  {t}
                </Button>
              ))}
            </div>
            <div className="tool-field">
              <span>目标类型</span>
              <Checkbox.Group
                defaultValue={["实时"]}
                options={["实时", "离线", "近线", "全部"]}
                onChange={(v) => update("targetType", v)}
              />
            </div>
            <div className="tool-field">
              <span>快捷筛选</span>
              <Checkbox
                onChange={(e) => update("excludePass", e.target.checked)}
              >
                排除「通过」
              </Checkbox>
              <Checkbox>排除「写名单、写累计」</Checkbox>
            </div>
            <Button onClick={() => setCustom((v) => !v)}>自定义筛选</Button>
            {custom && (
              <div className="filter-panel">
                {control("q", "RequestId/场景ID/规则ID")}
                {control("decision", "决策", ["通过", "人工审核", "拒绝"])}
                {control("owner", "MISID")}
              </div>
            )}
            <div className="query-buttons">
              <Button
                onClick={() => {
                  setSql(true);
                }}
              >
                转SQL离线查询
              </Button>
              <Button onClick={() => (location.hash = "/analysis")}>
                聚合分析
              </Button>
              <Button
                onClick={() => {
                  setValues({});
                  setResult(undefined);
                }}
              >
                重置
              </Button>
              <Button type="primary" loading={busy} onClick={() => query()}>
                查询
              </Button>
            </div>
          </div>
          <Section
            title={`查询结果（共${result?.items?.length || 0}条）`}
            extra={
              <Space>
                <Button onClick={() => setCustom(true)}>自定义表头</Button>
                <Button onClick={() => setSql((v) => !v)}>查看SQL</Button>
              </Space>
            }
          >
            {sql && (
              <pre className="code-editor">
                SELECT * FROM example_requests WHERE scene_id = :scene_id;
              </pre>
            )}
            <Alert
              type="info"
              message="查询本地示例请求数据，未连接线上风险日志。"
            />
            {resultTable}
          </Section>
        </>
      )}
      {m.kind === "probe" && (
        <>
          <div className="tool-form">
            {control("objectType", "排查对象", ["规则", "特征"])}
            {control("requestId", "RequestId", undefined, true)}
            {control("ruleId", "规则", undefined, true)}
            {control("sceneId", "规则所在场景", undefined, true)}
            <label className="tool-field">
              <span>规则在场景中状态:</span>
              <Radio.Group
                value={values.status}
                onChange={(e) => update("status", e.target.value)}
                options={["生效", "标记", "灰度"]}
              />
            </label>
            <Button type="primary" loading={busy} onClick={() => query()}>
              查询
            </Button>
            <span className="muted">仅查询本地示例数据</span>
          </div>
          {result && (
            <Section title="排查结果">
              <Alert type="info" message={result.summary} />
              <Descriptions
                bordered
                items={Object.entries(result)
                  .filter(([k]) => k !== "summary")
                  .map(([key, value]) => ({
                    key,
                    label: key,
                    children: JSON.stringify(value),
                  }))}
              />
            </Section>
          )}
        </>
      )}
      {m.kind === "cumulative" && (
        <>
          <div className="tool-form">
            <label className="tool-field">
              <span>排查类型:</span>
              <Radio.Group
                value={values.cumulativeType}
                onChange={(e) => update("cumulativeType", e.target.value)}
                options={["读累计", "写累计"]}
              />
            </label>
            <label className="tool-field">
              <span>查询方式:</span>
              <Radio.Group
                value={values.queryMode}
                onChange={(e) => update("queryMode", e.target.value)}
                options={["实时查询", "离线查询"]}
              />
            </label>
            <Section title="基本信息">
              {control("factor", "累计因子", ["requestCount"], true)}
              {control("key", "累计主体", undefined, true)}
            </Section>
            <Space>
              <Button type="primary" loading={busy} onClick={() => query()}>
                查询
              </Button>
              <Button onClick={() => query()}>智能排查</Button>
            </Space>
          </div>
          {result && (
            <Section title="查询结果">
              <Alert message="当前为本地示例累计值。" />
              <Descriptions
                items={[
                  { key: "factor", label: "累计因子", children: result.factor },
                  { key: "value", label: "累计值", children: result.value },
                  { key: "window", label: "时间窗口", children: result.window },
                ]}
              />
            </Section>
          )}
        </>
      )}
      {m.kind === "expression" && (
        <>
          <Alert
            message="示例引擎支持变量与常量比较及 && / ||。完整 Aviator、SQL 和近线 UDF 尚未接入。"
            type="info"
            showIcon
          />
          <Section title="逻辑信息">
            <p>aviator表达式:</p>
            <Input.TextArea
              rows={5}
              className="monospace"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
            />
            <Button style={{ marginTop: 12 }} onClick={() => query()}>
              确定
            </Button>
          </Section>
          <Section title="添加测试信息">
            <Radio.Group
              defaultValue="Json模式"
              options={["选填模式", "Json模式"]}
            />
            <p>输入参数:</p>
            <Input.TextArea
              rows={5}
              value={input}
              className="monospace"
              onChange={(e) => setInput(e.target.value)}
            />
            <p>期望输出类型：Boolean</p>
            <Space>
              <Button type="primary" loading={busy} onClick={() => query()}>
                测试选中语句
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await api("/settings/expression-case", "PUT", {
                      expression,
                      input,
                    });
                    message.success("测试用例已保存");
                  } catch (e: any) {
                    message.error(e.message);
                  }
                }}
              >
                添加测试用例
              </Button>
              <Button
                onClick={async () => {
                  const data = await api("/settings/expression-case");
                  if (data.expression) {
                    setExpression(data.expression);
                    setInput(data.input);
                  }
                }}
              >
                读取测试用例
              </Button>
            </Space>
          </Section>
          <Section title="测试结果">
            {result ? (
              <Descriptions
                items={[
                  {
                    key: "r",
                    label: "实际输出",
                    children: String(result.result),
                  },
                ]}
              />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Section>
        </>
      )}
      {["relation", "lineage"].includes(m.kind || "") && (
        <>
          <div className="tool-form">
            {control(
              "resourceType",
              m.kind === "lineage" ? "检索对象类型" : "起始依赖类型",
              [
                "CANVAS",
                "SCENE",
                "RULE",
                "FEATURE",
                "TOPIC",
                "DATA_SOURCE_TASK",
              ],
              true,
            )}
            {control(
              "id",
              m.kind === "lineage" ? "检索对象标识" : "起始依赖信息",
              undefined,
              true,
            )}
            {control("direction", "依赖关系", ["被引用", "引用"])}
            {control("filterType", "依赖类型过滤", ["场景", "规则", "特征"])}
            <Space>
              <Button type="primary" loading={busy} onClick={() => query()}>
                检索
              </Button>
              <Button
                onClick={() => {
                  setValues({});
                  setResult(undefined);
                }}
              >
                清空
              </Button>
            </Space>
          </div>
          <Section title="查询结果">
            <Alert
              type="info"
              message="仅检索本地数据库内的场景与规则引用关系。"
            />
            <Table
              rowKey="id"
              dataSource={result?.items || []}
              columns={[
                { title: "场景ID", dataIndex: "scene_id" },
                { title: "规则ID", dataIndex: "rule_id" },
                { title: "场景名称", dataIndex: "name" },
                { title: "状态", dataIndex: "status" },
                { title: "决策", dataIndex: "decision" },
              ]}
            />
          </Section>
        </>
      )}
      {m.kind === "logConfig" && (
        <Form form={form} layout="vertical">
          <Section title="分词字段">
            <div className="log-fields">
              {Array.from({ length: 10 }, (_, i) => (
                <Form.Item key={i} name={"token_" + i}>
                  <Input placeholder={"字段 " + (i + 1)} />
                </Form.Item>
              ))}
            </div>
          </Section>
          <Section title="非分词字段">
            <div className="log-fields">
              {Array.from({ length: 20 }, (_, i) => (
                <Form.Item key={i} name={"raw_" + i}>
                  <Input placeholder={"字段 " + (i + 1)} />
                </Form.Item>
              ))}
            </div>
          </Section>
          <Button
            type="primary"
            onClick={async () => {
              try {
                await api(
                  "/settings/logConfig-" + (tab || "实时日志接入"),
                  "PUT",
                  form.getFieldsValue(),
                );
                settings.reload();
                message.success("日志配置已更新");
              } catch (e: any) {
                message.error(e.message);
              }
            }}
          >
            更新
          </Button>
        </Form>
      )}
      {m.kind === "health" && (
        <>
          <Tabs
            items={["场景配置", "规则", "因子", "数据接口", "参数"].map(
              (label) => ({ key: label, label }),
            )}
          />
          <Space>
            <Button
              disabled={!health.length}
              onClick={async () => {
                await api("/settings/health-handling", "PUT", {
                  ids: health,
                  action: "降级",
                });
                message.success("本地处理记录已保存");
              }}
            >
              批量降级
            </Button>
            <Button
              disabled={!health.length}
              onClick={async () => {
                await api("/settings/health-handling", "PUT", {
                  ids: health,
                  action: "加白",
                });
                message.success("本地处理记录已保存");
              }}
            >
              批量加白
            </Button>
          </Space>
          <Alert
            type="info"
            message="尚未接入健康度扫描服务，暂无待处理记录。"
          />
          <Table
            rowKey="id"
            rowSelection={{ selectedRowKeys: health, onChange: setHealth }}
            dataSource={[]}
            columns={[
              { title: "对象ID", dataIndex: "id" },
              { title: "名称", dataIndex: "name" },
              { title: "问题描述", dataIndex: "description" },
              { title: "负责人", dataIndex: "owner" },
            ]}
          />
        </>
      )}
    </>
  );
}
