import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { importSourceSnapshot } from "./source-import.ts";
export function readFullCatalogFixture(
  manifestPath = "fixtures/zeus-full-catalog-manifest.json",
) {
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bytes = Buffer.concat(
    manifest.parts.map((part: any) => {
      const bytes = readFileSync(part.path);
      if (
        bytes.length !== part.size ||
        createHash("sha256").update(bytes).digest("hex") !== part.sha256
      )
        throw Error("全量规则分片校验失败：" + part.path);
      return bytes;
    }),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256)
    throw Error("全量规则包摘要错误");
  return { manifest, bytes };
}
export function syncFullCatalogFixture(db: Database.Database) {
  const fixture = readFullCatalogFixture();
  if (!fixture) return;
  const dependencies = db
    .prepare(
      "SELECT key,value FROM settings WHERE key='source-import-digest' OR key LIKE 'detail-fixture:%' ORDER BY key",
    )
    .all();
  const digest =
    "v1:" +
    createHash("sha256")
      .update(fixture.bytes)
      .update(JSON.stringify(dependencies))
      .digest("hex");
  const previous = db
    .prepare("SELECT value FROM settings WHERE key='full-catalog-digest'")
    .get() as any;
  if (previous && JSON.parse(previous.value) === digest) return;
  const snapshot = JSON.parse(gunzipSync(fixture.bytes).toString());
  if (
    snapshot.missingRuleDefinitions?.length ||
    snapshot.indexedRuleCount < snapshot.sourceTotal
  )
    throw Error("全量规则包未完成，拒绝导入");
  importFullCatalogSnapshot(db, snapshot, digest);
}
export function importFullCatalogSnapshot(
  db: Database.Database,
  snapshot: any,
  digest = "manual-full",
) {
  if (snapshot.featureScope === "all") {
    for (const [kind, total] of Object.entries(
      snapshot.featureCatalogCounts || {},
    )) {
      const ids = snapshot.features
        .filter((f: any) => f.kind === kind)
        .map((f: any) => f.id);
      if (ids.length !== total || new Set(ids).size !== total)
        throw Error("全量特征目录不完整：" + kind);
    }
    if (
      !snapshot.featureCatalogCounts?.factor ||
      !snapshot.featureCatalogCounts?.param
    )
      throw Error("全量特征目录缺少来源计数");
  }
  db.transaction(() => {
    importSourceSnapshot(db, snapshot, digest, {
      additive: true,
      preserveLocal: true,
    });
    const put = db.prepare(
      "INSERT OR REPLACE INTO source_detail_objects(kind,id,data) VALUES(?,?,?)",
    );
    for (const dependency of snapshot.dependencies || [])
      put.run("dependency", String(dependency.id), JSON.stringify(dependency));
    for (const fetcher of snapshot.fetchers || []) {
      put.run("fetcher", String(fetcher.id), JSON.stringify(fetcher));
      const edited = db
        .prepare(
          "SELECT 1 FROM audit WHERE module='fetcher' AND entity_id=? AND action IN ('修改','删除') LIMIT 1",
        )
        .get(fetcher.id);
      if (edited) continue;
      const f = fetcher.detail;
      db.prepare(
        "INSERT OR REPLACE INTO entities(module,id,data) VALUES('fetcher',?,?)",
      ).run(
        fetcher.id,
        JSON.stringify({
          id: fetcher.id,
          name: f.name || "接口 " + fetcher.id,
          appId: f.appId,
          appKey: f.appKey || "AppID " + f.appId,
          status: f.status === 64 ? "生效" : String(f.status),
          owner: f.owners || f.modifier,
          timeout: f.timeout,
          sourceImported: true,
          sourceId: fetcher.id,
          updatedAt:
            typeof f.modtime === "number"
              ? new Date(f.modtime * 1000).toISOString()
              : f.modtime,
        }),
      );
    }
  })();
}
