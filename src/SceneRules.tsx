import { useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from "antd";

import {Link} from "./navigation";
import { api } from "./api";
import { useRemote } from "./components";
import type { Row } from "./catalog";
export function SceneRules({ module, id }: { module: string; id: number }) {
  const { message } = App.useApp();
  const { data, reload, loading } = useRemote<{ items: any[] }>(
    "/scenes/" + module + "/" + id + "/rules",
  );
  const { data: rules } = useRemote<{ items: Row[] }>(
    "/entities/rulePage?pageSize=100",
  );
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [selected, setSelected] = useState<React.Key[]>([]);
  async function save() {
    try {
      const values = await form.validateFields();
      await api(
        editing
          ? "/scene-rules/" + editing.id
          : "/scenes/" + module + "/" + id + "/rules",
        editing ? "PUT" : "POST",
        values,
      );
      setOpen(false);
      reload();
      message.success("配置已保存");
    } catch (e: any) {
      if (!e.errorFields) message.error(e.message);
    }
  }
  async function batch(status: string) {
    try {
      await Promise.all(
        (data?.items || [])
          .filter((r) => selected.includes(r.id))
          .map((r) => api("/scene-rules/" + r.id, "PUT", { ...r, status })),
      );
      reload();
      setSelected([]);
      message.success("批量修改成功");
    } catch (e: any) {
      message.error(e.message);
    }
  }
  return (
    <div className="scene-rules">
      <div className="nested-toolbar">
        <Space>
          {selected.length > 0 && (
            <>
              <Button size="small" onClick={() => batch("生效")}>
                批量生效
              </Button>
              <Button size="small" onClick={() => batch("标记")}>
                批量标记
              </Button>
            </>
          )}
        </Space>
        <Button
          type="link"
          onClick={() => {
            setEditing(null);
            form.resetFields();
            form.setFieldsValue({
              status: "生效",
              decision: "人工审核",
              priority: 1,
            });
            setOpen(true);
          }}
        >
          添加
        </Button>
      </div>
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={data?.items || []}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        columns={[
          { title: "类型", render: () => "规则" },
          {
            title: "规则/规则组",
            render: (_, r) => (
              <Link to={"/ruleDetails?id=" + r.rule_id}>
                {r.rule_id}-{r.rule?.name || "已删除规则"}
              </Link>
            ),
          },
          { title: "决策/附加信息/理由/衍生参数", dataIndex: "decision" },
          {
            title: "状态",
            dataIndex: "status",
            render: (s) => (
              <Tag color={s === "生效" ? "green" : "blue"}>{s}</Tag>
            ),
          },
          { title: "优先级", dataIndex: "priority" },
          {
            title: "最后修改",
            render: (_, r) => r.rule?.updatedAt?.slice(0, 19).replace("T", " "),
          },
          {
            title: "操作",
            render: (_, r) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({ ruleId: r.rule_id, ...r });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="移除这条策略配置？"
                  onConfirm={async () => {
                    try {
                      await api("/scene-rules/" + r.id, "DELETE");
                      reload();
                    } catch (e: any) {
                      message.error(e.message);
                    }
                  }}
                >
                  <Button type="link" size="small">
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        width={680}
        title={editing ? "编辑场景策略配置" : "添加规则/规则组"}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button type="primary" onClick={save}>
            保存
          </Button>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="ruleId"
            label="规则"
            rules={[{ required: true, message: "请选择规则" }]}
          >
            <Select
              disabled={!!editing}
              showSearch
              optionFilterProp="label"
              options={rules?.items.map((r) => ({
                value: r.id,
                label: r.id + "-" + r.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="decision" label="决策">
            <Select
              options={["通过", "拒绝", "人工审核", "标记"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={["生效", "标记", "灰度", "停用"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={1} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
