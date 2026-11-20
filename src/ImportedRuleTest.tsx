import { useState } from "react";
import { Alert, Button, Drawer, Form, Input, Radio, Space, Table } from "antd";
import { api } from "./api";
import { useRemote } from "./components";
import { TestPackages } from "./TestPackages";
export function ImportedRuleTest({ id }: { id: number }) {
  const [open, setOpen] = useState(false),
    [input, setInput] = useState("{}"),
    [expected, setExpected] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const tests = useRemote<{ items: any[] }>("/rules/" + id + "/tests");
  async function run() {
    try {
      setBusy(true);
      setError("");
      const result = await api("/rules/" + id + "/test", "POST", {
        input: JSON.parse(input),
        expected,
      });
      tests.reload();
      if (result.passed) setOpen(false);
      else setError("实际输出与期望输出不一致");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Space>
        <Button type="primary" onClick={() => setOpen(true)}>
          添加测试信息
        </Button>
        <TestPackages />
      </Space>
      {!!tests.data?.items.length && (
        <Table
          size="small"
          rowKey="id"
          dataSource={tests.data.items}
          columns={[
            {
              title: "本地测试入参",
              dataIndex: "input",
              render: (v) => (typeof v === "string" ? v : JSON.stringify(v)),
            },
            { title: "期望输出", render: (_, r: any) => String(!!r.expected) },
            { title: "实际输出", render: (_, r: any) => String(!!r.actual) },
            {
              title: "结果",
              render: (_, r: any) => (r.passed ? "通过" : "未通过"),
            },
          ]}
        />
      )}
      <Drawer
        width={700}
        title="添加测试信息"
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button loading={busy} type="primary" onClick={run}>
            执行测试
          </Button>
        }
      >
        <Form layout="vertical">
          <Form.Item label="输入参数（JSON串模式）">
            <Input.TextArea
              rows={12}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="期望输出">
            <Radio.Group
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              options={[
                { label: "命中", value: true },
                { label: "不命中", value: false },
              ]}
            />
          </Form.Item>
          {error && <Alert type="warning" message={error} />}
        </Form>
      </Drawer>
    </div>
  );
}
