import {TestPackages} from "./TestPackages";
import {
  conditionExpression,
  operatorsFor,
  ruleOperator,
} from "./rule-operators";
import { RiskTagSelect } from "./RiskTagSelect";
import { compileConditionLogic } from "./rule-logic";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Steps,
  Table,
  Tag,
} from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, entityPath } from "./api";
const operandHint = (name: string) => {
  const op = ruleOperator(name);
  return (
    {
      bag: "词包 ID",
      picture: "图包 ID",
      rule: "子规则 ID",
      none: "",
      value: "常量值",
    }[op?.operand || "value"] + (op?.multiple ? "，按回车添加" : "")
  );
};
function ResourceSelector({
  kind,
  value,
  onChange,
}: {
  kind: string;
  value?: any;
  onChange?: (v: any) => void;
}) {
  const [query, setQuery] = useState(""),
    [options, setOptions] = useState<any[]>([]);
  const { message } = App.useApp();
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      const path =
        kind === "rule"
          ? "/entities/rulePage?pageSize=30&q=" + encodeURIComponent(query)
          : "/source/rule-packages?type=" +
            kind +
            "&q=" +
            encodeURIComponent(query);
      api(path)
        .then((d) => {
          if (active)
            setOptions(
              kind === "rule"
                ? d.items.map((r: any) => ({
                    value: String(r.id),
                    label: r.id + " " + r.name,
                  }))
                : d.items,
            );
        })
        .catch((e) => {
          if (active) message.error(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [kind, query]);
  return (
    <Select
      mode={kind === "rule" ? undefined : "tags"}
      showSearch
      allowClear
      filterOption={false}
      onSearch={setQuery}
      style={{ minWidth: 250 }}
      placeholder={
        kind === "rule" ? "搜索子规则 ID / 名称" : "搜索资源 ID / 名称"
      }
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}
export function RuleWizard({
  open,
  onClose,
  onSaved,
  groupId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  groupId?: number;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0),
    [mode, setMode] = useState("交互式"),
    [testMode, setTestMode] = useState("Json串模式"),
    [input, setInput] = useState('{\n  "riskScore": 0.95\n}'),
    [requestId, setRequestId] = useState(""),
    [expected, setExpected] = useState(true),
    [tests, setTests] = useState<any[]>([]),
    [running, setRunning] = useState(false),
    [saving, setSaving] = useState(false),
    [features, setFeatures] = useState<any[]>([]),
    [decisions, setDecisions] = useState<any[]>([]),
    [tags, setTags] = useState<any[]>([]),
    [featureQuery, setFeatureQuery] = useState("");
  const values = Form.useWatch([], { form, preserve: true }) || {};
  const conditions = values.conditions || [];
  let expression = values.expression || "",
    logicError = "";
  if (mode === "交互式")
    try {
      expression = compileConditionLogic(
        values.conditionLogic || "1",
        conditions.map(conditionExpression),
      );
    } catch (e: any) {
      logicError = e.message;
      expression = "";
    }
  const draftKey = "zeus-rule-draft:" + String(groupId || "global");
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      conditions: [{}],
      conditionLogic: "1",
      owner: "demo",
      status: "就绪",
      groupStatus: "标记",
      priority: 1,
    });
    setStep(0);
    setTests([]);
    setMode("交互式");
    const draft = localStorage.getItem(draftKey);
    if (draft)
      Modal.confirm({
        title: "您有一份草稿尚未完成，是否继续编辑？",
        okText: "继续编辑",
        cancelText: "取消",
        onOk: () => {
          try {
            const d = JSON.parse(draft);
            for (const c of d.values.conditions || []) {
              if (c.feature && !c.featureId) {
                c.featureId = "legacy:" + c.feature;
                c.featureLabel = c.feature;
              }
            }
            form.setFieldsValue(d.values);
            setMode(d.mode);
            setStep(d.step || 0);
            setTests(d.tests || []);
          } catch {
            message.error("草稿无法读取");
          }
        },
      });
    api<any>("/entities/decisionList?pageSize=100")
      .then((d) => setDecisions(d.items))
      .catch((e) => message.error(e.message));
    api<any>(
      "/entities/tag?pageSize=100&view=" + encodeURIComponent("风险标签"),
    )
      .then((d) => setTags(d.items))
      .catch((e) => message.error(e.message));
  }, [open, groupId]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    const t = setTimeout(
      () =>
        api<any>(
          "/entities/featureService?pageSize=30&q=" +
            encodeURIComponent(featureQuery),
        )
          .then((d) => {
            if (current) setFeatures(d.items);
          })
          .catch((e) => message.error(e.message)),
      300,
    );
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [featureQuery, open]);
  const parsedInput = () => {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  };
  const inputNames = [
    ...new Set<string>(
      String(expression)
        .replace(/"[^"]*"|'[^']*'/g, "")
        .match(/[A-Za-z_]\w*/g) || [],
    ),
  ].filter((n) => !ruleOperator(n) && !["true", "false", "null"].includes(n));
  const validTests = tests.filter((t) => t.expression === expression);
  function saveDraft() {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        values: form.getFieldsValue(true),
        mode,
        step,
        tests: validTests,
      }),
    );
    message.success("草稿已保存");
  }
  function exit() {
    Modal.confirm({
      title: "退出当前页面",
      content: "要在退出前保存当前信息到草稿箱吗？",
      okText: "保存并退出",
      cancelText: "直接退出",
      onOk: () => {
        saveDraft();
        onClose();
      },
      onCancel: onClose,
    });
  }
  async function next() {
    try {
      if (step === 0) {
        await form.validateFields([
          "name",
          "enName",
          ...(mode === "交互式"
            ? conditions.flatMap((_: any, i: number) => [
                ["conditions", i, "featureId"],
                ["conditions", i, "operator"],
                ...(ruleOperator(conditions[i]?.operator)?.operand === "none"
                  ? []
                  : [["conditions", i, "value"]]),
              ])
            : ["expression"]),
        ]);
        if (logicError) return message.error(logicError);
        if (!expression.trim()) return message.error("请填写规则逻辑");
        setStep(1);
      } else if (
        !validTests.some((t) => t.expected) ||
        !validTests.some((t) => !t.expected)
      ) {
        Modal.confirm({
          title: "测试覆盖度情况确认",
          content:
            "为保障线上执行结果符合预期，请对于该拦是否拦截、不该拦是否拦截、边界 null 等情况分类进行测试。",
          okText: "我已知晓，下一步",
          cancelText: "继续测试",
          onOk: () => setStep(2),
        });
      } else setStep(2);
    } catch {
      /* Form displays validation. */
    }
  }
  async function run() {
    try {
      setRunning(true);
      const result = await api<any>("/rule-drafts/test", "POST", {
        expression,
        input,
        expected,
        mode: testMode,
        requestId,
      });
      setTests((old) => [...old, { ...result, expression, id: Date.now() }]);
      message[result.passed ? "success" : "warning"](
        result.passed ? "测试通过" : "实际输出与期望输出不一致",
      );
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setRunning(false);
    }
  }
  async function finish() {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const rule = {
        name: v.name,
        enName: v.enName,
        expression,
        status: "就绪",
        owner: v.owner,
        description: v.description,
        riskText: v.riskText,
        serviceText: v.serviceText,
        tags: v.tags || [],
        riskTags: v.riskTags || [],
        editMode: mode,
        ruleConditions: mode === "交互式" ? conditions : [],
        conditionLogic: v.conditionLogic,
      };
      const created = groupId
        ? await api<any>("/groups/" + groupId + "/create-rule", "POST", {
            rule,
            config: {
              status: v.groupStatus,
              decisionId: v.decisionId,
              priority: v.priority,
            },
          })
        : await api<any>(entityPath("rulePage"), "POST", rule);
      for (const t of validTests)
        await api("/rules/" + created.id + "/test", "POST", {
          input: t.input,
          expected: t.expected,
        });
      localStorage.removeItem(draftKey);
      message.success("规则已创建" + (groupId ? "并同步至规则组关联场景" : ""));
      onSaved();
      onClose();
    } catch (e: any) {
      if (!e.errorFields) message.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer
      open={open}
      onClose={exit}
      title="添加规则"
      width="calc(100vw - 200px)"
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={saveDraft}>保存草稿</Button>
          <Button onClick={exit}>退出</Button>
        </Space>
      }
      footer={
        <Space style={{ display: "flex", justifyContent: "flex-end" }}>
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)}>上一步</Button>
          )}
          {step < 2 ? (
            <Button type="primary" onClick={next}>
              下一步
            </Button>
          ) : (
            <Button type="primary" loading={saving} onClick={finish}>
              完成
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        current={step}
        items={["逻辑信息", "测试", "属性信息"].map((title) => ({ title }))}
        style={{
          maxWidth: 850,
          margin: "10px auto 35px",
          position: "sticky",
          top: 0,
          zIndex: 3,
          background: "white",
          padding: "12px 0",
        }}
      />
      <Form form={form} layout="vertical" preserve>
        <div style={{ display: step === 0 ? "block" : "none" }}>
          <h2>逻辑信息</h2>
          <Space align="start">
            <Form.Item
              name="name"
              label="中文名称"
              rules={[{ required: true, message: "请输入中文名称" }]}
            >
              <Input style={{ width: 360 }} />
            </Form.Item>
            <Form.Item
              name="enName"
              label="英文名称"
              rules={[
                { required: true, message: "请输入英文名称" },
                {
                  pattern: /^[A-Za-z_]\w*$/,
                  message: "英文名称仅支持字母、数字、下划线，且不能以数字开头",
                },
              ]}
            >
              <Input style={{ width: 360 }} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="规则备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={["交互式", "表达式", "SQL"]}
            optionType="button"
          />
          <div style={{ marginTop: 20 }}>
            {mode === "交互式" ? (
              <>
                <Form.List name="conditions">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...rest }, i) => (
                        <Space key={key} align="baseline">
                          <span>条件 {i + 1}</span>
                          <Form.Item
                            {...rest}
                            name={[name, "featureId"]}
                            rules={[
                              { required: true, message: "请选择左变量" },
                            ]}
                          >
                            <Select
                              style={{ width: 360 }}
                              placeholder="左变量：特征ID / 中英文名称"
                              showSearch
                              filterOption={false}
                              onSearch={setFeatureQuery}
                              onSelect={(_, option) => {
                                const type = option.dataType || "";
                                const available = operatorsFor(type);
                                form.setFieldValue(["conditions", name], {
                                  feature: option.enName,
                                  featureId: option.value,
                                  featureLabel: option.label,
                                  dataType: type,
                                  operator: available[0]?.value,
                                });
                              }}
                              options={[
                                ...(conditions[name]?.featureId &&
                                !features.some(
                                  (f) => f.id === conditions[name]?.featureId,
                                )
                                  ? [
                                      {
                                        value: conditions[name].featureId,
                                        label:
                                          conditions[name].featureLabel ||
                                          conditions[name].feature,
                                        enName: conditions[name].feature,
                                        dataType: conditions[name].dataType,
                                      },
                                    ]
                                  : []),
                                ...features.map((f) => ({
                                  value: f.id,
                                  enName: f.enName,
                                  dataType: f.dataType,
                                  label:
                                    (f.sourceId || f.id) +
                                    "-" +
                                    f.name +
                                    " (" +
                                    f.enName +
                                    ")",
                                })),
                              ]}
                            />
                          </Form.Item>
                          <Form.Item
                            {...rest}
                            name={[name, "operator"]}
                            rules={[
                              { required: true, message: "请选择操作符" },
                            ]}
                          >
                            <Select
                              style={{ width: 210 }}
                              placeholder="操作符"
                              disabled={!conditions[name]?.feature}
                              options={operatorsFor(
                                conditions[name]?.dataType,
                              ).map((op) => ({
                                value: op.value,
                                label: op.label,
                              }))}
                              onChange={() =>
                                form.setFieldValue(
                                  ["conditions", name, "value"],
                                  undefined,
                                )
                              }
                            />
                          </Form.Item>
                          {ruleOperator(conditions[name]?.operator)?.operand !==
                            "none" && (
                            <Form.Item
                              {...rest}
                              name={[name, "value"]}
                              rules={[
                                { required: true, message: "请填写右变量" },
                              ]}
                            >
                              {["bag", "picture", "rule"].includes(
                                ruleOperator(conditions[name]?.operator)
                                  ?.operand || "",
                              ) ? (
                                <ResourceSelector
                                  kind={
                                    ruleOperator(conditions[name]?.operator)!
                                      .operand
                                  }
                                />
                              ) : ruleOperator(conditions[name]?.operator)
                                  ?.multiple ? (
                                <Select
                                  mode="tags"
                                  open={false}
                                  tokenSeparators={[",", "，"]}
                                  style={{ minWidth: 210 }}
                                  placeholder={operandHint(
                                    conditions[name]?.operator,
                                  )}
                                />
                              ) : (
                                <Input
                                  placeholder={operandHint(
                                    conditions[name]?.operator,
                                  )}
                                />
                              )}
                            </Form.Item>
                          )}
                          {ruleOperator(conditions[name]?.operator)?.operand ===
                            "rule" && (
                            <Form.Item name={[name, "elementParam"]}>
                              <Input placeholder="元素映射到子规则入参" />
                            </Form.Item>
                          )}
                          <Button
                            disabled={fields.length === 1}
                            onClick={() => remove(name)}
                          >
                            删除
                          </Button>
                        </Space>
                      ))}
                      <Button
                        onClick={() => {
                          add({});
                          form.setFieldValue(
                            "conditionLogic",
                            "(" +
                              (form.getFieldValue("conditionLogic") || "1") +
                              ")&&" +
                              (fields.length + 1),
                          );
                        }}
                      >
                        添加条件
                      </Button>
                    </>
                  )}
                </Form.List>
                <Form.Item
                  name="conditionLogic"
                  label="条件间逻辑"
                  rules={[{ required: true, message: "请输入条件间逻辑" }]}
                >
                  <Input placeholder="例如：1&&(2||4)||3" />
                </Form.Item>
                {logicError && <Alert type="error" message={logicError} />}
                <p className="muted">
                  使用条件编号、&&、||、! 和括号组合，同一条件可以重复使用。
                </p>
              </>
            ) : (
              <Form.Item
                name="expression"
                label={mode === "SQL" ? "SQL表达式" : "aviator表达式"}
                rules={[
                  { required: mode !== "交互式", message: "请输入表达式" },
                ]}
              >
                <Input.TextArea rows={12} className="monospace" />
              </Form.Item>
            )}
          </div>
          <pre className="code-editor">{expression || "待配置规则逻辑"}</pre>
        </div>
        <div style={{ display: step === 1 ? "block" : "none" }}>
          <h2>测试</h2>
          <Alert
            type="info"
            showIcon
            message="执行当前规则逻辑并比较实际输出与期望输出；请覆盖命中、不命中和边界输入。"
          />
          <Space style={{ margin: "18px 0" }}>
            <Radio.Group
              value={testMode}
              onChange={(e) => setTestMode(e.target.value)}
              options={["选填模式", "Json串模式", "RequestId模式", "CVID模式"]}
            />
          </Space>
          {["RequestId模式", "CVID模式"].includes(testMode) ? (
            <Input
              placeholder={
                testMode === "RequestId模式" ? "请输入RequestId" : "请输入CVID"
              }
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
            />
          ) : testMode === "选填模式" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              {inputNames.map((name) => (
                <Form.Item key={name} label={name}>
                  <Input
                    value={
                      typeof parsedInput()[name] === "object"
                        ? JSON.stringify(parsedInput()[name])
                        : String(parsedInput()[name] ?? "")
                    }
                    onChange={(e) => {
                      let value: any = e.target.value;
                      try {
                        value = JSON.parse(value);
                      } catch {}
                      setInput(
                        JSON.stringify(
                          { ...parsedInput(), [name]: value },
                          null,
                          2,
                        ),
                      );
                    }}
                  />
                </Form.Item>
              ))}
            </Space>
          ) : (
            <Input.TextArea
              rows={8}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="monospace"
            />
          )}
          <Space style={{ margin: "16px 0" }}>
            期望输出：
            <Radio.Group
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              options={[
                { value: true, label: "命中" },
                { value: false, label: "不命中" },
              ]}
            />
            <TestPackages/>
            <Button type="primary" loading={running} onClick={run}>
              执行测试
            </Button>
          </Space>
          <Table
            rowKey="id"
            dataSource={validTests}
            columns={[
              {
                title: "输入",
                render: (_, r) => <code>{JSON.stringify(r.input)}</code>,
              },
              { title: "期望输出", render: (_, r) => String(r.expected) },
              { title: "实际输出", render: (_, r) => String(r.actual) },
              {
                title: "测试结果",
                render: (_, r) => (
                  <Tag color={r.passed ? "green" : "red"}>
                    {r.passed ? "通过" : "未通过"}
                  </Tag>
                ),
              },
            ]}
            pagination={{ pageSize: 5 }}
          />
        </div>
        <div style={{ display: step === 2 ? "block" : "none" }}>
          <h2>属性信息</h2>
          <Form.Item
            name="owner"
            label="管理员"
            rules={[{ required: true, message: "请输入管理员MISID" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="tags" label="自定义标签">
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="riskTags" label="风险标签">
            <RiskTagSelect />
          </Form.Item>
          <h3>添加话术</h3>
          <Form.Item name="riskText" label="风控话术">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="serviceText" label="客服话术">
            <Input.TextArea rows={2} />
          </Form.Item>
          {groupId && (
            <>
              <h3>规则组策略配置</h3>
              <Form.Item
                name="decisionId"
                label="决策"
                rules={[{ required: true, message: "请选择决策" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={decisions.map((d) => ({
                    value: d.id,
                    label: d.id + "-" + d.name,
                  }))}
                />
              </Form.Item>
              <Form.Item name="groupStatus" label="状态">
                <Select
                  options={["离线", "标记"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </Form.Item>
              <Form.Item name="priority" label="优先级">
                <InputNumber min={0} />
              </Form.Item>
            </>
          )}
        </div>
      </Form>
    </Drawer>
  );
}
export function RuleWizardPage() {
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const groupId = Number(params.get("ruleGroupId")) || undefined;
  const back = () =>
    navigate(groupId ? "/rulesGroup?id=" + groupId : "/rulePage");
  return (
    <RuleWizard open groupId={groupId} onClose={back} onSaved={() => {}} />
  );
}
