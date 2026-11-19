import { ChangeReview } from "./ChangeReview";
import { PolicyBatch } from "./PolicyBatch";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
} from "antd";
import { api, entityPath } from "./api";
import { useRemote } from "./components";
import {
  enterChangeEnvironment,
  leaveChangeEnvironment,
  useChangeTaskId,
} from "./change-context";
export function ChangeEnvironmentBar() {
  const id = useChangeTaskId();
  const { data, error, reload } = useRemote<any>(
    id ? "/changes/" + id + "/context" : "",
  );
  const { message } = App.useApp();
  const [review, setReview] = useState(false),
    [batch, setBatch] = useState(false);
  if (!id) return null;
  const experiment = () => {
    leaveChangeEnvironment("/release/experiment-config?id=" + id);
  };
  return (
    <>
      <div className="change-environment-bar">
        <span>
          ⓘ 您当前处在变更环境，变更环境和线上环境的操作相互隔离{" "}
          <Tag>
            {id} {data?.name}
          </Tag>
        </span>
        <Space>
          <Button
            onClick={() =>
              Modal.confirm({
                title: "取消当前变更？",
                content:
                  "请确认是否取消变更，取消后将自动保存您编辑的信息，您可点击变更任务管理列表中「编辑」按钮继续编辑。",
                onOk: async () => {
                  try {
                    leaveChangeEnvironment("/release/list");
                  } catch (e: any) {
                    message.error(e.message);
                  }
                },
              })
            }
          >
            取消变更
          </Button>
          <Button
            type="primary"
            disabled={!data?.isEditable}
            onClick={() => setBatch(true)}
          >
            批量变更
          </Button>
          <Button type="primary" onClick={() => setReview(true)}>
            变更内容（{data?.localChanges?.length || 0}）
          </Button>
          <Button
            danger
            type="primary"
            disabled={!data?.isEditable}
            onClick={() =>
              leaveChangeEnvironment(
                "/release/gray-config?id=" + id + "&deployMode=0",
              )
            }
          >
            ϟ 紧急变更
          </Button>
          <Button type="primary" onClick={experiment}>
            去实验
          </Button>
        </Space>
        {error && <Alert type="error" message={error} />}
      </div>
      <Modal
        title="变更内容"
        width={1100}
        open={review}
        onCancel={() => setReview(false)}
        footer={
          <Button
            type="primary"
            onClick={() => {
              setReview(false);
              experiment();
            }}
          >
            去实验
          </Button>
        }
      >
        <ChangeReview task={data} onChanged={reload} />
      </Modal>
      <PolicyBatch open={batch} onClose={() => setBatch(false)} />
    </>
  );
}
export function ChangeEnvironmentLauncher() {
  const { message } = App.useApp();
  const [request, setRequest] = useState<any>(),
    [selected, setSelected] = useState<number>(),
    [name, setName] = useState(""),
    [saving, setSaving] = useState(false);
  const tasks = useRemote<any>(
    request ? entityPath("release/list") + "?pageSize=100" : "",
  );
  useEffect(() => {
    const open = (e: any) => {
      setRequest(e.detail || {});
      setSelected(undefined);
      setName("");
    };
    window.addEventListener("zeus-open-change", open);
    return () => window.removeEventListener("zeus-open-change", open);
  }, []);
  async function enter() {
    try {
      setSaving(true);
      let id = selected;
      if (!id) {
        if (!name.trim())
          return message.error("请输入变更任务名称或选择已有任务");
        const task = await api<any>(entityPath("release/list"), "POST", {
          name: name.trim(),
          phase: "实验",
          status: "待启动",
          progress: 0,
          type: "普通变更",
          localChanges: [],
        });
        id = task.id;
      }
      if (request.path)
        await api(
          request.path +
            (request.path.includes("?") ? "&" : "?") +
            "changeTaskId=" +
            id,
          request.method || "PUT",
          request.body,
        );
      enterChangeEnvironment(id!, request.returnPath);
      request.onEntered?.(id);
      setRequest(undefined);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="进入策略变更环境"
      open={!!request}
      onCancel={() => {
        request?.onCancel?.();
        setRequest(undefined);
      }}
      onOk={enter}
      confirmLoading={saving}
      okText="进入变更环境"
      cancelText="取消"
    >
      <Alert
        type="info"
        showIcon
        message="已生效规则的修改、删除须在变更环境中完成，发布前不会改变线上配置。"
      />
      <Form layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item label="选择变更任务">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            value={selected}
            onChange={setSelected}
            options={tasks.data?.items
              .filter(
                (t: any) =>
                  t.phase === "实验" &&
                  !["已中止", "已回滚", "已完成"].includes(t.status),
              )
              .map((t: any) => ({ value: t.id, label: t.id + "-" + t.name }))}
          />
        </Form.Item>
        <Form.Item label="或新建变更任务">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入发布管控任务名称"
            disabled={!!selected}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
