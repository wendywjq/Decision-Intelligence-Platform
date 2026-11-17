import express from "express";
import type Database from "better-sqlite3";
import { moduleMap } from "../src/catalog.ts";
import { z } from "zod";
const bodySchema = z
  .object({ name: z.string().trim().min(1).max(200) })
  .passthrough();
export function createApp(db: Database.Database) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const get = (module: string, id: number) => {
    const r = db
      .prepare("SELECT data FROM entities WHERE module=? AND id=?")
      .get(module, id) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  };
  const audit = (m: string, id: number, name: string, action: string) =>
    db
      .prepare(
        "INSERT INTO audit(module,entity_id,name,action,owner) VALUES(?,?,?,?,?)",
      )
      .run(m, id, name, action, "demo");
  const save = (m: string, id: number, data: any, action: string) =>
    db.transaction(() => {
      const old = get(m, id);
      if (old)
        db.prepare(
          "INSERT INTO versions(module,entity_id,data) VALUES(?,?,?)",
        ).run(m, id, JSON.stringify(old));
      const next = {
        ...old,
        ...data,
        id,
        updatedAt: new Date().toISOString(),
        createdAt: old?.createdAt || new Date().toISOString(),
      };
      db.prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)").run(
        m,
        id,
        JSON.stringify(next),
      );
      audit(m, id, next.name, action);
      return next;
    })();
  app.get("/api/references/rule/:id", (req, res) =>
    res.json({
      items: (
        db
          .prepare("SELECT * FROM scene_rules WHERE rule_id=?")
          .all(Number(req.params.id)) as any[]
      ).map((r) => ({
        ...r,
        name: get(r.scene_module, r.scene_id)?.name || "—",
      })),
    }),
  );
  app.get("/api/relations", (req, res) => {
    const id = Number(req.query.id);
    res.json({
      items: (
        db
          .prepare("SELECT * FROM scene_rules WHERE scene_id=? OR rule_id=?")
          .all(id, id) as any[]
      ).map((r) => ({
        ...r,
        name: get(r.scene_module, r.scene_id)?.name || "—",
      })),
    });
  });
  const requestRows = () =>
    (
      db.prepare("SELECT data FROM request_logs").all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  app.get("/api/requests", (req, res) => {
    const q = String(req.query.q || "");
    res.json({
      items: requestRows().filter((r) => JSON.stringify(r).includes(q)),
    });
  });
  app.post("/api/probe", (req, res) => {
    const r = requestRows().find((r) => r.requestId === req.body.requestId);
    if (!r)
      return res
        .status(404)
        .json({ error: "本地没有该RequestId，可使用 demo-request-001" });
    if (
      Number(req.body.sceneId) !== r.sceneId ||
      Number(req.body.ruleId) !== r.ruleId
    )
      return res.status(404).json({ error: "请求与场景或规则不匹配" });
    const rule = get("rulePage", r.ruleId);
    if (!rule) return res.status(404).json({ error: "示例规则已删除" });
    res.json({
      summary: "基于本地示例请求重新计算",
      requestId: r.requestId,
      expression: rule.expression,
      input: r.input,
      hit: evaluateExpression(rule.expression, r.input),
    });
  });
  app.get("/api/cumulative", (req, res) => {
    if (req.query.factor !== "requestCount")
      return res.status(404).json({ error: "累计因子不存在" });
    const key = String(req.query.key || "demo");
    const row = db
      .prepare(
        "SELECT factor,subject_key AS key,value,window FROM cumulative_values WHERE factor=? AND subject_key=?",
      )
      .get("requestCount", key);
    if (!row)
      return res
        .status(404)
        .json({ error: "未找到该主体的累计值，示例主体为 demo" });
    res.json(row);
  });
  app.get("/api/health", (_, res) =>
    res.json({ ok: true, database: "sqlite" }),
  );
  app.get("/api/audit", (_, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT id,module,entity_id AS entityId,name,action,owner,updated_at AS updatedAt FROM audit ORDER BY id DESC LIMIT 500",
        )
        .all(),
    }),
  );
  app.get("/api/entities/:module", (req, res) => {
    const m = req.params.module;
    if (!moduleMap[m]) return res.status(404).json({ error: "模块不存在" });
    let rows = (
      db
        .prepare("SELECT data FROM entities WHERE module=? ORDER BY id DESC")
        .all(m) as { data: string }[]
    ).map((x) => JSON.parse(x.data));
    for (const [k, v] of Object.entries(req.query)) {
      if (!v || ["page", "pageSize"].includes(k)) continue;
      if (
        ["scene", "rulesGroup"].includes(m) &&
        ["ruleId", "decision", "status"].includes(k)
      ) {
        rows = rows.filter((r) => {
          const bindings = db
            .prepare(
              "SELECT * FROM scene_rules WHERE scene_module=? AND scene_id=?",
            )
            .all(m, r.id) as any[];
          return bindings.some((b) =>
            k === "ruleId"
              ? `${b.rule_id} ${get("rulePage", b.rule_id)?.name || ""}`.includes(
                  String(v),
                )
              : String(b[k] || "").includes(String(v)),
          );
        });
        continue;
      }
      rows = rows.filter((r) =>
        k === "q"
          ? `${r.id} ${r.name} ${r.enName || ""}`
              .toLowerCase()
              .includes(String(v).toLowerCase())
          : String(
              k === "view"
                ? r.view || moduleMap[m].tabs?.[0] || ""
                : r[k] || "",
            )
              .toLowerCase()
              .includes(String(v).toLowerCase()),
      );
    }
    const total = rows.length;
    const size = Math.max(1, Math.min(100, Number(req.query.pageSize) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({
      items: rows.slice((page - 1) * size, page * size),
      total,
      page,
      pageSize: size,
    });
  });
  app.get("/api/entities/:module/:id", (req, res) => {
    const row = get(req.params.module, Number(req.params.id));
    return row ? res.json(row) : res.status(404).json({ error: "记录不存在" });
  });
  app.post("/api/entities/:module", (req, res) => {
    const m = req.params.module;
    if (!moduleMap[m]) return res.status(404).json({ error: "模块不存在" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "名称不能为空，且不能超过200个字符" });
    const id = Number(
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(id),10000)+1 AS id FROM entities WHERE module=?",
          )
          .get(m) as any
      ).id,
    );
    return res.status(201).json(
      save(
        m,
        id,
        {
          status: "生效",
          owner: "demo",
          type: "实时计算",
          version: "v1",
          ...parsed.data,
        },
        "新建",
      ),
    );
  });
  app.put("/api/entities/:module/:id", (req, res) => {
    const m = req.params.module,
      id = Number(req.params.id);
    if (!get(m, id)) return res.status(404).json({ error: "记录不存在" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "请输入有效名称" });
    return res.json(save(m, id, parsed.data, "修改"));
  });
  app.delete("/api/entities/:module/:id", (req, res) => {
    const m = req.params.module,
      id = Number(req.params.id),
      old = get(m, id);
    if (!old) return res.status(404).json({ error: "记录不存在" });
    db.transaction(() => {
      db.prepare("DELETE FROM entities WHERE module=? AND id=?").run(m, id);
      if (m === "rulePage")
        db.prepare("DELETE FROM scene_rules WHERE rule_id=?").run(id);
      else
        db.prepare(
          "DELETE FROM scene_rules WHERE scene_module=? AND scene_id=?",
        ).run(m, id);
      audit(m, id, old.name, "删除");
    })();
    return res.json({ ok: true });
  });
  app.post("/api/entities/:module/:id/copy", (req, res) => {
    const m = req.params.module,
      old = get(m, Number(req.params.id));
    if (!old) return res.status(404).json({ error: "记录不存在" });
    const id = Number(
      (
        db
          .prepare("SELECT MAX(id)+1 AS id FROM entities WHERE module=?")
          .get(m) as any
      ).id,
    );
    return res.status(201).json(
      save(
        m,
        id,
        {
          ...old,
          name: `${old.name}_copy`,
          enName: old.enName ? `${old.enName}_copy` : undefined,
        },
        "复制",
      ),
    );
  });
  app.get("/api/entities/:module/:id/versions", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT id,data,created_at AS createdAt FROM versions WHERE module=? AND entity_id=? ORDER BY id DESC",
        )
        .all(req.params.module, Number(req.params.id))
        .map((r: any) => ({ ...r, data: JSON.parse(r.data) })),
    }),
  );
  app.post("/api/entities/:module/:id/restore/:version", (req, res) => {
    const v = db
      .prepare(
        "SELECT data FROM versions WHERE id=? AND module=? AND entity_id=?",
      )
      .get(
        Number(req.params.version),
        req.params.module,
        Number(req.params.id),
      ) as any;
    if (!v || !get(req.params.module, Number(req.params.id)))
      return res.status(404).json({ error: "版本不存在" });
    res.json(
      save(
        req.params.module,
        Number(req.params.id),
        JSON.parse(v.data),
        "恢复版本",
      ),
    );
  });
  app.get("/api/scenes/:module/:id/rules", (req, res) => {
    const rows = db
      .prepare(
        "SELECT * FROM scene_rules WHERE scene_module=? AND scene_id=? ORDER BY priority,id",
      )
      .all(req.params.module, Number(req.params.id)) as any[];
    res.json({
      items: rows.map((r) => ({ ...r, rule: get("rulePage", r.rule_id) })),
    });
  });
  app.post("/api/scenes/:module/:id/rules", (req, res) => {
    const ruleId = Number(req.body.ruleId);
    if (
      !get(req.params.module, Number(req.params.id)) ||
      !get("rulePage", ruleId)
    )
      return res.status(404).json({ error: "场景或规则不存在" });
    try {
      const info = db
        .prepare(
          "INSERT INTO scene_rules(scene_module,scene_id,rule_id,status,decision,priority) VALUES(?,?,?,?,?,?)",
        )
        .run(
          req.params.module,
          Number(req.params.id),
          ruleId,
          req.body.status || "生效",
          req.body.decision || "人工审核",
          Number(req.body.priority) || 1,
        );
      audit(req.params.module, Number(req.params.id), "添加规则", "修改");
      res.status(201).json({ id: info.lastInsertRowid });
    } catch {
      res.status(409).json({ error: "规则已经添加到该场景" });
    }
  });
  app.put("/api/scene-rules/:id", (req, res) => {
    const result = db
      .prepare(
        "UPDATE scene_rules SET status=?,decision=?,priority=? WHERE id=?",
      )
      .run(
        req.body.status || "生效",
        req.body.decision || "人工审核",
        Number(req.body.priority) || 1,
        Number(req.params.id),
      );
    res.status(result.changes ? 200 : 404).json({ ok: !!result.changes });
  });
  app.delete("/api/scene-rules/:id", (req, res) => {
    db.prepare("DELETE FROM scene_rules WHERE id=?").run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/rules/:id/tests", (req, res) =>
    res.json({
      items: db
        .prepare("SELECT * FROM test_runs WHERE rule_id=? ORDER BY id DESC")
        .all(Number(req.params.id)),
    }),
  );
  app.post("/api/rules/:id/test", (req, res) => {
    const rule = get("rulePage", Number(req.params.id));
    if (!rule) return res.status(404).json({ error: "规则不存在" });
    try {
      const input =
        typeof req.body.input === "string"
          ? JSON.parse(req.body.input)
          : req.body.input;
      if (!input || typeof input !== "object") throw Error("请输入JSON对象");
      const result = evaluateExpression(rule.expression, input);
      const expected =
        req.body.expected === undefined ? true : Boolean(req.body.expected);
      const info = db
        .prepare(
          "INSERT INTO test_runs(rule_id,input,expected,actual,passed) VALUES(?,?,?,?,?)",
        )
        .run(
          rule.id,
          JSON.stringify(input),
          Number(expected),
          Number(result),
          Number(result === expected),
        );
      audit("rulePage", rule.id, rule.name, "测试");
      return res.json({
        id: info.lastInsertRowid,
        actual: result,
        expected,
        passed: result === expected,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/evaluate", (req, res) => {
    try {
      return res.json({
        result: evaluateExpression(
          req.body.expression,
          typeof req.body.input === "string"
            ? JSON.parse(req.body.input)
            : req.body.input,
        ),
      });
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  });
  app.get("/api/settings/:key", (req, res) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(req.params.key) as any;
    res.json(row ? JSON.parse(row.value) : {});
  });
  app.put("/api/settings/:key", (req, res) => {
    db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
      req.params.key,
      JSON.stringify(req.body),
    );
    res.json({ ok: true });
  });
  app.post("/api/releases/:id/advance", (req, res) => {
    const row = get("release/list", Number(req.params.id));
    if (!row) return res.status(404).json({ error: "任务不存在" });
    const phases = ["实验", "审批", "灰度", "完成"];
    const action = req.body.action;
    let next = { ...row };
    if (action === "中止" || action === "回滚") {
      next.status = "已" + action;
      next.stopTime = new Date().toISOString();
    } else if (action === "实验") {
      if (row.phase !== "实验")
        return res.status(409).json({ error: "任务尚未进入实验阶段" });
      next.experiment = req.body.experiment || "双跑";
      next.ratio = req.body.ratio || 10;
      next.phase = "审批";
      next.status = "待审批";
    } else if (action === "审批") {
      if (row.phase !== "审批")
        return res.status(409).json({ error: "任务尚未进入审批阶段" });
      next.phase = "灰度";
      next.status = "待启动";
    } else if (action === "下一步") {
      if (row.phase !== "灰度")
        return res.status(409).json({ error: "任务尚未进入灰度阶段" });
      next.progress = Math.min(100, (row.progress || 0) + 25);
      next.status = next.progress === 100 ? "已完成" : "灰度中";
      if (next.progress === 100) next.phase = phases[3];
    } else return res.status(400).json({ error: "未知操作" });
    return res.json(save("release/list", row.id, next, action));
  });
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(500).json({ error: err.message || "服务异常" }),
  );
  return app;
}
// Deliberately restricted grammar: never execute arbitrary user code.
export function evaluateExpression(
  expression: string,
  input: Record<string, unknown>,
): boolean {
  if (typeof expression !== "string") throw Error("表达式不能为空");
  if (expression.includes("||"))
    return expression
      .split(/\s*\|\|\s*/)
      .map((part) => evaluateExpression(part, input))
      .some(Boolean);
  const atoms = expression.split(/\s*(&&|\|\|)\s*/);
  let result: boolean | undefined;
  let join = "&&";
  for (const atom of atoms) {
    if (atom === "&&" || atom === "||") {
      join = atom;
      continue;
    }
    const match = atom
      .trim()
      .match(
        /^([A-Za-z_]\w*)\s*(>=|<=|==|!=|>|<)\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)$/,
      );
    if (!match)
      throw Error(
        "示例引擎支持：变量 比较符 常量，以及 && / ||；不支持完整 Aviator 语法",
      );
    const [, field, op, raw] = match;
    if (!(field in input)) throw Error(`缺少输入参数：${field}`);
    const left = input[field];
    const right = raw[0] === "'" ? raw.slice(1, -1) : JSON.parse(raw);
    const num = () => {
      if (typeof left !== "number" || typeof right !== "number")
        throw Error("大小比较需要数值类型");
      return [left, right];
    };
    let v = false;
    switch (op) {
      case ">": {
        const [a, b] = num();
        v = a > b;
        break;
      }
      case ">=": {
        const [a, b] = num();
        v = a >= b;
        break;
      }
      case "<": {
        const [a, b] = num();
        v = a < b;
        break;
      }
      case "<=": {
        const [a, b] = num();
        v = a <= b;
        break;
      }
      case "==":
        v = left === right;
        break;
      case "!=":
        v = left !== right;
    }
    result =
      result === undefined ? v : join === "&&" ? result && v : result || v;
  }
  return Boolean(result);
}
