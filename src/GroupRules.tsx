import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Dropdown,
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
import { useNavigate } from "react-router-dom";
import { Link } from "./navigation";
import { api } from "./api";
import { useRemote } from "./components";
import { RiskTagSelect, RiskTagChips, useRiskTags } from "./RiskTagSelect";
import { tagDescendants } from "./risk-tags";
import { useChangeTaskId } from "./change-context";
import { formatDate } from "./date";
export function GroupRules({ id }: { id: number }) {
  const { message } = App.useApp(),
    navigate = useNavigate(),
    taskId = useChangeTaskId();
  const { data, reload, error, loading } = useRemote<any>(
    "/groups/" + id + "/rules",
  );
  const [query, setQuery] = useState(""),
    [risk, setRisk] = useState<number[]>([]),
    [ruleQuery, setRuleQuery] = useState(""),
    [selected, setSelected] = useState<React.Key[]>([]);
  const rules = useRemote<any>(
      "/entities/rulePage?pageSize=30&q=" + encodeURIComponent(ruleQuery),
    ),
    decisions = useRemote<any>("/entities/decisionList?pageSize=100");
  const [edit, setEdit] = useState<any>(),
    [open, setOpen] = useState(false),
    [batch, setBatch] = useState(false);
  const [form] = Form.useForm();
  const riskTags = useRiskTags(),
    allowed = tagDescendants(riskTags, risk);
  const rows = data?.items.filter(
    (r: any) =>
      (!query ||
        JSON.stringify([r.ruleId, r.rule?.name, r.rule?.enName]).includes(
          query,
        )) &&
      (!risk.length ||
        (r.riskTags || []).some((id: number) => allowed.has(id))),
  );
  function show(row?: any, bulk = false) {
    setEdit(row);
    setBatch(bulk);
    form.resetFields();
    form.setFieldsValue(bulk ? {} : { status: "标记", priority: 1, ...row });
    setOpen(true);
  }
  async function batchSave(action: string, patch: any = {}) {
    try {
      await api("/groups/" + id + "/rules/batch", "POST", {
        ids: selected,
        action,
        patch,
      });
      reload();
      setSelected([]);
      message.success(taskId ? "批量变更已保存，发布后生效" : "批量操作已保存");
    } catch (e: any) {
      message.error(e.message);
    }
  }
  async function save() {
    try {
      const values = await form.validateFields();
      if (batch) {
        await batchSave("修改", values);
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
      message.success(
        result.staged
          ? "已保存到变更环境，发布后同步"
          : "已保存，同步 " + result.synced + " 处关联配置",
      );
    } catch (e: any) {
      if (!e.errorFields) message.error(e.message);
    }
  }
  return (
    <div className="source-nested">
      <Alert
        type="info"
        showIcon
        message={
          taskId
            ? "正在编辑变更草稿，发布前不影响线上配置。"
            : "新增规则仅支持离线、标记；已生效规则请先从顶部进入变更环境。"
        }
      />
      <Space wrap style={{ margin: "16px 0" }}>
        <Input.Search
          allowClear
          placeholder="规则ID / 中英文名称"
          onSearch={setQuery}
        />
        <RiskTagSelect
          value={risk}
          onChange={setRisk}
          placeholder="按风险标签筛选"
          style={{ width: 280 }}
        />
        <Dropdown
          menu={{
            items: [
              { key: "修改", label: "批量修改决策/状态/优先级" },
              { key: "标记", label: "批量标记" },
              { key: "离线", label: "批量离线" },
              { key: "删除", label: "批量删除" },
            ],
            onClick: ({ key }) => {
              if (key === "修改") show(undefined, true);
              else if (key === "删除")
                Modal.confirm({
                  title: "批量删除所选规则配置？",
                  onOk: () => batchSave("删除"),
                });
              else batchSave("修改", { status: key });
            },
          }}
        >
          <Button disabled={!selected.length}>
            批量操作（{selected.length}）
          </Button>
        </Dropdown>
        <Button onClick={() => navigate("/addRulePage?ruleGroupId=" + id)}>
          新建规则
        </Button>
        <Button type="primary" onClick={() => show()}>
          添加规则
        </Button>
        <Button onClick={reload}>刷新</Button>
      </Space>
      {error && <Alert type="error" message={error} />}
      <Table<any>
        rowKey="id"
        size="small"
        loading={loading}
        scroll={{ x: 1300 }}
        dataSource={rows}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (n) => "共 " + n + " 条",
        }}
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
            title: "规则标签",
            width: 230,
            render: (_, r) => (
              <>
                <RiskTagChips ids={r.riskTags || []} />
                {(r.rule?.tags || [])
                  .filter(
                    (v: any) =>
                      typeof v === "string" &&
                      !riskTags.some(
                        (t) =>
                          (r.riskTags || []).includes(t.id) && t.name === v,
                      ),
                  )
                  .map((v: string) => (
                    <Tag key={v}>{v}</Tag>
                  ))}
              </>
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
              <Space wrap>
                <Tag
                  color={
                    r.status === "生效"
                      ? "green"
                      : r.status === "标记"
                        ? "blue"
                        : "default"
                  }
                >
                  {r.status}
                </Tag>
                {r.pendingAction && (
                  <Tag color="orange">待{r.pendingAction}</Tag>
                )}
                {r.locked && !taskId && <Tag color="green">场景生效</Tag>}
              </Space>
            ),
          },
          {
            title: "最后修改",
            width: 180,
            render: (_, r) => (
              <>
                {formatDate(r.modifiedAt || r.updatedAt || r.modtime)}
                <div className="secondary-name">
                  {r.modifiedBy || r.modifier || r.rule?.owner || "—"}
                </div>
              </>
            ),
          },
          {
            title: "操作",
            width: 120,
            render: (_, r) => (
              <Space>
                <Tooltip
                  title={
                    r.locked && !taskId ? "请在变更环境修改已生效规则" : ""
                  }
                >
                  <span>
                    <Button
                      type="link"
                      size="small"
                      disabled={
                        (r.locked && !taskId) || r.pendingAction === "删除"
                      }
                      onClick={() => show(r)}
                    >
                      编辑
                    </Button>
                  </span>
                </Tooltip>
                <Popconfirm
                  title="删除该规则组配置并同步关联场景？"
                  disabled={r.locked && !taskId}
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
                  <Button
                    type="link"
                    size="small"
                    disabled={
                      (r.locked && !taskId) || r.pendingAction === "删除"
                    }
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        width={720}
        title={
          batch ? "批量编辑规则组配置" : edit ? "编辑规则组规则" : "添加规则"
        }
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText="保存"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {!edit && !batch && (
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
          <Form.Item
            name="decisionId"
            label="决策"
            rules={[{ required: !edit && !batch, message: "请选择决策" }]}
          >
            <Select
              allowClear={batch}
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
            rules={[{ required: !batch }]}
          >
            <InputNumber min={0} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: !batch }]}>
            <Select
              allowClear={batch}
              options={(taskId && (edit || batch)
                ? ["离线", "标记", "生效", "灰度"]
                : ["离线", "标记"]
              ).map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <span className="muted">
            新增时仅配置默认状态，场景内实际状态以对应场景配置为准。
          </span>
        </Form>
      </Modal>
    </div>
  );
}
