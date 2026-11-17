import Database from "better-sqlite3";
import { initializeSourceSchema, syncSourceFixture } from "./source-import.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { modules, type Row } from "../src/catalog.ts";
export function openDatabase(
  path = process.env.DATABASE_PATH || "data/zeus.sqlite",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS entities(module TEXT NOT NULL,id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(module,id));
 CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY AUTOINCREMENT,module TEXT,entity_id INTEGER,data TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,module TEXT,entity_id INTEGER,name TEXT,action TEXT,owner TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS scene_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,scene_module TEXT NOT NULL DEFAULT 'scene',scene_id INTEGER NOT NULL,rule_id INTEGER NOT NULL,status TEXT DEFAULT '生效',decision TEXT DEFAULT '人工审核',priority INTEGER DEFAULT 1,UNIQUE(scene_module,scene_id,rule_id));
 CREATE TABLE IF NOT EXISTS test_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,rule_id INTEGER,input TEXT,expected INTEGER,actual INTEGER,passed INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS request_logs(id INTEGER PRIMARY KEY,request_id TEXT UNIQUE,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cumulative_values(factor TEXT,subject_key TEXT,value REAL,window TEXT,PRIMARY KEY(factor,subject_key));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  const insert = db.prepare(
    "INSERT INTO entities(module,id,data) VALUES (?,?,?)",
  );
  const now = "2026-11-17 10:00:00";
  const samples: Record<string, Partial<Row>[]> = {
    scene: [
      {
        id: 10001,
        name: "内容安全审核示例场景",
        owner: "demo",
        type: "实时计算",
      },
      { id: 10002, name: "图文内容识别示例", owner: "demo", type: "实时计算" },
      {
        id: 10003,
        name: "评价在线回扫示例场景",
        owner: "demo",
        type: "离线计算",
      },
    ],
    rulePage: [
      {
        id: 20001,
        name: "文本风险分数识别",
        enName: "text_risk_score_check",
        expression: "riskScore > 0.9",
        field: "riskScore",
        operator: ">",
        threshold: 0.9,
      },
      {
        id: 20002,
        name: "高频请求识别",
        enName: "high_frequency_check",
        expression: "requestCount >= 100",
        field: "requestCount",
        operator: ">=",
        threshold: 100,
      },
      {
        id: 20003,
        name: "用户状态识别",
        enName: "user_status_check",
        expression: 'userStatus == "blocked"',
        field: "userStatus",
        operator: "==",
        threshold: "blocked",
      },
    ],
    layerScene: [
      {
        id: 30001,
        name: "多模态内容审核示例",
        version: "v1",
        type: "实时计算",
      },
    ],
    routerSceneList: [
      { id: 40001, name: "内容类型路由示例", type: "路由场景" },
    ],
    featureService: [
      {
        id: 50001,
        name: "内容风险分数",
        enName: "riskScore",
        type: "模型因子",
        dataType: "Double",
        defaultValue: "0",
      },
      {
        id: 50002,
        name: "请求次数",
        enName: "requestCount",
        type: "累计因子",
        dataType: "Long",
      },
      {
        id: 50003,
        name: "用户状态",
        enName: "userStatus",
        type: "参数",
        dataType: "String",
      },
    ],
    decisionList: [
      { id: 101, name: "通过", type: "非终止型", priority: 9999 },
      { id: 102, name: "人工审核", type: "终止型", priority: 10 },
      { id: 103, name: "拒绝", type: "终止型", priority: 1 },
    ],
    paint: [{ id: 60001, name: "实时风控决策画布", version: "v1" }],
    custom: [
      {
        id: 70001,
        name: "JSON 数据提取示例",
        enName: "json_extract_example",
        type: "组件模版",
        version: "v1",
        directory: "自定义组件",
      },
    ],
    rulesGroup: [{ id: 80001, name: "通用内容风险识别规则组" }],
    tag: [
      { id: 901, name: "风险识别", type: "规则分类" },
      { id: 902, name: "通用策略", type: "规则类型" },
      { id: 903, name: "内容审核", type: "场景分类" },
    ],
    businessGroupMappings: [
      {
        id: 35,
        name: "内容安全",
        groupKey: "demo.content.safety",
        owner: "demo",
      },
    ],
    userPriv: [
      {
        id: 1,
        name: "示例管理员",
        owner: "demo",
        role: "管理员",
        scope: "全部",
      },
    ],
    quietPeriod: [
      {
        id: 1,
        name: "示例维护窗口",
        startTime: "2026-11-20 00:00:00",
        endTime: "2026-11-20 06:00:00",
        status: "未开始",
      },
    ],
    rulesFuseList: [
      {
        id: 11001,
        name: "通用命中率熔断示例",
        type: "单点熔断（实时）",
        sceneId: 10001,
        ruleId: 20001,
        decision: "人工审核",
        action: "仅告警",
        threshold: 95,
      },
    ],
    monitorAlertList: [
      { id: 12001, name: "场景命中率监控示例", level: "P2", status: "生效" },
    ],
    exceptionUploadList: [
      {
        id: 13001,
        name: "规则执行异常告警示例",
        taskType: "场景",
        taskId: 10001,
        type: "异常量",
      },
    ],
    fetcher: [
      {
        id: 14001,
        name: "示例用户信息接口",
        appKey: "demo.user.service",
        url: "/example/user",
        method: "GET",
        timeout: 300,
      },
    ],
    fetcherApp: [
      { id: 15001, name: "示例特征数据服务", appKey: "demo.feature.service" },
    ],
    dataSourceList: [
      { id: 16001, name: "示例审核样本包", type: "样本包", count: 3 },
    ],
    accumulateEvent: [
      { id: 17001, name: "请求累计事件", enName: "request_event" },
    ],
    analysis: [
      {
        id: 18001,
        name: "示例规则命中趋势",
        type: "折线图",
        dataset: "示例决策日志",
      },
    ],
    "release/list": [
      {
        id: 19001,
        name: "内容审核示例策略变更",
        type: "普通变更",
        phase: "实验",
        progress: 0,
        status: "待启动",
      },
      {
        id: 19002,
        name: "示例已完成变更",
        type: "普通变更",
        phase: "完成",
        progress: 100,
        status: "已完成",
      },
    ],
  };
  if (!db.prepare("SELECT 1 FROM settings WHERE key=?").get("seeded"))
    db.transaction(() => {
      for (const m of modules)
        for (const [i, s] of (samples[m.key] || []).entries()) {
          const data = {
            owner: "demo",
            status: "生效",
            type: "实时计算",
            description: "用于演示的示例数据",
            tags: ["通用策略"],
            version: "v1",
            references: 1,
            priority: 1,
            createdAt: now,
            updatedAt: now,
            ...s,
          };
          insert.run(m.key, s.id || i + 1, JSON.stringify(data));
        }
      for (const [module, id] of [
        ["scene", 10001],
        ["scene", 10002],
        ["scene", 10003],
        ["rulesGroup", 80001],
      ] as const)
        db.prepare(
          "INSERT OR IGNORE INTO scene_rules(scene_module,scene_id,rule_id) VALUES(?,?,?)",
        ).run(module, id, 20001);
      db.prepare("INSERT INTO settings VALUES (?,?)").run("seeded", "true");
    })();
  if (
    !db.prepare("SELECT 1 FROM settings WHERE key=?").get("sample_logs_seeded")
  )
    db.transaction(() => {
      const requests = [
        {
          id: 1,
          requestId: "demo-request-001",
          scene: "内容安全审核示例场景",
          sceneId: 10001,
          ruleId: 20001,
          decision: "人工审核",
          input: { riskScore: 0.95 },
          time: "2026-11-17 10:00:00",
        },
        {
          id: 2,
          requestId: "demo-request-002",
          scene: "内容安全审核示例场景",
          sceneId: 10001,
          ruleId: 20001,
          decision: "通过",
          input: { riskScore: 0.3 },
          time: "2026-11-17 10:01:00",
        },
      ];
      for (const r of requests)
        db.prepare("INSERT OR IGNORE INTO request_logs VALUES(?,?,?)").run(
          r.id,
          r.requestId,
          JSON.stringify(r),
        );
      db.prepare("INSERT OR IGNORE INTO cumulative_values VALUES(?,?,?,?)").run(
        "requestCount",
        "demo",
        120,
        "示例5分钟窗口",
      );
      db.prepare("INSERT INTO settings VALUES(?,?)").run(
        "sample_logs_seeded",
        "true",
      );
    })();
  initializeSourceSchema(db);
  if (path === (process.env.DATABASE_PATH || "data/zeus.sqlite"))
    syncSourceFixture(db);
  return db;
}
