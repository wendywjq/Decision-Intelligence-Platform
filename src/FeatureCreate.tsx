import { Link } from "./navigation";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
} from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, entityPath } from "./api";
import { PageHeader, Section, useRemote } from "./components";

const kinds = [
  "原始特征",
  "衍生特征",
  "KV特征",
  "累计特征",
  "离线特征",
  "大模型特征",
];
const resultTypes = [
  "Boolean",
  "Integer",
  "Long",
  "Double",
  "String",
  "List",
  "Map",
];
const opts = (v: string[]) => v.map((value) => ({ value, label: value }));
const short = (kind: string) => kind.replace(/特征$/, "");
const prefix = (risk: string, kind: string) =>
  "【" + risk + "】【" + short(kind) + "】";
const templateGuard =
  "isNotEmpty(risklevel) && risklevel != '6' && zeusExecutionStatus == 0";
const templateReadMode =
  "在满足何种条件累计基础上，排除 risklevel 和 zeusExecutionStatus 条件";
const writeExpression = (v: Values) =>
  v.mode === "模版配置"
    ? templateGuard +
      (v.additionalCondition?.trim()
        ? " && (" + v.additionalCondition + ")"
        : "")
    : v.writeCondition;
const readExpression = (v: Values) =>
  v.mode === "模版配置"
    ? v.additionalCondition?.trim() || "true"
    : v.readMode === "无"
      ? "true"
      : v.readMode === "填写读取累计条件"
        ? v.readCondition
        : v.writeCondition;
const initial = {
  kind: kinds[0],
  riskDomain: "存量特征",
  name: prefix("存量特征", kinds[0]),
  valueManageSwitch: false,
  mode: "普通配置",
  accType: "计数",
  periodUnit: "自然日",
  readMode: "与写累计条件相同",
  includeMode: "不累计自身",
  online: true,
  logicMode: "表达式",
  computeFunction: "拆分循环调用",
  writeCondition: "##exp - 5\n",
  expression: "##exp - 5\n",
};
type Values = Record<string, any>;
type TestRecord = {
  signature: string;
  input: string;
  actual: any;
  expected: any;
  passed: boolean;
};
const signature = (v: Values) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            ![
              "name",
              "description",
              "subject",
              "business",
              "riskDomain",
              "tags",
              "featureCategory",
              "testCondition",
            ].includes(k),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
const manual =
  "https://github.com/wendywjq/platform_user_manual/tree/main/pages/339930787/children/Zeus平台功能操作手册__28139633/children/说明：表达式书写说明__176739529";
