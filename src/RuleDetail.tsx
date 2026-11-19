import { RiskTagChips } from "./RiskTagSelect";
import { RuleReferenceStats } from "./RuleReferenceStats";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import { ArrowLeftOutlined, CheckCircleFilled } from "@ant-design/icons";
import { api, entityPath } from "./api";
import { moduleMap } from "./catalog";
import { EntityEditor, PageHeader, Section, useRemote } from "./components";
import { VersionList } from "./ModulePage";
import { ImportedRulePage } from "./SourceExamples";
export function RuleDetail() {
  const [params] = useSearchParams();
  const id = Number(params.get("id"));
  const navigate = useNavigate();
  const { message } = App.useApp();
  const {
    data: rule,
    error,
    reload,
  } = useRemote<any>(entityPath("rulePage", id));
  const tests = useRemote<{ items: any[] }>("/rules/" + id + "/tests");
  const features = useRemote<{ items: any[] }>(
    "/source/rules/" + id + "/features",
  );
  const [tab, setTab] = useState("基本信息");
  const [display, setDisplay] = useState("交互式");
  const [edit, setEdit] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [input, setInput] = useState('{\n  "riskScore": 0.95\n}');
  const [expected, setExpected] = useState(true);
  const [mode, setMode] = useState("Json串模式");
  const [running, setRunning] = useState(false);
  const [visual, setVisual] = useState(false);
  async function test() {
    try {
      setRunning(true);
      const result = await api("/rules/" + id + "/test", "POST", {
        input,
        expected,
      });
      tests.reload();
      message[result.passed ? "success" : "warning"](
        result.passed ? "测试通过" : "实际输出与期望输出不一致",
      );
      setTestOpen(false);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setRunning(false);
    }
  }
  if (error)
    return (
      <Alert
        type="error"
        message={error}
        action={
          <Button onClick={() => navigate("/rulePage")}>返回规则列表</Button>
        }
      />
    );
  if (!rule) return <p>加载中...</p>;
  if (rule.sourceImported) return <ImportedRulePage id={id} row={rule} />;
  const conditions = rule.expression?.match(
    /^([A-Za-z_]\w*)\s*(>=|<=|==|!=|>|<)\s*(.*)$/,
  );
  const operators: Record<string, string> = {
    ">": "大于",
    ">=": "大于等于",
    "<": "小于",
    "<=": "小于等于",
    "==": "等于",
    "!=": "不等于",
  };
  return (
    <>
      <PageHeader title="规则详情">
        <Popconfirm
          title="删除这条本地规则？"
          onConfirm={async () => {
            try {
              await api(entityPath("rulePage", id), "DELETE");
              navigate("/rulePage");
            } catch (e: any) {
              message.error(e.message);
            }
          }}
        >
          <Button>删除</Button>
        </Popconfirm>
        <Button
          onClick={async () => {
            try {
              const copy = await api(
                entityPath("rulePage", id) + "/copy",
                "POST",
              );
              navigate("/ruleDetails?id=" + copy.id);
            } catch (e: any) {
              message.error(e.message);
            }
          }}
        >
          复制
        </Button>
        <Button onClick={() => setEdit(true)}>编辑属性信息</Button>
        <Button type="primary" onClick={() => setEdit(true)}>
          编辑逻辑信息
        </Button>
      </PageHeader>
      <div className="detail-status">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/rulePage")}
        >
          返回
        </Button>
        <Tag color="green">{rule.status || "就绪"}</Tag>
      </div>
      <RuleReferenceStats id={id} />
      {rule.pendingAction && (
        <Alert
          type="warning"
          message={"当前变更：" + rule.pendingAction + "，发布前不影响线上"}
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={["基本信息", "引用特征信息", "版本信息", "被引用情况"].map(
          (label) => ({ key: label, label }),
        )}
      />
      {tab === "基本信息" && (
        <>
          <Section title="逻辑信息">
            <Descriptions
              column={3}
              items={[
                { key: "id", label: "ID", children: rule.id },
                { key: "name", label: "中文名称", children: rule.name },
                { key: "en", label: "英文名称", children: rule.enName || "—" },
                {
                  key: "status",
                  label: "状态",
                  children: (
                    <span className="status-on">
                      <CheckCircleFilled /> 就绪
                    </span>
                  ),
                },
              ]}
            />
            <div className="display-mode">
              <span>展示方式</span>
              <Radio.Group
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
                optionType="button"
                options={["交互式", "表达式", "SQL"]}
              />
              <Button
                onClick={() =>
                  Modal.info({
                    title: "规则解释及血缘分析",
                    content: (
                      <>
                        <p>表达式：{rule.expression}</p>
                        <p>
                          当输入变量满足比较条件时命中。该规则可在场景中配置对应决策。
                        </p>
                        <p>当前仅提供本地表达式说明，未接入AI服务。</p>
                      </>
                    ),
                  })
                }
              >
                AI规则解释及血缘分析
              </Button>
            </div>
            <div className="logic-links">
              <button
                className="text-link"
                onClick={() =>
                  Modal.info({
                    title: "示例表达式支持范围",
                    content:
                      "支持 >、>=、<、<=、==、!= 比较，支持 && 和 ||；输入为 JSON 对象。完整 Aviator 与 SQL 执行引擎尚未接入。",
                  })
                }
              >
                函数/操作符/数据类型
              </button>
              <Button type="link" onClick={() => navigate("/featureService")}>
                特征发现
              </Button>
            </div>
            {display === "交互式" ? (
              <>
                <Table
                  pagination={false}
                  rowKey="id"
                  dataSource={
                    rule.ruleConditions?.length
                      ? rule.ruleConditions.map((c: any, i: number) => ({
                          id: i + 1,
                          left: c.feature,
                          op: operators[c.operator] || c.operator,
                          right: c.value,
                        }))
                      : [
                          {
                            id: 1,
                            left: conditions?.[1] || "复合表达式",
                            op: conditions ? operators[conditions[2]] : "—",
                            right: conditions?.[3] || rule.expression,
                          },
                        ]
                  }
                  columns={[
                    { title: "条件", dataIndex: "id", width: 100 },
                    {
                      title: "左变量",
                      dataIndex: "left",
                      render: (v) => (
                        <a onClick={() => navigate("/featureService")}>{v}</a>
                      ),
                    },
                    { title: "操作符", dataIndex: "op" },
                    { title: "右变量", dataIndex: "right" },
                  ]}
                />
                <div className="condition-logic">
                  条件间逻辑： <code>{rule.conditionLogic || "1"}</code>
                </div>
              </>
            ) : (
              <pre className="code-editor">
                {display === "SQL"
                  ? `SELECT CASE WHEN ${rule.expression} THEN TRUE ELSE FALSE END AS hit;`
                  : rule.expression}
              </pre>
            )}
            <Button onClick={() => setVisual(true)}>查看可视化计算逻辑</Button>
          </Section>
          <Section
            title="测试用例列表"
            extra={
              <Button type="primary" onClick={() => setTestOpen(true)}>
                添加测试用例
              </Button>
            }
          >
            <Tabs
              items={["当前测试结果", "历史测试结果", "ai测试结果"].map(
                (label, i) => ({
                  key: label,
                  label,
                  children:
                    i === 2 ? (
                      <Empty description="尚未接入 AI 测试服务" />
                    ) : (
                      <Table
                        rowKey="id"
                        dataSource={
                          i === 0
                            ? tests.data?.items.slice(0, 1)
                            : tests.data?.items
                        }
                        pagination={false}
                        columns={[
                          {
                            title: "输入",
                            dataIndex: "input",
                            render: (v) => <code>{v}</code>,
                          },
                          { title: "模式", render: () => "JSON模式" },
                          {
                            title: "结果",
                            dataIndex: "passed",
                            render: (v) => (
                              <Tag color={v ? "green" : "red"}>
                                {v ? "通过" : "未通过"}
                              </Tag>
                            ),
                          },
                          {
                            title: "期望输出",
                            dataIndex: "expected",
                            render: (v) => (v ? "命中" : "不命中"),
                          },
                          {
                            title: "实际输出",
                            dataIndex: "actual",
                            render: (v) => (v ? "命中" : "不命中"),
                          },
                          {
                            title: "测试人",
                            render: (_, r) => (
                              <>
                                {r.created_at}
                                <br />
                                demo
                              </>
                            ),
                          },
                        ]}
                      />
                    ),
                }),
              )}
            />
          </Section>
          <Section title="标签">
            <Descriptions
              items={[
                {
                  key: "custom",
                  label: "自定义标签",
                  children: (Array.isArray(rule.tags) ? rule.tags : [rule.tags])
                    .filter(Boolean)
                    .map((v: string) => <Tag key={v}>{v}</Tag>),
                },
                {
                  key: "type",
                  label: "规则类型",
                  children: "识别规则-命中识别",
                },
                { key: "class", label: "规则分类", children: "示例策略" },
              ]}
            />
          </Section>
          <Section title="添加话术">
            <p>风控话术：{rule.riskText || "—"}</p>
            <p>客服话术：{rule.serviceText || "—"}</p>
          </Section>
          <Section title="熔断信息">
            <Button type="link" onClick={() => navigate("/rulesFuseList")}>
              查看规则熔断配置
            </Button>
          </Section>
          <Section title="风险标签">
            {rule.riskTags?.length ? (
              <RiskTagChips ids={rule.riskTags} />
            ) : (
              <span className="muted">暂无</span>
            )}
          </Section>
          <Section title="生态事实标签">
            <span className="muted">暂无</span>
          </Section>
        </>
      )}
      {tab === "引用特征信息" && (
        <Table
          rowKey="id"
          dataSource={features.data?.items.filter((r) =>
            rule.expression?.includes(r.enName),
          )}
          columns={[
            { title: "特征ID", dataIndex: "id" },
            { title: "特征名称", dataIndex: "name" },
            { title: "英文名称", dataIndex: "enName" },
            { title: "数据类型", dataIndex: "dataType" },
            { title: "状态", dataIndex: "status" },
          ]}
        />
      )}
      {tab === "版本信息" && <VersionList module="rulePage" id={id} />}{" "}
      {tab === "被引用情况" && <ReferenceList id={id} />}
      <EntityEditor
        module={moduleMap.rulePage}
        row={rule}
        open={edit}
        onClose={() => setEdit(false)}
        onSaved={reload}
      />
      <Drawer
        title="添加测试信息"
        open={testOpen}
        onClose={() => setTestOpen(false)}
        width={800}
        extra={
          <Button type="primary" onClick={test} loading={running}>
            执行测试
          </Button>
        }
      >
        <Form layout="vertical">
          <Form.Item label="添加方式">
            <Radio.Group
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={["选填模式", "Json串模式", "RequestId模式", "CVID模式"]}
            />
          </Form.Item>
          {["RequestId模式", "CVID模式"].includes(mode) ? (
            <Alert
              type="info"
              message="本地示例环境未接入请求日志或CVID服务，请使用JSON串模式输入数据。"
            />
          ) : (
            <>
              <Form.Item label="输入参数（JSON对象）">
                <Input.TextArea
                  rows={12}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="monospace"
                />
              </Form.Item>
              <Form.Item label="期望输出">
                <Radio.Group
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  options={[
                    { value: true, label: "命中" },
                    { value: false, label: "不命中" },
                  ]}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
      <Modal
        title="可视化计算逻辑"
        open={visual}
        onCancel={() => setVisual(false)}
        footer={null}
      >
        <div className="logic-visual">
          <div>输入参数</div>
          <span>↓</span>
          <div>{rule.expression}</div>
          <span>↓</span>
          <div>命中 / 不命中</div>
        </div>
      </Modal>
    </>
  );
}
function ReferenceList({ id }: { id: number }) {
  const { data } = useRemote<{ items: any[] }>("/references/rule/" + id);
  return data ? (
    <Table
      rowKey="id"
      dataSource={data.items}
      columns={[
        { title: "场景ID", dataIndex: "scene_id" },
        { title: "场景名称", dataIndex: "name" },
        { title: "状态", dataIndex: "status" },
        { title: "决策", dataIndex: "decision" },
      ]}
    />
  ) : (
    <Empty description="加载引用信息..." />
  );
}
