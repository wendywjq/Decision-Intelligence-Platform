import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const canSyncSource = existsSync(
  join(homedir(), ".codex/skills/zeus-auth/scripts/zeus_request.sh"),
);

export function registerSourceSync(app: Express, db: Database.Database) {
  const jobs = new Map<string, Promise<unknown>>();
  app.post("/api/source/sync/:kind/:id", async (req, res) => {
    if (!req.is("application/json"))
      return res.status(415).json({ error: "需要 JSON 请求" });
    const { kind, id } = req.params;
    if (
      !["rule", "feature"].includes(kind) ||
      !/^\d{1,10}$/.test(id) ||
      db.name === ":memory:"
    )
      return res.status(400).json({ error: "无效的来源对象" });
    const row = db
      .prepare(
        "SELECT data FROM source_archives WHERE kind=? AND id=? AND version=''",
      )
      .get(kind, id) as any;
    if (!row) return res.status(404).json({ error: "来源对象不存在" });
    const archive = JSON.parse(row.data);
    if (
      kind === "feature" &&
      !(archive.kind === "factor" && archive.detail.type === 2)
    )
      return res.status(400).json({ error: "请选择累计特征" });
    const key = kind + "/" + id;
    const found = db
      .prepare("SELECT 1 FROM source_detail_objects WHERE kind=? AND id=?")
      .get(kind === "rule" ? "ruleVersions" : "accumulation", id);
    if (!found) {
      if (!jobs.has(key)) {
        if (jobs.size >= 3)
          return res
            .status(429)
            .json({ error: "正在同步其他详情，请稍后重试" });
        jobs.set(
          key,
          promisify(execFile)(
            "python3",
            [
              fileURLToPath(
                new URL(
                  "../scripts/sync-rule-feature-details.py",
                  import.meta.url,
                ),
              ),
              "--db",
              db.name,
              "--one",
              kind,
              "--id",
              id,
            ],
            { timeout: 240000 },
          ).finally(() => jobs.delete(key)),
        );
      }
      try {
        await jobs.get(key);
      } catch {
        return res
          .status(503)
          .json({
            error: "未能读取 Zeus 详情，请检查本地 Zeus 登录、空间和网络后重试",
          });
      }
    }
    res.json({ ok: true });
  });
}
