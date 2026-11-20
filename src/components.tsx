import { RiskTagSelect } from "./RiskTagSelect";
import {
  CHANGE_EVENT,
  withChangeTask,
  useChangeTaskId,
  requestChangeEnvironment,
} from "./change-context";
import { RuleWizard } from "./RuleWizard";
import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
} from "antd";
import type { Field, Module, Row } from "./catalog";
import { api, entityPath } from "./api";
export function FieldControl({
  field,
  value,
  onChange,
}: {
  field: Field;
  value?: any;
  onChange?: (v: any) => void;
}) {
  if (field.kind === "textarea")
    return (
      <Input.TextArea
        rows={4}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={field.placeholder}
      />
    );
  if (field.kind === "number")
    return (
      <InputNumber
        style={{ width: "100%" }}
        value={Array.isArray(value) ? value[0] : value}
        onChange={onChange}
      />
    );
  if (field.options)
    return (
      <Select
        showSearch
        allowClear
        value={Array.isArray(value) ? value[0] : value}
        onChange={onChange}
        placeholder={field.placeholder || "请选择"}
        options={field.options.map((value) => ({ value, label: value }))}
      />
    );
  return (
    <Input
      allowClear
      value={Array.isArray(value) ? value.join(",") : value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={field.placeholder || "请输入" + field.label}
    />
  );
}
function BasicEntityEditor({
  module,
  row,
  open,
  onClose,
  onSaved,
  defaults,
}: {
  module: Module;
  defaults?: Record<string, any>;
  row?: Row;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        owner: "demo",
        type:
          module.fields.find((f) => f.key === "type")?.options?.[0] ||
          "实时计算",
        sceneType: "普通场景",
        status: "生效",
        tags: "通用策略",
        phase: "实验",
        progress: 0,
        ...row,
      });
    }
  }, [open, row, form, module]);
  async function save() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api(entityPath(module.key, row?.id), row ? "PUT" : "POST", {
        ...defaults,
        ...values,
      });
      message.success(row ? "保存成功" : "创建成功");
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
      title={row ? "编辑" + module.label : module.create}
      open={open}
      onClose={onClose}
      width={Math.min(1200, window.innerWidth - 220)}
      destroyOnHidden
      extra={
        <Button type="primary" loading={saving} onClick={save}>
          {row ? "保存" : "提交新建"}
        </Button>
      }
    >
      <Form
        form={form}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 18 }}
        className="entity-form"
      >
        {module.kind === "rule" && (
          <Form.Item name="riskTags" label="风险标签">
            <RiskTagSelect />
          </Form.Item>
        )}
        {module.fields.map((f) => (
          <Form.Item
            key={f.key}
            name={f.key}
            label={f.label}
            rules={
              f.required
                ? [{ required: true, message: "请填写" + f.label }]
                : undefined
            }
          >
            <FieldControl field={f} />
          </Form.Item>
        ))}
      </Form>
    </Drawer>
  );
}
export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      <Space>{children}</Space>
    </div>
  );
}
export function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
export function useRemote<T>(path: string, deps: any[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const previousResource = useRef("");
  useEffect(() => {
    const change = () => setVersion((v) => v + 1);
    const published = (event: StorageEvent) => {
      if (event.key === "zeus-policy-publication") change();
    };
    window.addEventListener("storage", published);
    window.addEventListener(CHANGE_EVENT, change);
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("storage", published);
      window.removeEventListener(CHANGE_EVENT, change);
      window.removeEventListener("hashchange", change);
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (!path) {
      setLoading(false);
      setData(undefined);
      setError("");
      return;
    }
    setLoading(true);
    const resource = withChangeTask(path);
    if (resource !== previousResource.current) setData(undefined);
    previousResource.current = resource;
    setError("");
    api<T>(path)
      .then((d) => {
        if (current) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, version, ...deps]);
  return { data, error, loading, reload: () => setVersion((v) => v + 1) };
}

export function EntityEditor(props: Parameters<typeof BasicEntityEditor>[0]) {
  const taskId = useChangeTaskId();
  const stats = useRemote<any>(
    props.module.kind === "rule" && props.row
      ? "/rules/" + props.row.id + "/stats"
      : "",
  );
  const preview = useRemote<any>(
    taskId && props.module.kind === "rule" && props.row
      ? entityPath("rulePage", props.row.id)
      : "",
  );
  useEffect(() => {
    if (
      props.open &&
      props.row &&
      props.module.kind === "rule" &&
      stats.data?.effective &&
      !taskId
    )
      requestChangeEnvironment({ onCancel: props.onClose });
  }, [props.open, props.row?.id, stats.data?.effective, taskId]);
  if (props.module.kind === "rule" && !props.row)
    return (
      <RuleWizard
        open={props.open}
        onClose={props.onClose}
        onSaved={props.onSaved}
      />
    );
  if (
    props.module.kind === "rule" &&
    props.row &&
    !taskId &&
    (stats.loading || stats.data?.effective)
  )
    return null;
  return <BasicEntityEditor {...props} row={preview.data || props.row} />;
}
