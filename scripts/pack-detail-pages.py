"""Package definition snapshots; request logs remain local unless explicitly included."""
import pathlib,json,gzip,hashlib
root=pathlib.Path(__file__).resolve().parents[1];src=root/'data/zeus-source/detail-pages';data=json.load(open(src/'enrichment.json'));data['capturedAt']=json.load(open(src/'range.json'))['endTime'];data['errors']=data.get('errors',[])
# Preserve a known global reference sample already captured before enrichment.
known=root/'data/zeus-source/responses/rule-get_ref_detail-list.json'
if known.exists():
 rule=next((r for r in data.get('rules',[]) if r['id']==5595),None)
 if not rule:
  import sqlite3
  conn=sqlite3.connect(root/'data/zeus.sqlite');row=conn.execute("SELECT data FROM source_archives WHERE kind='rule' AND id=5595").fetchone();rule=json.loads(row[0]);data.setdefault('rules',[]).append(rule)
 rule.setdefault('references',{}).setdefault('scene',json.load(open(known))['data'])
payload=gzip.compress(json.dumps(data,ensure_ascii=False).encode(),mtime=0);out=root/'fixtures/zeus-details';out.mkdir(exist_ok=True);parts=[]
for start in range(0,len(payload),256*1024):
 b=payload[start:start+256*1024];p=out/f'part-{len(parts):03d}.bin';p.write_bytes(b);parts.append({'path':str(p.relative_to(root)),'size':len(b),'sha256':hashlib.sha256(b).hexdigest()})
manifest={'sha256':hashlib.sha256(payload).hexdigest(),'parts':parts,'counts':{k:len(data.get(k,[])) for k in ['graphVersions','dependencies','fetchers','rules']},'errors':data['errors']};(root/'fixtures/zeus-details-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));print(manifest['counts'],'parts',len(parts),'bytes',len(payload))
