import { useState } from "react";
import {
  Button,
  Descriptions,
  Empty,
  Modal,
  Space,
  Table,
  Typography,
} from "antd";
import { Link } from "./navigation";
import type { ReactNode } from "react";

function parse(value: any) {
  if (typeof value !== "string" || !value.trim()) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function shown(value: any): ReactNode {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value))
    return (
      value
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
        .join("、") || "—"
    );
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
}
function Fields({ items }: { items: Record<string, any> }) {
  return (
    <Descriptions
      column={1}
      items={Object.entries(items).map(([label, value]) => ({
        key: label,
        label,
        children: shown(value),
      }))}
    />
  );
}
const manual =
  "https://github.com/wendywjq/platform_user_manual/tree/main/pages/339930787/children/Zeus平台功能操作手册__28139633/children/说明：表达式书写说明__176739529";
function Code({ label, value }: { label: string; value: any }) {
  const [full, setFull] = useState(false);
  return (
    <div className="feature-expression">
      <h4>{label}</h4>
      <Space>
        <Button size="small" href={manual} target="_blank">
          语法
        </Button>
        {value && (
          <>
            <Typography.Text copyable={{ text: String(value) }}>
              复制
            </Typography.Text>
            <Button size="small" onClick={() => setFull(true)}>
              全屏
            </Button>
          </>
        )}
      </Space>
      <pre className="code-editor">{value || "—"}</pre>
      <Modal
        open={full}
        onCancel={() => setFull(false)}
        title={label}
        footer={null}
        width="90vw"
      >
        <pre className="code-editor">{value}</pre>
      </Modal>
    </div>
  );
}
function Entries({ name, value }: { name: string; value: any }) {
  const parsed = parse(value);
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed).map(([name, value]) => ({ name, value }))
      : [];
  return (
    <>
      <h4>{name}</h4>
      <Table
        size="small"
        pagination={false}
        rowKey={(_, i) => String(i)}
        dataSource={rows}
        columns={[
          { title: "参数名称", dataIndex: "name" },
          { title: "参数值 / 特征映射", render: (_, r: any) => shown(r.value) },
          ...(rows.some((r: any) => r.required !== undefined)
            ? [{ title: "必填", render: (_: any, r: any) => shown(r.required) }]
            : []),
        ]}
      />
    </>
  );
}
export function FeatureLogic({
  row,
  archive,
  lineage,
}: {
  row: any;
  archive: any;
  lineage: any;
}) {
  const f = archive?.detail || row.featureDefinition || {},
    type =
      typeof f.type === "number"
        ? f.type
        : (
            {
              基础因子: 0,
              衍生因子: 1,
              累计因子: 2,
              扩展因子: 3,
              模型因子: 10,
              离线因子: 11,
            } as Record<string, number>
          )[row.type],
    expr = parse(f.expression || row.expression);
  const cfg = expr && typeof expr === "object" ? expr : {};
  const source =
    f.originExpression || f.origin_expression || f.expression || row.expression;
  const deps: any[] = lineage?.upstream || [];
  const dependencyNames = String(f.paramList || f.param_list || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const dependencyLinks = Array.from(
    new Set([...dependencyNames, ...deps.map((d) => d.enName)]),
  ).map((n) => {
    const d = deps.find((d) => d.enName === n);
    return d ? (
      <Link key={n} target="_blank" to={"/featureDetails?id=" + d.id}>
        {n}{" "}
      </Link>
    ) : (
      <span key={n}>{n} </span>
    );
  });
  let body: ReactNode;
  if (row.featureForm && row.featureForm.kind === "原始特征") body = null;
  else if (
    row.featureForm &&
    row.featureForm.logicMode === "高级配置" &&
    row.featureForm.kind === "衍生特征"
  )
    body = (
      <>
        <Fields
          items={{
            特征逻辑: "高级配置",
            计算函数: "拆分循环调用",
            目标特征依赖入参: f.targetParam,
            映射输入特征: f.inputFeature,
          }}
        />
        <Link target="_blank" to={"/featureDetails?id=" + f.targetId}>
          查看特征详情
        </Link>
      </>
    );
  else if (row.featureForm && row.featureForm.kind === "KV特征")
    body = (
      <>
        <Fields
          items={{
            关联类型: f.relationType,
            KV库: f.library,
            值类型: f.valueType,
          }}
        />
        <Code label="Key 表达式" value={f.keyExpression} />
      </>
    );
  else if (row.featureForm && row.featureForm.kind === "离线特征")
    body = (
      <Fields
        items={{
          数据表: f.table,
          维度列映射: f.dimensions,
          特征列: row.enName,
        }}
      />
    );
  else if (archive?.available === false)
    body = <Empty description="来源未提供计算定义" />;
  else if (row.sourceKind === "param" && type === 8)
    body = (
      <>
        <Fields
          items={{
            数据接口: lineage?.fetcher?.detail?.name || lineage?.fetcher?.id,
            依赖配置ID: cfg.dependencyId,
          }}
        />
        <Entries
          name="入参信息"
          value={lineage?.dependency?.inputDependentConfig}
        />
        <Entries
          name="出参信息"
          value={lineage?.dependency?.outputDependentConfig}
        />
        {lineage?.fetcher && (
          <Link target="_blank" to={"/fetcher/edit?id=" + lineage.fetcher.id}>
            数据接口详情
          </Link>
        )}
      </>
    );
  else if (row.sourceKind === "param" || row.type === "参数")
    body = (
      <Fields
        items={{
          输入参数: f.name || row.enName,
          参数说明: f.description || row.description,
        }}
      />
    );
  else if (type === 2) {
    const a = f.accumulation || {};
    body = (
      <>
        <h4>写累计条件</h4>
        <Fields
          items={{
            配置方式: a.mode,
            累计事件: a.events,
            ...(cfg.accumulateId ? { 累计配置ID: cfg.accumulateId } : {}),
            流量来源: a.traffic,
            累计周期:
              a.period || (cfg.duration != null ? cfg.duration + " 秒" : null),
            累计类型:
              a.type ||
              ["计数", "求和", "最近几次", "最大值", "最小值"][
                cfg.accumulateType
              ],
            按何累计: a.keys,
            累计值: a.value,
            是否剔除重复项: a.distinct,
            按何去重: a.distinctKey,
          }}
        />
        <Code label="满足何种条件累计" value={a.writeCondition} />
        <h4>读累计条件</h4>
        <Fields
          items={{
            读累计条件设置: a.readMode,
            ...(a.topTimes ? { 最近次数: a.topTimes } : {}),
            是否累计自身:
              a.includeMode ||
              (a.includeCurrent && a.includeByCondition
                ? Number(a.includeByCondition) === 1
                  ? "按照「读累计条件」累计"
                  : "按照「满足何种条件」累计"
                : undefined) ||
              ((a.includeCurrent ?? cfg.includeCurrent) == null
                ? null
                : (a.includeCurrent ?? cfg.includeCurrent)
                  ? "累计自身"
                  : "不累计自身"),
          }}
        />
        {a.readCondition && <Code label="读取条件" value={a.readCondition} />}
        {a.deleteCondition && (
          <Code label="删除条件" value={a.deleteCondition} />
        )}
      </>
    );
  } else if (type === 10)
    body = (
      <>
        <Descriptions
          column={1}
          items={[
            {
              key: "service",
              label: "模型服务",
              children: /^\d+$/.test(String(cfg.modelName)) ? (
                <a
                  href={
                    "https://arceus.sankuai.com/#/moduleName/detail?id=" +
                    encodeURIComponent(cfg.modelName)
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {cfg.modelName}
                </a>
              ) : (
                cfg.modelName || "—"
              ),
            },
          ]}
        />
        <Fields
          items={{
            模型ID: cfg.modelId,
            模型版本: cfg.modelVersion || f.modelVersion,
            超时时间: cfg.timeout == null ? null : cfg.timeout + " ms",
            必选入参: cfg.requiredParams,
            可选入参: cfg.optionalParams,
          }}
        />
        <Entries
          name="参数映射（入模参数 → Zeus 特征）"
          value={cfg.paramMappings}
        />
        <Entries name="模型元参数" value={cfg.metaParams} />
        <Code
          label="模型准入条件（Aviator 表达式）"
          value={cfg.accessCondition}
        />
      </>
    );
  else if (type === 3)
    body = (
      <>
        <Fields items={{ 扩展服务: cfg.extensionKey }} />
        <Entries name="查询配置" value={parse(cfg.config)} />
      </>
    );
  else if (type === 11)
    body = (
      <>
        <Fields
          items={{
            离线特征名: row.enName,
            关联参数: f.param_list || f.paramList,
          }}
        />
        {source && <Code label="查询配置" value={source} />}
      </>
    );
  else if (type === 12)
    body = (
      <>
        <Fields
          items={{
            工作流: cfg.name,
            应用ID: cfg.appId,
            租户ID: cfg.tenantId,
            超时时间: cfg.timeout == null ? null : cfg.timeout + " ms",
          }}
        />
        <Entries name="工作流入参" value={cfg.llmInputParams} />
        <Code label="调用条件" value={cfg.condition} />
      </>
    );
  else
    body = (
      <>
        <Fields items={{ 特征逻辑: "表达式" }} />
        <Code
          label={type === 0 ? "取值表达式" : "Aviator 表达式"}
          value={source}
        />
      </>
    );
  return (
    <div className="feature-logic">
      <Fields items={{ 结果类型: row.dataType }} />
      {body}
      {!!dependencyLinks.length && (
        <div>
          <h4>依赖特征</h4>
          <div className="feature-dependencies">{dependencyLinks}</div>
        </div>
      )}
    </div>
  );
}
