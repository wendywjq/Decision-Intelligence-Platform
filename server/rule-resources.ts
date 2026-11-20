import { testPackageExamples } from "../src/rule-test-examples.ts";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { createHash } from "node:crypto";

function pictureKey(value: string) {
  const match = /^data:image\/[\w.+-]+;base64,([a-zA-Z0-9+/=\s]+)$/.exec(value);
  if (match)
    return (
      "sha256:" +
      createHash("sha256").update(Buffer.from(match[1], "base64")).digest("hex")
    );
  if (/^(?:sha256:)?[\da-f]{64}$/i.test(value))
    return "sha256:" + value.replace(/^sha256:/i, "").toLowerCase();
  return value;
}
export function resourceLookup(db: Database.Database) {
  return (op: string, left: unknown, ids: unknown[]) => {
    const kind = op === "hitKeywordBag" ? "bag" : "picture";
    const label = kind === "bag" ? "词包" : "图包";
    if (typeof left !== "string") throw Error(label + "匹配需要字符串");
    const key = kind === "picture" ? pictureKey(left) : left;
    for (const id of ids) {
      const row = db
        .prepare("SELECT entries FROM rule_test_packages WHERE kind=? AND id=?")
        .get(kind, String(id)) as { entries: string } | undefined;
      if (!row)
        throw Error(
          "本地缺少" + label + " " + id + " 的内容，请在「本地测试包」中导入",
        );
      const entries: string[] = JSON.parse(row.entries);
      if (
        entries.some((entry) =>
          kind === "bag" ? key.includes(entry) : key === entry,
        )
      )
        return true;
    }
    return false;
  };
}
export function registerRuleResources(app: Express, db: Database.Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS rule_test_packages(kind TEXT,id TEXT,entries TEXT NOT NULL,PRIMARY KEY(kind,id))",
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO rule_test_packages VALUES(?,?,?)",
  );
  for (const [kind, example] of Object.entries(testPackageExamples)) {
    const entries =
      kind === "picture" ? example.entries.map(pictureKey) : example.entries;
    insert.run(kind, example.id, JSON.stringify(entries));
  }
  const path = "/api/rule-test-packages/:kind/:id";
  app.get(path, (req, res) => {
    const row = db
      .prepare("SELECT entries FROM rule_test_packages WHERE kind=? AND id=?")
      .get(req.params.kind, req.params.id) as any;
    return res.json({ entries: row ? JSON.parse(row.entries) : null });
  });
  app.put(path, (req, res) => {
    const { id, kind } = req.params,
      entries = req.body?.entries;
    if (
      !/^\d{1,16}$/.test(id) ||
      !["bag", "picture"].includes(kind) ||
      !Array.isArray(entries) ||
      entries.length > 20000 ||
      entries.some((e) => typeof e !== "string" || !e.trim())
    )
      return res.status(400).json({ error: "请填写数字包 ID 及有效条目" });
    const saved = [
      ...new Set(
        entries.map((e: string) =>
          kind === "picture" ? pictureKey(e.trim()) : e,
        ),
      ),
    ];
    db.prepare("INSERT OR REPLACE INTO rule_test_packages VALUES(?,?,?)").run(
      kind,
      id,
      JSON.stringify(saved),
    );
    return res.json({ count: saved.length });
  });
}
