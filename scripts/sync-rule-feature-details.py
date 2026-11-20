"""Capture missing rule histories and cumulative definitions, serially and resumably."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("capture", ROOT / "scripts/capture-zeus.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
FIXTURE = ROOT / "fixtures/rule-feature-details"


def capture_detail(db, kind, obj_id):
    row = db.execute("SELECT data FROM source_archives WHERE kind=? AND id=? AND version=''", (kind, obj_id)).fetchone()
    if not row:
        raise ValueError("来源对象不存在")
    archive = json.loads(row[0])
    if kind == "rule":
        data = capture.get("rule/get_detail", {"id": obj_id, "preferEditMode": 7}, f"rule-get_detail-{obj_id}")["data"]
        if data.get("basicInfo", {}).get("rule", {}).get("id") != obj_id or not isinstance(data.get("versionInfo"), list):
            raise ValueError("来源规则不匹配或缺少版本字段")
        return data["versionInfo"]
    if archive.get("kind") != "factor" or archive["detail"].get("type") != 2:
        raise ValueError("仅支持累计因子")
    info = capture.get("factor/get_normal_factor", {"id": obj_id}, f"factor-get_normal_factor-{obj_id}")["data"]["basic_info"]
    f = info["factor"]
    if f["id"] != obj_id or f["name"] != archive["detail"]["name"]:
        raise ValueError("来源累计特征不匹配")
    units = {1: "秒", 60: "分钟", 3600: "小时", 86400: "日", 2592000: "月", 31536000: "年", 6: "自然日", 7: "自然周"}
    unit = units.get(f.get("duration_unit"))
    return {
        "period": f'{f["duration_num"]} {unit}' if unit and f.get("duration_num") is not None else None,
        "mode": "普通配置", "events": [f'{e["id"]} | {e.get("alias") or e["name"]}' for e in info["accumulate_event_infos"]],
        "traffic": [f'{e["eventId"]} | {e["eventName"]}' for e in info.get("tatooine_event_infos") or []],
        "keys": f.get("key_fields"), "value": f.get("accumulate_field"), "distinct": f["is_distinct"] == 1 if f.get("is_distinct") in (1,2) else None,
        "distinctKey": (f.get("distinct_value") if f.get("accumulate_type") == 1 else f.get("accumulate_field")) if f.get("is_distinct") == 1 else None,
        "writeCondition": f.get("pre_condition"), "readMode": {0:"与写累计条件相同",1:"填写读取累计条件",2:"无"}.get(f.get("have_read_condition")),
        "readCondition": f.get("read_condition"), "deleteCondition": f.get("delete_condition"),
        "includeCurrent": f.get("includeCurrent"), "includeByCondition": f.get("accumulate_self_by_condition"), "topTimes": f.get("top_times"),
    }


def pack(db):
    FIXTURE.mkdir(exist_ok=True)
    manifest, batch = [], []
    size = count = 0

    def flush():
        if not batch:
            return
        data = gzip.compress(("[" + ",".join(batch) + "]").encode(), mtime=0)
        digest = hashlib.sha256(data).hexdigest()
        parts = []
        for start in range(0, len(data), 256 * 1024):
            part = f"{digest[:16]}-{len(parts):03}.bin"
            (FIXTURE / part).write_bytes(data[start:start + 256 * 1024])
            parts.append(part)
        manifest.append({"parts": parts, "sha256": digest})

    for kind, key, data in db.execute("SELECT kind,id,data FROM source_detail_objects WHERE kind IN ('ruleVersions','accumulation') ORDER BY kind,CAST(id AS INTEGER)"):
        record = "[" + json.dumps(kind) + "," + json.dumps(key) + "," + data + "]"
        if batch and size + len(record) > 4 * 1024 * 1024:
            flush()
            batch = []
            size = 0
        batch.append(record)
        size += len(record)
        count += 1
    flush()
    temp = FIXTURE / "index.tmp"
    temp.write_text(json.dumps(manifest, indent=2))
    temp.replace(FIXTURE / "index.json")
    referenced = {p for group in manifest for p in group["parts"]}
    for old in FIXTURE.glob("*-*.bin"):
        if old.name not in referenced:
            old.unlink()
    print(f"已打包 {count} 个对象", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data/zeus.sqlite"))
    parser.add_argument("--one", choices=["rule", "feature"])
    parser.add_argument("--id", type=int)
    parser.add_argument("--pack", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    db = sqlite3.connect(args.db, timeout=30)
    if args.pack:
        return pack(db)
    if args.one:
        jobs = [(args.one, args.id)]
    else:
        # Interleave kinds, prioritizing rules mounted in the replicated scenes and their factors.
        jobs = db.execute("""
          WITH ordered AS (
            SELECT a.kind,a.id,ROW_NUMBER() OVER(PARTITION BY a.kind ORDER BY
              CASE WHEN a.kind='rule' THEN a.id IN (SELECT rule_id FROM source_configs)
              ELSE a.id IN (SELECT feature_id FROM source_feature_refs JOIN source_configs USING(rule_id)) END DESC,a.id DESC) AS priority
            FROM source_archives a WHERE a.version='' AND (a.kind='rule' OR
              (a.kind='feature' AND json_extract(a.data,'$.kind')='factor' AND json_extract(a.data,'$.detail.type')=2))
            AND NOT EXISTS(SELECT 1 FROM source_detail_objects d WHERE d.kind=CASE a.kind WHEN 'rule' THEN 'ruleVersions' ELSE 'accumulation' END AND d.id=CAST(a.id AS TEXT))
            AND (a.kind!='rule' OR json_type(a.data,'$.detail.versionInfo') IS NULL)
            AND (a.kind!='feature' OR json_type(a.data,'$.detail.accumulation') IS NULL)
          ) SELECT kind,id FROM ordered ORDER BY priority,kind LIMIT ?
        """, (args.limit if args.limit is not None else -1,)).fetchall()
    for index, (kind, obj_id) in enumerate(jobs, 1):
        value = capture_detail(db, kind, obj_id)
        with db:
            db.execute("INSERT OR REPLACE INTO source_detail_objects VALUES(?,?,?)", ("ruleVersions" if kind == "rule" else "accumulation", str(obj_id), json.dumps(value, ensure_ascii=False)))
        if index % 50 == 0:
            print(f"{index}/{len(jobs)}", flush=True)

if __name__ == "__main__":
    main()
