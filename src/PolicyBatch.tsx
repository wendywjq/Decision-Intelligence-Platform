import { useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import { api } from "./api";
import { useRemote } from "./components";
export function PolicyBatch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [q, setQ] = useState(""),
    [scene, setScene] = useState(""),
    [selected, setSelected] = useState<React.Key[]>([]),
    [action, setAction] = useState("修改");
  const [form] = Form.useForm();
  const rows = useRemote<any>(
      open
        ? "/policy-configs?q=" + encodeURIComponent(q) + "&sceneId=" + scene
        : "",
    ),
    decisions = useRemote<any>(
      open ? "/entities/decisionList?pageSize=100" : "",
    );
  async function save() {
    try {
      if (!selected.length) return message.error("请选择策略配置");
      const patch = await form.validateFields();
      await api("/policy-configs/batch", "POST", {
        ids: selected,
        action,
        patch,
      });
      message.success("批量变更已保存");
      onClose();
      setSelected([]);
    } catch (e: any) {
      message.error(e.message);
    }
  }
  return (
    <Modal
      width={1100}
      title="批量变更"
      open={open}
      onCancel={onClose}
      onOk={save}
      okText="保存变更"
    >
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="场景ID"
          value={scene}
          onChange={(e) => setScene(e.target.value)}
        />
        <Input.Search placeholder="规则ID / 名称" onSearch={setQ} />
        <Select
          value={action}
          onChange={setAction}
          options={["修改", "删除"].map((value) => ({ value, label: value }))}
        />
      </Space>
      <Table<any>
        size="small"
        rowKey="id"
        dataSource={rows.data?.items}
        loading={rows.loading}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        pagination={{ pageSize: 6 }}
        columns={[
          {
            title: "场景",
            render: (_, r) => r.scope?.sceneId + " " + (r.sceneName || ""),
          },
          {
            title: "规则",
            render: (_, r) =>
              r.ruleId + " " + (r.ruleName || r.rule?.name || ""),
          },
          { title: "配置ID", render: (_, r) => r.sourceConfId || r.id },
          {
            title: "规则组 / 节点",
            render: (_, r) =>
              [
                r.groupId
                  ? [r.groupId, r.ruleGroupName].filter(Boolean).join(" ")
                  : "直挂规则",
                r.scope?.nodeId,
              ]
                .filter(Boolean)
                .join(" / "),
          },
          { title: "决策", dataIndex: "decision" },
          { title: "状态", dataIndex: "status" },
          { title: "优先级", dataIndex: "priority" },
        ]}
      />
      {action === "修改" && (
        <Form form={form} layout="inline" style={{ marginTop: 16 }}>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              style={{ width: 130 }}
              options={["离线", "标记", "生效", "灰度"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="decisionId" label="决策">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 240 }}
              options={decisions.data?.items.map((d: any) => ({
                value: d.id,
                label: d.id + "-" + d.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
