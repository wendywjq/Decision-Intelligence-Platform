import { useEffect } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Radio,
  Alert,
  Table,
} from "antd";
import {useNavigate,useSearchParams} from "react-router-dom";
import {Link} from "./navigation";
import { api } from "./api";
import { PageHeader, Section, useRemote } from "./components";
export function FusePage() {
  const [params] = useSearchParams();
  const [form] = Form.useForm();
  const id = params.get("id");
  const saved = useRemote<any>(id ? "/entities/rulesFuseList/" + id : "");
  useEffect(() => {
    if (saved.data) form.setFieldsValue(saved.data);
  }, [saved.data, form]);
  const nav = useNavigate();
  const { message } = App.useApp();
  if (saved.error) return <Alert type="error" message={saved.error} />;
  return (
    <>
      <PageHeader title={id ? "修改熔断配置" : "新建熔断配置"}>
        <Button onClick={() => nav("/rulesFuseList")}>取消</Button>
        <Button type="primary" onClick={() => form.submit()}>
          完成
        </Button>
      </PageHeader>
      <Alert
        type="info"
        showIcon
        message="当规则命中情况产生异常，达到预设的熔断阈值时，将规则由生效降级为标记。此副本仅保存配置，不执行线上监控。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          type: params.get("sourceType") === "2" ? "分层场景熔断" : "单点熔断",
          status: "启用",
          sceneId: params.get("sceneId"),
          ruleId: params.get("ruleId"),
          decision: params.get("decisionId"),
          action: "人工熔断",
          times: [{ type: "自由时间段", holiday: "否" }],
          conditions: [
            { minutes: 1, metric: "规则命中量", fn: "绝对量", operator: ">=" },
          ],
          notify: "大象",
          frequency: "按间隔",
          recipients: ["场景负责人"],
        }}
        onFinish={async (values) => {
          if (
            values.times.some(
              (t: any) =>
                !Number.isFinite(Date.parse(t.start)) ||
                !Number.isFinite(Date.parse(t.end)) ||
                Date.parse(t.start) >= Date.parse(t.end),
            )
          )
            return message.warning("作用时间的结束时间必须晚于开始时间");
          try {
            await api(
              "/entities/rulesFuseList" + (id ? "/" + id : ""),
              id ? "PUT" : "POST",
              { ...saved.data, ...values },
            );
            message.success("熔断配置已保存");
            nav("/rulesFuseList");
          } catch (e: any) {
            message.error(e.message);
          }
        }}
      >
        <Section title="熔断模式">
          <Form.Item name="type">
            <Radio.Group
              options={["单点熔断", "分层场景熔断", "画布熔断", "任务熔断"]}
            />
          </Form.Item>
        </Section>
        <Section title="基本信息">
          <Form.Item name="name" label="熔断名称" rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Radio.Group options={["启用", "停用"]} />
          </Form.Item>
        </Section>
        <Section title="作用范围">
          {[
            ["sceneId", "场景"],
            ["ruleId", "规则"],
            ["decision", "决策"],
          ].map(([name, label]) => (
            <Form.Item
              key={name}
              name={name}
              label={label}
              rules={[{ required: true }]}
            >
              <Input placeholder="输入 ID，多个以逗号分隔" />
            </Form.Item>
          ))}
        </Section>
        <Section title="作用时间">
          <Form.List name="times">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start">
                    <Form.Item name={[field.name, "type"]} label="时间类型">
                      <Select
                        style={{ width: 150 }}
                        options={["自由时间段"].map((value) => ({ value }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "start"]}
                      label="开始时间"
                      rules={[{ required: true }]}
                    >
                      <Input placeholder="YYYY-MM-DD HH:mm" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "end"]}
                      label="结束时间"
                      rules={[{ required: true }]}
                    >
                      <Input placeholder="YYYY-MM-DD HH:mm" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "holiday"]}
                      label="排除节假日"
                    >
                      <Select
                        style={{ width: 100 }}
                        options={["是", "否"].map((value) => ({ value }))}
                      />
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button onClick={() => remove(field.name)}>移除</Button>
                    )}
                  </Space>
                ))}
                <Button
                  onClick={() => add({ type: "自由时间段", holiday: "否" })}
                >
                  添加作用时间
                </Button>
              </>
            )}
          </Form.List>
        </Section>
        <Section title="熔断规则">
          <Form.List name="conditions">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start">
                    <Form.Item
                      name={[field.name, "minutes"]}
                      label="时间周期（最近x分钟）"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={1} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "metric"]}
                      label="计算指标"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item name={[field.name, "fn"]} label="计算函数">
                      <Select
                        style={{ width: 110 }}
                        options={["绝对量", "比例"].map((value) => ({ value }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "operator"]} label="对比关系">
                      <Select
                        style={{ width: 90 }}
                        options={[">=", ">", "<=", "<", "="].map((value) => ({
                          value,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "threshold"]}
                      label="阈值"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={0} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button onClick={() => remove(field.name)}>移除</Button>
                    )}
                  </Space>
                ))}
                <Button
                  onClick={() =>
                    add({ minutes: 1, fn: "绝对量", operator: ">=" })
                  }
                >
                  添加熔断规则
                </Button>
              </>
            )}
          </Form.List>
        </Section>
        <Section title="熔断动作">
          <Form.Item name="action" label="执行动作">
            <Radio.Group options={["人工熔断", "自动熔断"]} />
          </Form.Item>
          <Form.Item name="notify" label="通知方式">
            <Select options={[{ value: "大象" }]} />
          </Form.Item>
          <Form.Item name="frequency" label="通知频次上限">
            <Radio.Group options={["按间隔", "无"]} />
          </Form.Item>
          <Form.Item
            name="recipients"
            label="通知人"
            rules={[{ required: true }]}
          >
            <Select
              mode="tags"
              options={[
                "业务空间负责人",
                "业务空间变更通知人",
                "场景负责人",
                "自定义群",
              ].map((value) => ({ value }))}
            />
          </Form.Item>
        </Section>
      </Form>
    </>
  );
}

export function FuseRelated({
  sceneId,
  ruleId,
  decisionId,
}: {
  sceneId: number;
  ruleId: number;
  decisionId: number;
}) {
  const remote = useRemote<any>(
    "/entities/rulesFuseList?ruleId=" + ruleId + "&pageSize=100",
  );
  const rows = (remote.data?.items || []).filter(
    (r: any) =>
      String(r.sceneId).split(",").includes(String(sceneId)) &&
      String(r.decision).split(",").includes(String(decisionId)),
  );
  return (
    <>
      <Space>
        <Link
          target="_blank"
          to={
            "/rulesFuseAdd?sourceType=2&sceneId=" +
            sceneId +
            "&ruleId=" +
            ruleId +
            "&decisionId=" +
            decisionId
          }
        >
          添加熔断配置
        </Link>
        <Button onClick={remote.reload}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        loading={remote.loading}
        dataSource={rows}
        columns={[
          { title: "熔断ID", dataIndex: "id" },
          { title: "熔断名称", dataIndex: "name" },
          { title: "状态", dataIndex: "status" },
        ]}
      />
      <p className="muted">
        展示本地保存的配置；来源快照未包含线上已有熔断数据。
      </p>
    </>
  );
}
