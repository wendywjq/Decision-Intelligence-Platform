export type Row = {
  id: number;
  name: string;
  enName?: string;
  owner?: string;
  status?: string;
  type?: string;
  updatedAt?: string;
  [key: string]: any;
};
export type Field = {
  key: string;
  label: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  kind?: "textarea" | "number" | "date" | "tags";
};
export type Module = {
  key: string;
  label: string;
  title: string;
  create?: string;
  tabs?: string[];
  filters: Field[];
  columns: [string, string][];
  fields: Field[];
  kind?: string;
};
const field = (
  key: string,
  label: string,
  options?: string[],
  placeholder?: string,
): Field => ({ key, label, options, placeholder });
const name = field("name", "名称");
const owner = field("owner", "负责人", undefined, "请输入misId");
const status = field("status", "状态", [
  "就绪",
  "生效",
  "未就绪",
  "标记",
  "灰度",
  "停用",
]);
const type = field("type", "计算类型", ["实时计算", "离线计算", "近线计算"]);
const tags = field("tags", "标签", [
  "风险识别",
  "通用策略",
  "内容审核",
  "场景分类",
]);
const rule = field("ruleId", "规则/规则组", undefined, "请选择规则");
const decision = field("decision", "决策", [
  "通过",
  "拒绝",
  "人工审核",
  "标记",
]);
const dates = field("updatedAt", "时间");
const standard: [string, string][] = [
  ["id", "ID"],
  ["name", "名称"],
  ["status", "状态"],
  ["owner", "负责人"],
  ["updatedAt", "最后修改"],
];
const baseFields = [
  { ...name, required: true },
  field("enName", "英文名称"),
  { ...owner, required: true },
  status,
  { key: "description", label: "备注", kind: "textarea" } as Field,
  tags,
];
function m(
  key: string,
  label: string,
  title: string,
  create: string | undefined,
  filters: Field[],
  columns: [string, string][] = standard,
  extra: Partial<Module> = {},
): Module {
  return {
    key,
    label,
    title,
    create,
    filters,
    columns,
    fields: baseFields,
    ...extra,
  };
}
export const modules: Module[] = [
  m(
    "scene",
    "场景",
    "场景配置列表",
    "新建场景",
    [
      field("q", "普通场景", undefined, "请输入场景ID或名称"),
      rule,
      decision,
      field("extra", "附加信息", ["无", "风险信息", "命中详情"]),
      status,
      field("owner", "最后修改人", undefined, "输入MISID"),
      field("reason", "决策理由"),
      field("params", "衍生参数"),
      tags,
      type,
      field("sample", "样本包"),
    ],
    [
      ["id", "场景ID"],
      ["name", "场景名称"],
      ["owner", "场景负责人"],
      ["type", "计算类型"],
    ],
    {
      tabs: ["普通场景", "路由场景"],
      kind: "scene",
      fields: [
        { ...name, required: true },
        { key: "description", label: "场景备注", kind: "textarea" },
        type,
        field("sceneType", "场景类型", ["普通场景", "路由场景"]),
        { ...owner, required: true },
        { ...tags, required: true },
      ],
    },
  ),
  m(
    "layerScene",
    "分层场景",
    "分层场景",
    "新建分层场景",
    [
      field("q", "分层场景", undefined, "请输入分层场景ID或名称"),
      rule,
      field("owner", "misId", undefined, "请输入Mis号"),
      dates,
    ],
    [
      ["id", "ID"],
      ["name", "场景名称"],
      ["description", "场景备注"],
      ["version", "版本"],
      ["owner", "负责人"],
      ["createdAt", "创建"],
      ["updatedAt", "最后修改"],
    ],
    { tabs: ["场景列表", "模版列表"], kind: "graph" },
  ),
  m(
    "rulePage",
    "规则",
    "规则列表",
    "添加规则",
    [
      field("q", "关键字", undefined, "搜索ID/英文名称"),
      status,
      dates,
      tags,
      field("expression", "规则表达式", undefined, "请输入规则表达式"),
      field("owner", "MISID", undefined, "请输入misId"),
      field("sample", "样本包"),
    ],
    [
      ["id", "规则ID"],
      ["name", "规则名称"],
      ["status", "状态"],
      ["tags", "标签"],
      ["referenceCount", "被引用次数"],
      ["decisionDistribution", "被引用决策分布"],
      ["createdAt", "创建"],
      ["updatedAt", "最后修改"],
    ],
    {
      kind: "rule",
      fields: [
        ...baseFields,
        {
          key: "expression",
          label: "规则表达式",
          kind: "textarea",
          required: true,
        },
      ],
    },
  ),
  m(
    "routerSceneList",
    "路由场景",
    "路由场景",
    "新建路由场景",
    [
      field("q", "场景", undefined, "请选择路由场景"),
      rule,
      field("owner", "MIS ID"),
    ],
    standard,
    { kind: "router" },
  ),
  m(
    "featureService",
    "特征服务",
    "特征服务",
    "新建特征",
    [
      field("q", "特征名称", undefined, "请输入特征ID或中英文名称"),
      field("type", "类型", [
        "参数",
        "离线因子",
        "决策表因子",
        "工具因子",
        "离线引擎-个体因子",
        "离线引擎-全局因子",
        "内存名单-CEP",
        "黑白模板因子",
        "基础因子",
        "衍生因子",
        "模型因子",
        "累计因子",
      ]),
      status,
      field("owner", "MISID"),
      tags,
    ],
    [
      ["id", "特征ID"],
      ["name", "名称"],
      ["type", "特征类型"],
      ["dataType", "结果类型"],
      ["status", "状态"],
      ["riskDomain", "风险域"],
      ["owner", "管理员"],
      ["createdAt", "创建"],
      ["updatedAt", "更新"],
      ["permission", "我的权限"],
      ["category", "特征分类"],
      ["subject", "特征主体"],
      ["business", "业务线"],
      ["tags", "特征标签"],
    ],
    {
      tabs: ["特征集市", "公共特征", "我管理的特征"],
      kind: "feature",
      fields: [
        ...baseFields,
        field("type", "特征类型", [
          "参数",
          "离线因子",
          "决策表因子",
          "工具因子",
          "离线引擎-个体因子",
          "离线引擎-全局因子",
          "内存名单-CEP",
          "黑白模板因子",
          "基础因子",
          "衍生因子",
          "模型因子",
          "累计因子",
        ]),
        field("dataType", "数据类型", [
          "Double",
          "String",
          "Long",
          "Boolean",
          "List",
        ]),
        field("defaultValue", "默认值"),
        field("expression", "计算表达式"),
      ],
    },
  ),
  m(
    "decisionList",
    "决策",
    "决策",
    "新建决策",
    [
      field("q", "决策", undefined, "输入决策ID、名称"),
      field("owner", "修改人", undefined, "输入MISID"),
      field("type", "类型", ["终止型", "非终止型"]),
      dates,
      field("extra", "附加信息"),
      tags,
    ],
    [
      ["id", "决策ID"],
      ["name", "决策名称"],
      ["type", "决策类型"],
      ["priority", "决策优先级"],
      ["extra", "附加信息"],
      ["references", "应用场景数"],
      ["updatedAt", "修改时间"],
    ],
    {
      tabs: ["决策", "决策理由"],
      fields: [
        ...baseFields,
        field("type", "决策类型", ["终止型", "非终止型"]),
        { key: "priority", label: "决策优先级", kind: "number" },
        field("extra", "附加信息"),
      ],
    },
  ),
  m(
    "paint",
    "画布",
    "画布",
    "新建画布",
    [field("q", "画布", undefined, "请输入画布ID或名称"), status, owner, dates],
    standard,
    { kind: "graph", tabs: ["画布列表", "模版列表"] },
  ),
  m(
    "custom",
    "自定义组件",
    "自定义组件",
    "添加组件",
    [
      field("q", "组件名称", undefined, "请输入组件ID或中英文名称"),
      field("owner", "MISID", undefined, "请输入姓名/Mis号"),
      status,
      field("directory", "所在目录", ["自定义组件", "系统组件"]),
      field("type", "类型", ["组件模版", "逻辑子图"]),
      tags,
    ],
    [
      ["id", "组件ID"],
      ["name", "组件名称"],
      ["type", "类型"],
      ["directory", "所在目录"],
      ["version", "版本"],
      ["status", "状态"],
      ["references", "被引用次数"],
      ["createdAt", "创建"],
      ["updatedAt", "最后修改"],
    ],
    { kind: "graph" },
  ),
  m(
    "rulesGroup",
    "规则组",
    "规则组",
    "新建规则组",
    [
      field("q", "规则组"),
      rule,
      decision,
      field("owner", "MIS ID", undefined, "搜索MIS ID"),
      tags,
    ],
    [
      ["id", "规则组ID"],
      ["name", "规则组名称"],
      ["owner", "负责人"],
      ["updatedAt", "最后修改"],
    ],
    { kind: "scene" },
  ),
  m(
    "tag",
    "标签",
    "标签",
    "添加标签",
    [
      field("q", "标签ID/名称", undefined, "请选择标签ID/名称"),
      field("type", "标签类型", [
        "规则类型",
        "规则分类",
        "场景分类",
        "风险标签",
      ]),
      field("status", "关联策略状态", ["生效", "标记", "灰度"]),
      field("flowType", "关联策略流量类型"),
      field("source", "关联策略流量来源场景"),
    ],
    [
      ["id", "标签ID"],
      ["name", "标签名称"],
      ["type", "标签类型"],
      ["description", "标签说明"],
      ["updatedAt", "最后修改"],
    ],
    {
      tabs: ["管理标签", "风险标签", "生态事实标签"],
      fields: [
        { ...name, required: true },
        field("type", "标签类型", [
          "规则类型",
          "规则分类",
          "场景分类",
          "风险标签",
        ]),
        field("parent", "父级标签"),
        { key: "description", label: "标签说明", kind: "textarea" },
      ],
    },
  ),
  m("strategyCheckLog", "策略排查", "策略排查", undefined, [], standard, {
    kind: "investigate",
  }),
  m(
    "analysis",
    "聚合分析",
    "聚合分析",
    "新建图表",
    [
      field("q", "图表名称", undefined, "请输入看板名称"),
      field("type", "图表类型", ["表", "折线图", "柱状图", "饼图"]),
      field("owner", "更新人"),
      dates,
      field("dataset", "数据集"),
    ],
    [
      ["id", "ID"],
      ["name", "图表名称"],
      ["type", "图表类型"],
      ["dataset", "数据集"],
      ["updatedAt", "更新"],
    ],
    { tabs: ["图表", "看板"], kind: "analysis" },
  ),
  m("cumulativeQuery", "累计查询", "累计查询", undefined, [], standard, {
    kind: "cumulative",
  }),
  m("checkpage", "排查探针", "排查探针", undefined, [], standard, {
    kind: "probe",
  }),
  m(
    "exceptionUploadList",
    "监控告警",
    "监控告警",
    "新增告警配置",
    [
      field("q", "配置ID/名称"),
      field("taskType", "作用任务类型", ["场景", "画布", "规则"]),
      field("taskId", "作用任务ID"),
      field("type", "监控类型", ["异常量", "命中率", "耗时"]),
      field("owner", "最后修改人"),
    ],
    [
      ["id", "配置ID"],
      ["name", "配置名称"],
      ["type", "监控类型"],
      ["taskType", "作用任务类型"],
      ["taskId", "作用任务"],
      ["createdAt", "创建"],
      ["updatedAt", "最后修改"],
    ],
    { tabs: ["告警配置", "告警治理"] },
  ),
  m(
    "businessGroupMappings",
    "业务方管理",
    "业务方管理",
    undefined,
    [field("q", "业务", undefined, "请输入业务ID、名称")],
    [
      ["id", "业务ID"],
      ["name", "业务名称"],
      ["children", "子业务"],
      ["owner", "空间负责人"],
      ["groupKey", "业务群(groupKey)"],
      ["updatedAt", "修改时间"],
    ],
  ),
  m(
    "userPriv",
    "权限管理",
    "权限",
    "添加用户权限",
    [],
    [
      ["id", "ID"],
      ["owner", "MISID"],
      ["name", "用户名称"],
      ["role", "角色"],
      ["scope", "权限范围"],
      ["updatedAt", "最后修改"],
    ],
    {
      fields: [
        { ...owner, required: true },
        name,
        field("role", "角色", ["管理员", "开发者", "只读用户"]),
        field("scope", "权限范围", ["全部", "场景", "规则", "特征"]),
      ],
    },
  ),
  m(
    "quietPeriod",
    "静默期管理",
    "静默期（当前业务：内容安全）",
    undefined,
    [],
    [
      ["id", "ID"],
      ["name", "静默期名称"],
      ["startTime", "开始时间"],
      ["endTime", "结束时间"],
      ["status", "状态"],
      ["owner", "负责人"],
    ],
  ),
  m(
    "logPage",
    "操作日志查询",
    "操作日志查询",
    undefined,
    [
      field("q", "场景ID/名称"),
      field("action", "操作行为", [
        "新建",
        "修改",
        "删除",
        "复制",
        "测试",
        "发布",
      ]),
      dates,
      field("owner", "操作人"),
      field("type", "场景类型", ["普通场景", "分层场景"]),
    ],
    [
      ["entityId", "场景ID"],
      ["name", "场景名称"],
      ["module", "场景类型"],
      ["action", "操作行为"],
      ["updatedAt", "操作时间"],
    ],
    { tabs: ["场景", "规则", "规则组", "因子", "参数"], kind: "audit" },
  ),
  m(
    "monitorAlertList",
    "监控告警",
    "监控告警",
    "新建配置",
    [
      field("q", "监控ID/名称"),
      field("level", "告警级别", ["P0", "P1", "P2", "P3"]),
      status,
      owner,
      field("editor", "最后修改人"),
      dates,
    ],
    [
      ["id", "监控ID"],
      ["name", "监控名称"],
      ["level", "告警级别"],
      ["status", "状态"],
      ["owner", "负责人"],
      ["updatedAt", "最后修改"],
    ],
    { tabs: ["监控配置", "监控记录"] },
  ),
  m(
    "rulesFuseList",
    "规则熔断",
    "规则熔断",
    "新建熔断",
    [
      field("q", "熔断ID/名称"),
      field("type", "熔断模式", [
        "单点熔断",
        "分层场景熔断",
        "画布熔断",
        "任务熔断",
        "单点熔断（实时）",
        "分层熔断",
        "全局熔断",
      ]),
      field("ruleId", "作用规则"),
      decision,
      field("status", "状态", ["启用", "停用", "生效", "离线"]),
      field("owner", "最后修改人"),
      dates,
    ],
    [
      ["id", "熔断ID"],
      ["name", "熔断名称"],
      ["type", "熔断模式"],
      ["sceneId", "一级范围"],
      ["ruleId", "二级范围"],
      ["decision", "三级范围"],
      ["status", "状态"],
      ["action", "执行动作"],
      ["updatedAt", "最后修改"],
    ],
    {
      tabs: ["熔断配置", "熔断记录"],
      fields: [
        ...baseFields,
        field("type", "熔断模式", [
          "单点熔断",
          "分层场景熔断",
          "画布熔断",
          "任务熔断",
          "单点熔断（实时）",
          "分层熔断",
          "全局熔断",
        ]),
        field("sceneId", "作用场景"),
        field("ruleId", "作用规则"),
        decision,
        field("action", "执行动作", ["人工熔断", "自动熔断", "仅告警"]),
        { key: "threshold", label: "阈值", kind: "number" },
      ],
    },
  ),
  m(
    "fetcher",
    "数据接口",
    "数据接口列表",
    "数据接口注册",
    [
      field("appKey", "AppKey"),
      field("q", "名称", undefined, "请输入接口名、负责人"),
    ],
    [
      ["name", "数据接口"],
      ["status", "状态"],
      ["appKey", "AppKey"],
      ["updatedAt", "最后修改"],
    ],
    {
      fields: [
        ...baseFields,
        field("appKey", "AppKey"),
        field("url", "接口地址"),
        field("method", "请求方法", ["GET", "POST"]),
        field("timeout", "超时（ms）"),
      ],
    },
  ),
  m(
    "fetcherApp",
    "数据服务",
    "数据服务列表",
    "数据服务注册",
    [field("q", "Appkey", undefined, "请输入AppKey或负责人")],
    [
      ["id", "ID"],
      ["appKey", "AppKey"],
      ["name", "服务名称"],
      ["owner", "负责人"],
      ["updatedAt", "最后修改"],
    ],
    { fields: [...baseFields, field("appKey", "AppKey")] },
  ),
  m(
    "dataSourceList",
    "数据管理",
    "数据管理",
    "新建数据源",
    [name, field("type", "数据源类型", ["名单", "样本包", "字典"]), owner],
    [
      ["id", "ID"],
      ["name", "数据名称"],
      ["type", "类型"],
      ["count", "数据量"],
      ["owner", "负责人"],
      ["updatedAt", "最后修改"],
    ],
    { tabs: ["名单管理", "样本包", "字典管理"] },
  ),
  m(
    "accumulateEvent",
    "累计事件",
    "累计事件",
    "添加累计事件",
    [],
    [
      ["id", "事件ID"],
      ["name", "事件名称"],
      ["enName", "英文名称"],
      ["description", "事件说明"],
      ["updatedAt", "最后修改"],
    ],
  ),
  m("logConfig", "日志配置", "日志配置", undefined, [], standard, {
    tabs: ["实时日志接入", "离线日志接入", "回溯日志接入", "近线日志接入"],
    kind: "logConfig",
  }),
  m("relationSearch", "依赖统计", "依赖关系查询", undefined, [], standard, {
    kind: "relation",
  }),
  m(
    "expressionDebugger",
    "表达式调试",
    "表达式调试工具",
    undefined,
    [],
    standard,
    { kind: "expression" },
  ),
  m("ruleHealth", "规则健康度", "规则健康度", undefined, [], standard, {
    tabs: ["我的规则", "业务空间下规则", "处理历史"],
    kind: "health",
  }),
  m("lineage", "近线血缘检索", "血缘检索", undefined, [], standard, {
    tabs: ["通用检索", "Topic 生产/消费链路检索"],
    kind: "lineage",
  }),
  m(
    "release/list",
    "变更管理",
    "变更管理",
    "新建变更任务",
    [
      field("q", "变更任务"),
      field("type", "变更模式", ["普通变更", "紧急变更"]),
      status,
      dates,
      field("owner", "MISID"),
    ],
    [
      ["name", "变更名称"],
      ["progress", "变更进度"],
      ["createdAt", "开始/结束时间"],
      ["stopTime", "中止/回滚时间"],
    ],
    {
      kind: "release",
      fields: [
        { ...name, required: true },
        field("type", "变更模式", ["普通变更", "紧急变更"]),
        { key: "description", label: "变更说明", kind: "textarea" },
        owner,
      ],
    },
  ),
];
export const groups = [
  {
    name: "策略部署",
    icon: "deploy",
    keys: [
      "scene",
      "layerScene",
      "rulePage",
      "routerSceneList",
      "featureService",
      "decisionList",
      "paint",
      "custom",
    ],
  },
  { name: "策略管理", icon: "manage", keys: ["rulesGroup", "tag"] },
  {
    name: "风险还原",
    icon: "risk",
    keys: [
      "strategyCheckLog",
      "analysis",
      "cumulativeQuery",
      "checkpage",
      "exceptionUploadList",
    ],
  },
  {
    name: "权限管理",
    icon: "permission",
    keys: ["businessGroupMappings", "userPriv"],
  },
  { name: "安全管理", icon: "safe", keys: ["quietPeriod", "logPage"] },
  {
    name: "监控中心",
    icon: "monitor",
    keys: ["monitorAlertList", "rulesFuseList"],
  },
  {
    name: "配置中心",
    icon: "setting",
    keys: [
      "fetcher",
      "fetcherApp",
      "dataSourceList",
      "accumulateEvent",
      "logConfig",
    ],
  },
  {
    name: "Plus+工具中心",
    icon: "tool",
    keys: ["relationSearch", "expressionDebugger", "ruleHealth", "lineage"],
  },
  { name: "策略变更", icon: "change", keys: ["release/list"] },
];
export const moduleMap = Object.fromEntries(modules.map((m) => [m.key, m]));
