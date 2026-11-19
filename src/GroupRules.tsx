import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useRemote } from "./components";
import { ReleaseCreator } from "./SourceRelease";
export function GroupRules({ id }: { id: number }) {
  const { message } = App.useApp(),
    navigate = useNavigate();
  const { data, reload, error, loading } = useRemote<any>(
    "/groups/" + id + "/rules",
  );
  const [query, setQuery] = useState(""),
    [ruleQuery, setRuleQuery] = useState("");
  const rules = useRemote<any>(
    "/entities/rulePage?pageSize=30&q=" + encodeURIComponent(ruleQuery),
  );
  const decisions = useRemote<any>("/entities/decisionList?pageSize=100");
  const [edit, setEdit] = useState<any>(),
    [open, setOpen] = useState(false),
    [change, setChange] = useState(false),
    [remove, setRemove] = useState(false),
    [pending, setPending] = useState<any>();
  const [form] = Form.useForm();
  function show(row?: any, asChange = false, asRemove = false) {
    setEdit(row);
    setChange(asChange);
    setRemove(asRemove);
    form.resetFields();
    form.setFieldsValue({ status: "标记", priority: 1, ...row });
    setOpen(true);
  }
  async function save() {
    try {
      const values = await form.validateFields();
      if (change) {
        setPending({
          objectType: "规则组策略",
          groupId: id,
          configId: edit.id,
          ruleId: edit.ruleId,
          action: remove ? "删除" : "修改",
          before: edit,
          after: values,
        });
        setOpen(false);
        return;
      }
      const result = await api(
        edit
          ? "/groups/" + id + "/rules/" + encodeURIComponent(edit.id)
          : "/groups/" + id + "/rules",
        edit ? "PUT" : "POST",
        values,
      );
      setOpen(false);
      reload();
      message.success("已保存，同步 " + result.synced + " 处关联配置");
    } catch (e: any) {
      if (!e.errorFields) message.error(e.message);
    }
  }
  return (
    <div className="source-nested">
      <Alert
        type="info"
        showIcon
        message="新增规则仅支持离线、标记，并同步至引用该规则组的场景和节点。任一场景生效的规则，须通过策略变更调整或删除。"
      />
      <Space
        style={{
          margin: "16px 0",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <Input.Search
          allowClear
          placeholder="规则ID / 中英文名称"
          onSearch={setQuery}
        />
        <Space>
          <Button onClick={() => navigate("/addRulePage?ruleGroupId=" + id)}>
            新建规则
          </Button>
          <Button type="primary" onClick={() => show()}>
            添加规则
          </Button>
          <Button onClick={reload}>刷新</Button>
        </Space>
      </Space>
      {error && <Alert type="error" message={error} />}
      <Table<any>
        size="small"
        rowKey="id"
        loading={loading}
        scroll={{ x: 1050 }}
        dataSource={data?.items.filter(
          (r: any) =>
            !query ||
            JSON.stringify([r.ruleId, r.rule?.name, r.rule?.enName]).includes(
              query,
            ),
        )}
        columns={[
          { title: "规则ID", dataIndex: "ruleId", width: 110 },
          {
            title: "规则",
            render: (_, r) => (
              <Link target="_blank" to={"/ruleDetails?id=" + r.ruleId}>
                {r.rule?.name || r.ruleName}
                <div className="secondary-name">
                  {r.rule?.enName || r.ruleName}
                </div>
              </Link>
            ),
          },
          {
            title: "决策/附加信息/理由",
            render: (_, r) => (
              <>
                {r.decision || r.decisionName}
                <div className="secondary-name">
                  {r.extraInfoName || "无附加信息"} / {r.reasonName || "无理由"}
                </div>
              </>
            ),
          },
          { title: "优先级", dataIndex: "priority", width: 85 },
          {
            title: "状态",
            render: (_, r) => (
              <Space>
                <Tag
                  color={
                    r.status === "标记"
                      ? "blue"
                      : r.status === "生效"
                        ? "green"
                        : "default"
                  }
                >
                  {r.status}
                </Tag>
                {r.locked && (
                  <Tooltip title="任一场景中生效，须通过策略变更调整">
                    <Tag color="green">场景生效</Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          {
            title: "操作",
            width: 270,
            render: (_, r) => (
              <Space>
                <Tooltip
                  title={r.locked ? "该规则在场景中生效，请走策略变更" : ""}
                >
                  <span>
                    <Button
                      type="link"
                      size="small"
                      disabled={r.locked}
                      onClick={() => show(r)}
                    >
                      编辑
                    </Button>
                  </span>
                </Tooltip>
                <Popconfirm
                  title="删除该规则组配置并同步所有关联场景？"
                  disabled={r.locked}
                  onConfirm={async () => {
                    try {
                      await api(
                        "/groups/" + id + "/rules/" + encodeURIComponent(r.id),
                        "DELETE",
                      );
                      reload();
                    } catch (e: any) {
                      message.error(e.message);
                    }
                  }}
                >
                  <Button type="link" size="small" disabled={r.locked}>
                    删除
                  </Button>
                </Popconfirm>
                <Button type="link" size="small" onClick={() => show(r, true)}>
                  策略变更
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() =>
                    Modal.info({
                      title: "场景引用情况",
                      width: 800,
                      content: (
                        <Table<any>
                          rowKey={(_, i) => String(i)}
                          pagination={{ pageSize: 10 }}
                          dataSource={r.references}
                          columns={[
                            {
                              title: "场景",
                              render: (_, x) => (
                                <Link
                                  target="_blank"
                                  to={
                                    (x.module === "graphTemplate"
                                      ? "/layerScene/template/detail"
                                      : x.module === "layerScene"
                                        ? "/layerScene/detail"
                                        : "/scene") +
                                    "?id=" +
                                    x.id
                                  }
                                >
                                  {x.id} {x.name}
                                </Link>
                              ),
                            },
                            { title: "节点", dataIndex: "nodeId" },
                            { title: "状态", dataIndex: "status" },
                          ]}
                        />
                      ),
                    })
                  }
                >
                  引用
                </Button>
              </Space>
            ),
          },
        ]}
        pagination={{ pageSize: 20, showTotal: (n) => "共 " + n + " 条" }}
      />
      <Modal
        width={720}
        title={change ? "规则组策略变更" : edit ? "编辑规则组规则" : "添加规则"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText={change ? "下一步：创建变更" : "保存"}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {change && (
            <Form.Item label="变更操作">
              <Select
                value={remove ? "删除" : "修改"}
                onChange={(v) => setRemove(v === "删除")}
                options={["修改", "删除"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          )}
          {!edit && (
            <Form.Item
              name="ruleId"
              label="规则"
              rules={[{ required: true, message: "请选择规则" }]}
            >
              <Select
                showSearch
                filterOption={false}
                onSearch={setRuleQuery}
                options={rules.data?.items.map((r: any) => ({
                  value: r.id,
                  label: r.id + "-" + r.name,
                }))}
              />
            </Form.Item>
          )}
          {!remove && (
            <>
              <Form.Item
                name="decisionId"
                label="决策"
                rules={[{ required: !edit, message: "请选择决策" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={decisions.data?.items.map((d: any) => ({
                    value: d.id,
                    label: d.id + "-" + d.name,
                  }))}
                />
              </Form.Item>
              <Space>
                <Form.Item name="extraInfoId" label="附加信息ID">
                  <InputNumber min={0} />
                </Form.Item>
                <Form.Item name="reasonId" label="理由ID">
                  <InputNumber min={0} />
                </Form.Item>
              </Space>
              <Form.Item
                name="priority"
                label="优先级"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} />
              </Form.Item>
              <Form.Item
                name="status"
                label="状态"
                rules={[{ required: true }]}
              >
                <Select
                  options={(change
                    ? ["离线", "标记", "生效"]
                    : ["离线", "标记"]
                  ).map((value) => ({ value, label: value }))}
                />
              </Form.Item>
              <span className="muted">
                仅限于添加时的默认状态编辑，不展示规则在场景中的状态
              </span>
            </>
          )}
        </Form>
      </Modal>
      <ReleaseCreator
        open={!!pending}
        copy={{ changes: pending ? [pending] : [] }}
        onClose={() => setPending(undefined)}
        onSaved={() => {
          setPending(undefined);
          navigate("/release/list");
        }}
      />
    </div>
  );
}