function SelectText({ values = [], multi = false, ...props }: any) {
  return (
    <Select
      {...props}
      mode={multi ? "tags" : undefined}
      showSearch
      options={opts(values)}
      placeholder={multi ? "请选择，可多选" : "请选择"}
    />
  );
}
function ExpressionField({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [full, setFull] = useState(false),
    [functions, setFunctions] = useState(false);
  const { message } = App.useApp();
  const editor = (
    <Input.TextArea
      className="monospace"
      rows={full ? 16 : 5}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return (
    <div>
      <Space>
        <Button size="small" onClick={() => setFunctions(true)}>
          函数
        </Button>
        <Button size="small" href={manual} target="_blank">
          语法
        </Button>
        <Button
          size="small"
          onClick={() =>
            navigator.clipboard.writeText(value || "").then(
              () => message.success("已复制"),
              () => message.error("复制失败"),
            )
          }
        >
          复制
        </Button>
        <Button size="small" onClick={() => setFull(true)}>
          全屏
        </Button>
      </Space>
      {editor}
      <Modal
        open={full}
        title="Aviator 表达式"
        footer={null}
        onCancel={() => setFull(false)}
        width="85vw"
      >
        {editor}
      </Modal>
      <Modal
        title="函数"
        open={functions}
        footer={null}
        onCancel={() => setFunctions(false)}
      >
        {[
          "string.contains",
          "string.length",
          "array.contains",
          "jsonString.toList",
          "count",
          "long",
          "double",
        ].map((fn) => (
          <Button
            key={fn}
            type="link"
            onClick={() => {
              onChange?.((value || "") + fn + "()");
              setFunctions(false);
            }}
          >
            {fn}
          </Button>
        ))}
      </Modal>
    </div>
  );
}
export function FeatureCreate() {
  const [params] = useSearchParams(),
    id = Number(params.get("id")),
    nav = useNavigate(),
    { message } = App.useApp(),
    [form] = Form.useForm();
  const [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [recordsOpen, setRecordsOpen] = useState(false),
    [tests, setTests] = useState<TestRecord[]>([]),
    [input, setInput] = useState("{}"),
    [expect, setExpect] = useState("true"),
    [testError, setTestError] = useState(""),
    [extraTree, setExtraTree] = useState(false);
  const draft = useRemote<any>(id ? entityPath("featureService", id) : "");
  const catalog = useRemote<{ events: string[]; categories: string[] }>(
    "/feature-config/options",
  );
  useEffect(() => {
    const d = draft.data;
    if (d?.featureForm) {
      form.setFieldsValue(d.featureForm);
      setExtraTree(!!d.featureForm.otherTrees?.length);
      setTests(d.logicTests || []);
    }
  }, [draft.data, form]);
  const kind = Form.useWatch("kind", form) || initial.kind,
    readMode = Form.useWatch("readMode", form),
    mode = Form.useWatch("mode", form),
    accType = Form.useWatch("accType", form),
    distinct = Form.useWatch("distinct", form),
    managed = Form.useWatch("valueManageSwitch", form);
  const acc = kind === "累计特征",
    offline = kind === "离线特征",
    derived = kind === "衍生特征",
    kv = kind === "KV特征";
  const logicMode = Form.useWatch("logicMode", form),
    advanced = derived && logicMode === "高级配置";
  const targetId = Form.useWatch("targetId", form),
    [search, setSearch] = useState(""),
    [targetOptions, setTargetOptions] = useState<any[]>([]);
  useEffect(() => {
    if (!advanced) return;
    let active = true;
    const timer = setTimeout(() => {
      api(
        entityPath("featureService") +
          "?pageSize=25&q=" +
          encodeURIComponent(search),
      )
        .then((r) => {
          if (active)
            setTargetOptions(
              r.items.map((x: any) => ({
                value: x.id,
                label: x.id + " " + x.name,
              })),
            );
        })
        .catch((e) => {
          if (active) message.error(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [advanced, search, message]);
  const [hiveColumns, setHiveColumns] = useState<Values[]>([]);
  const [eventOpen, setEventOpen] = useState(false),
    [eventName, setEventName] = useState("");
  const item = (
    name: string,
    label: string,
    node: React.ReactNode = <Input />,
    required = true,
  ) => (
    <Form.Item
      name={name}
      label={label}
      rules={required ? [{ required: true, message: "请填写" + label }] : []}
    >
      {node}
    </Form.Item>
  );
  const tags = (values: string[] = []) => <SelectText multi values={values} />;
  function changeType(next: string, risk: string) {
    const current = form.getFieldValue("name") || "",
      suffix = current.replace(/^【[^】]*】【[^】]*】/, "");
    form.setFieldsValue({ name: prefix(risk, next) + suffix });
  }
  async function run() {
    try {
      setBusy(true);
      setTestError("");
      const v = form.getFieldsValue(true),
        args = JSON.parse(input),
        expected = JSON.parse(expect);
      let expression = v.expression;
      if (acc)
        expression =
          v.testCondition === "读取条件"
            ? readExpression(v)
            : v.testCondition === "删除条件"
              ? v.deleteCondition
              : writeExpression(v);
      if (kv) expression = v.keyExpression;

      let { value } = await api(
        advanced ? "/feature-logic/map-test" : "/feature-logic/test",
        "POST",
        {
          expression,
          input: args,
          targetId: v.targetId,
          param: v.targetParam,
          source: v.inputFeature,
        },
      );
      if (kv) {
        const library = args.kv?.[v.library];
        if (!library || typeof library !== "object")
          throw Error("请在输入 JSON 的 kv 字段中提供所选 KV 库的测试数据");
        value = Object.hasOwn(library, String(value))
          ? library[String(value)]
          : null;
      }
      if (acc && typeof value !== "boolean")
        throw Error("累计条件必须返回布尔值");
      const record = {
        signature: signature(v),
        input,
        expected,
        actual: value,
        passed: JSON.stringify(value) === JSON.stringify(expected),
      };
      setTests((t) => [record, ...t]);
      if (record.passed) {
        setTesting(false);
        message.success("逻辑测试通过");
      } else
        setTestError(
          "实际输出 " + JSON.stringify(value) + "，与期望输出不一致",
        );
    } catch (e: any) {
      setTestError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function makeBody(v: Values, isDraft: boolean) {
    const accumulation = {
      mode: v.mode,
      events: v.events || [],
      traffic: [
        ...new Set(
          (v.events || []).flatMap(
            (e: string) => (catalog.data as any)?.traffic?.[e] || [],
          ),
        ),
      ],
      period: [v.period, v.periodUnit].filter(Boolean).join(" "),
      type: v.accType,
      keys: v.keys,
      value: v.accValue,
      distinct: !!v.distinct,
      distinctKey:
        v.distinct && v.accType === "计数" ? v.accValue : v.distinctKey,
      writeCondition: writeExpression(v),
      readMode: v.mode === "模版配置" ? templateReadMode : v.readMode,
      readCondition: readExpression(v),
      includeMode: v.includeMode,
      includeCurrent: v.includeMode !== "不累计自身",
      deleteCondition: v.deleteCondition,
      topTimes: v.topTimes,
    };
    return {
      ...v,
      type: kind,
      name: v.name?.trim() || "未命名特征草稿",
      status: isDraft ? "草稿" : "已就绪未使用",
      dataType:
        v.dataType || (acc && accType === "计数" ? "Integer" : undefined),
      featureForm: v,
      logicTests: tests,
      featureDefinition: {
        ...v,
        type: acc ? 2 : derived ? 1 : kv ? 3 : offline ? 11 : 0,
        accumulation: acc ? accumulation : undefined,
      },
      owner: "demo",
    };
  }
  async function save(isDraft: boolean) {
    try {
      setBusy(true);
      if (!isDraft) await form.validateFields();
      const v = form.getFieldsValue(true);
      if (
        !isDraft &&
        (derived || acc || kv) &&
        !tests.some((t) => t.passed && t.signature === signature(v))
      )
        throw Error("逻辑信息修改后，至少需要一个测试 case 通过");
      if (offline && !isDraft) {
        const items = (v.columns || []).map((c: any) =>
          makeBody({ ...v, ...c }, false),
        );
        if (!items.length) throw Error("请先选择特征列");
        await api("/feature-config/batch", "POST", { items });
      } else {
        const saved = await api(
          entityPath("featureService", id || undefined),
          id ? "PUT" : "POST",
          makeBody(v, isDraft),
        );
        message.success(isDraft ? "草稿已保存" : "特征已提交");
        nav("/featureDetails?id=" + saved.id);
        return;
      }
      message.success("已批量提交");
      nav("/featureService");
    } catch (e: any) {
      if (!e.errorFields) message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="feature-create">
      <PageHeader title={id ? "编辑特征" : "新建特征"}>
        <Button onClick={() => nav("/featureService")}>取消</Button>
        {!offline && (
          <Button loading={busy} onClick={() => save(true)}>
            保存草稿
          </Button>
        )}
        <Button type="primary" loading={busy} onClick={() => save(false)}>
          {offline ? "批量提交" : "提交"}
        </Button>
      </PageHeader>
      <a
        className="feature-guide"
        target="_blank"
        rel="noreferrer"
        href="https://km.sankuai.com/collabpage/1806820377"
      >
        特征配置指南
      </a>
      <Form
        form={form}
        initialValues={initial}
        layout="horizontal"
        labelCol={{ flex: "150px" }}
        wrapperCol={{ flex: "1" }}
        labelWrap
      >
        <Section title="属性信息">
          {item(
            "kind",
            "特征类型",
            <Select
              options={kinds.map((value) => ({
                value,
                label: value,
                disabled: value === "大模型特征",
              }))}
              onChange={(k) => changeType(k, form.getFieldValue("riskDomain"))}
            />,
          )}
          {item(
            "riskDomain",
            "风险域",
            <Select
              options={opts([
                "存量特征",
                "业安公共",
                "内容安全",
                "三方数据",
                "AI生成",
              ])}
              onChange={(r) => changeType(kind, r)}
            />,
          )}
          {!offline && (
            <>
              {item("name", "中文名称")}
              <Form.Item
                name="enName"
                label="英文名称"
                rules={[
                  { required: true },
                  {
                    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
                    message: "请输入有效的英文名称",
                  },
                ]}
              >
                <Input />
              </Form.Item>
            </>
          )}
          {item(
            "featureCategory",
            offline ? "特征默认分类" : "特征分类",
            tags(catalog.data?.categories || ["存量特征/存量默认"]),
          )}
          {!offline && (
            <Form.Item label=" " colon={false}>
              <Button onClick={() => setExtraTree(!extraTree)}>
                关联其他特征树
              </Button>
            </Form.Item>
          )}
          {extraTree &&
            item(
              "otherTrees",
              "其他特征树",
              tags(catalog.data?.categories),
              false,
            )}
          {item(
            "subject",
            offline ? "默认主体" : "特征主体",
            tags(["内容", "用户", "商户"]),
          )}
          {item(
            "business",
            offline ? "默认业务线" : "业务线",
            tags(["内容安全"]),
          )}
          {item("tags", offline ? "默认标签" : "特征标签", tags(), false)}
          {!offline && (
            <>
              {item("description", "特征说明", <Input.TextArea rows={3} />)}
              {item(
                "valueManageSwitch",
                "值域管理",
                <Radio.Group
                  options={[
                    { label: "是", value: true },
                    { label: "否", value: false },
                  ]}
                />,
              )}
              {managed && item("domainValues", "值域", tags())}
            </>
          )}
        </Section>
        <Section title="逻辑信息">
          {!acc &&
            !offline &&
            item("dataType", "结果类型", <SelectText values={resultTypes} />)}
          {derived && (
            <>
              {item(
                "logicMode",
                "特征逻辑",
                <Radio.Group
                  options={["表达式", "高级配置"]}
                  onChange={(e) => {
                    if (e.target.value === "高级配置")
                      form.setFieldValue("dataType", "List");
                  }}
                />,
              )}
              {advanced ? (
                <>
                  {item(
                    "computeFunction",
                    "计算函数",
                    <SelectText values={["拆分循环调用"]} />,
                  )}
                  {item(
                    "targetId",
                    "调用目标",
                    <Select
                      showSearch
                      filterOption={false}
                      onSearch={setSearch}
                      options={targetOptions}
                    />,
                  )}
                  {targetId && (
                    <Form.Item label=" " colon={false}>
                      <Link
                        target="_blank"
                        to={"/featureDetails?id=" + targetId}
                      >
                        查看特征详情
                      </Link>
                    </Form.Item>
                  )}
                  {item("targetParam", "目标特征依赖入参")}
                  {item("inputFeature", "映射输入特征")}
                </>
              ) : (
                item("expression", "Aviator 表达式", <ExpressionField />)
              )}
            </>
          )}
          {kv && (
            <>
              {item(
                "relationType",
                "关联类型",
                <SelectText values={["KV库", "关联特征"]} />,
              )}
              {item("library", "KV库")}
              {item("valueType", "值类型", <SelectText values={resultTypes} />)}
              {item("keyExpression", "Key 表达式", <ExpressionField />)}
            </>
          )}
          {acc && (
            <>
              <h3>写累计条件</h3>
              {item(
                "mode",
                "配置方式",
                <Radio.Group
                  options={["普通配置", "模版配置"]}
                  onChange={(e) => {
                    if (e.target.value === "模版配置")
                      form.setFieldsValue({
                        template: "自然人累计通用模板",
                        accType: "计数",
                        accValue: "userid",
                        distinct: true,
                        includeMode: "按照「读累计条件」累计",
                      });
                  }}
                />,
              )}
              {mode === "模版配置" &&
                item("template", "选择模版", <Input disabled />)}
              {item("events", "累计事件", tags(catalog.data?.events))}
              <Form.Item label=" " colon={false}>
                <Button onClick={() => setEventOpen(true)}>新增累计事件</Button>
              </Form.Item>
              <Form.Item label="流量来源">
                <Form.Item noStyle shouldUpdate>
                  {() => {
                    const events = form.getFieldValue("events") || [];
                    const map = (catalog.data as any)?.traffic || {};
                    return (
                      [
                        ...new Set<string>(
                          events.flatMap((e: string) => map[e] || []),
                        ),
                      ].join("、") || "暂无绑定数据"
                    );
                  }}
                </Form.Item>
              </Form.Item>
              <Form.Item label="累计周期" required>
                <Space.Compact>
                  <Form.Item
                    name="period"
                    noStyle
                    rules={[{ required: true, message: "请填写累计周期" }]}
                  >
                    <InputNumber min={1} precision={0} />
                  </Form.Item>
                  <Form.Item name="periodUnit" noStyle>
                    <Select
                      options={opts(["秒", "分钟", "小时", "自然日", "天"])}
                    />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
              {item(
                "accType",
                "累计类型",
                <Radio.Group
                  options={
                    mode === "模版配置"
                      ? ["计数"]
                      : ["计数", "求和", "最近", "最大值", "最小值"]
                  }
                />,
              )}
              {accType === "最近" &&
                item(
                  "topTimes",
                  "最近次数",
                  <InputNumber min={1} precision={0} />,
                )}
              {item("keys", "按何累计", tags())}
              {item("accValue", "累计值")}
              {mode === "普通配置" && (
                <>
                  <Form.Item
                    name="distinct"
                    valuePropName="checked"
                    label="去重"
                  >
                    <Checkbox>剔除重复项</Checkbox>
                  </Form.Item>
                  {distinct &&
                    accType !== "计数" &&
                    item("distinctKey", "按何去重")}
                </>
              )}
              {mode === "模版配置" ? (
                <>
                  <Form.Item label="满足何种条件累计">
                    <pre className="code-editor">{templateGuard}</pre>
                  </Form.Item>
                  {item(
                    "additionalCondition",
                    "附加累计条件",
                    <ExpressionField />,
                    false,
                  )}
                  <Collapse
                    ghost
                    items={[
                      {
                        key: "defaults",
                        label: "其他默认配置项",
                        children: (
                          <>
                            <p>是否剔除重复项：剔除</p>
                            <p>读累计条件设置：{templateReadMode}</p>
                            <p>是否累计自身：按照「读累计条件」累计</p>
                          </>
                        ),
                      },
                    ]}
                  />
                </>
              ) : (
                <>
                  {item(
                    "writeCondition",
                    "满足何种条件累计",
                    <ExpressionField />,
                  )}
                  <h3>读累计条件</h3>
                  {item(
                    "readMode",
                    "读累计条件设置",
                    <SelectText
                      values={["与写累计条件相同", "填写读取累计条件", "无"]}
                    />,
                  )}
                  {readMode === "填写读取累计条件" &&
                    item("readCondition", "读取条件", <ExpressionField />)}
                  {item(
                    "includeMode",
                    "是否累计自身",
                    <Radio.Group
                      options={[
                        "不累计自身",
                        "按照「满足何种条件」累计",
                        "按照「读累计条件」累计",
                      ]}
                    />,
                  )}
                  <Collapse
                    ghost
                    items={[
                      {
                        key: "delete",
                        label: "删除条件",
                        children: item(
                          "deleteCondition",
                          "删除条件",
                          <ExpressionField />,
                          false,
                        ),
                      },
                    ]}
                  />
                </>
              )}
              {item(
                "online",
                "上线状态",
                <Radio.Group
                  options={[
                    { label: "上线", value: true },
                    { label: "离线", value: false },
                  ]}
                />,
              )}
            </>
          )}
          {offline && (
            <>
              {item(
                "table",
                "特征Hive表",
                <Input
                  addonBefore="ba_rc"
                  onChange={() => {
                    setHiveColumns([]);
                    form.setFieldValue("columns", []);
                  }}
                />,
              )}
              {item("dimensions", "维度列选择", tags())}
              {item(
                "dimensionExpression",
                "维度列匹配逻辑",
                <Input.TextArea placeholder="请输入 Aviator 表达式" />,
              )}
              <Form.Item label=" " colon={false}>
                <Button
                  onClick={async () => {
                    try {
                      await form.validateFields(["table"]);
                      const { items } = await api(
                        "/feature-config/offline-columns?table=" +
                          encodeURIComponent(form.getFieldValue("table")),
                      );
                      setHiveColumns(items);
                      if (!items.length)
                        message.info(
                          "本地未收录该 Hive 表的列，可用「＋ 特征列」填写",
                        );
                      else
                        message.success("已获取 " + items.length + " 个特征列");
                    } catch (e: any) {
                      if (!e.errorFields) message.error(e.message);
                    }
                  }}
                >
                  获取特征列
                </Button>
              </Form.Item>
              <Form.List name="columns">
                {(rows, { add, remove }) => (
                  <>
                    <Form.Item label="特征列选择">
                      <Space>
                        <Button onClick={() => add({})}>＋ 特征列</Button>
                        <Button
                          disabled={!hiveColumns.length}
                          onClick={() =>
                            form.setFieldValue(
                              "columns",
                              hiveColumns.map((c) => ({ ...c })),
                            )
                          }
                        >
                          全选
                        </Button>
                        <Button onClick={() => remove(rows.map((r) => r.name))}>
                          清空
                        </Button>
                      </Space>
                    </Form.Item>
                    {rows.map((r) => (
                      <Space key={r.key} align="start">
                        <span>{r.name + 1}</span>
                        {(
                          [
                            "column",
                            "dataType",
                            "name",
                            "enName",
                            "description",
                          ] as const
                        ).map((k, i) => (
                          <Form.Item
                            key={k}
                            name={[r.name, k]}
                            rules={[{ required: true }]}
                          >
                            {k === "dataType" ? (
                              <Select
                                options={opts(resultTypes)}
                                placeholder="结果类型"
                              />
                            ) : (
                              <Input
                                placeholder={
                                  [
                                    "特征列",
                                    "结果类型",
                                    "特征中文名",
                                    "特征英文名",
                                    "特征说明",
                                  ][i]
                                }
                              />
                            )}
                          </Form.Item>
                        ))}
                        <Button onClick={() => remove(r.name)}>移除</Button>
                      </Space>
                    ))}
                  </>
                )}
              </Form.List>
            </>
          )}
        </Section>
        {(derived || acc || kv) && (
          <Section title="逻辑测试">
            <Form.Item label="点击并测试">
              <Space>
                <Button
                  type="primary"
                  onClick={() => {
                    setTestError("");
                    setTesting(true);
                  }}
                >
                  逻辑测试
                </Button>
                <Button onClick={() => setRecordsOpen(true)}>测试记录</Button>
              </Space>
              <div className="muted">
                逻辑信息修改后，至少有一个测试 case 通过后才可提交。
              </div>
            </Form.Item>
          </Section>
        )}
      </Form>
      <Modal
        open={eventOpen}
        title="新增累计事件"
        onCancel={() => setEventOpen(false)}
        onOk={async () => {
          try {
            const r = await api("/feature-config/events", "POST", {
              name: eventName,
            });
            form.setFieldValue("events", [
              ...new Set([...(form.getFieldValue("events") || []), r.label]),
            ]);
            catalog.reload();
            setEventName("");
            setEventOpen(false);
          } catch (e: any) {
            message.error(e.message);
          }
        }}
      >
        <Input
          placeholder="事件名称"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />
      </Modal>
      <Modal
        open={testing}
        title="逻辑测试"
        onCancel={() => setTesting(false)}
        onOk={run}
        okText="执行测试"
        confirmLoading={busy}
      >
        {acc && (
          <Select
            defaultValue="写累计条件"
            options={opts(
              mode === "模版配置"
                ? ["写累计条件", "读取条件"]
                : ["写累计条件", "读取条件", "删除条件"],
            )}
            onChange={(v) => form.setFieldValue("testCondition", v)}
          />
        )}
        <Form layout="vertical">
          <Form.Item
            label="输入参数（JSON）"
            extra={kv ? "kv 字段以库名为键，库内保存测试键值对。" : undefined}
          >
            <Input.TextArea
              rows={5}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="期望输出（JSON）">
            <Input value={expect} onChange={(e) => setExpect(e.target.value)} />
          </Form.Item>
          {testError && <Alert type="error" message={testError} />}
        </Form>
      </Modal>
      <Modal
        open={recordsOpen}
        title="测试记录"
        onCancel={() => setRecordsOpen(false)}
        footer={null}
      >
        <Table
          rowKey={(_, i) => String(i)}
          dataSource={tests}
          columns={[
            { title: "输入", dataIndex: "input" },
            { title: "期望", render: (_, r) => JSON.stringify(r.expected) },
            { title: "实际", render: (_, r) => JSON.stringify(r.actual) },
            { title: "结果", render: (_, r) => (r.passed ? "通过" : "未通过") },
          ]}
        />
      </Modal>
    </div>
  );
}
