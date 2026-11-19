import { useState } from "react";
import { App, Button, Form, InputNumber, Modal, Select } from "antd";
import { useRemote } from "./components";
import { api } from "./api";
export function ScenePolicyAdd({
  module,
  id,
  nodeId,
  onSaved,
}: {
  module: string;
  id: number;
  nodeId?: string;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false),
    [q, setQ] = useState("");
  const [form] = Form.useForm();
  const rules = useRemote<any>(
      open ? "/entities/rulePage?pageSize=30&q=" + encodeURIComponent(q) : "",
    ),
    decisions = useRemote<any>(
      open ? "/entities/decisionList?pageSize=100" : "",
    );
  async function save() {
    try {
      const values = await form.validateFields();
      await api("/scenes/" + module + "/" + id + "/rules", "POST", {
        ...values,
        nodeId,
      });
      setOpen(false);
      onSaved();
      message.success("策略配置已保存");
    } catch (e: any) {
      if (e.code === "CHANGE_REQUIRED") setOpen(false);
      if (!e.errorFields) message.error(e.message);
    }
  }
  return (
    <>
      <Button
        type="primary"
        onClick={() => {
          form.resetFields();
          form.setFieldsValue({ status: "标记", priority: 1 });
          setOpen(true);
        }}
      >
        添加规则
      </Button>
      <Modal
        title="添加场景策略配置"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="ruleId" label="规则" rules={[{ required: true }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={setQ}
              options={rules.data?.items.map((r: any) => ({
                value: r.id,
                label: r.id + "-" + r.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="decisionId"
            label="决策"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={decisions.data?.items.map((r: any) => ({
                value: r.id,
                label: r.id + "-" + r.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={["离线", "标记", "生效"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
