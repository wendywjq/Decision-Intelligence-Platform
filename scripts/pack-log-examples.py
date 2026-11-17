"""Package the original request logs approved for public release by the repository owner."""
import pathlib,json,gzip,hashlib,re
root=pathlib.Path(__file__).resolve().parents[1];src=root/'data/zeus-source/detail-pages/logs.json.gz';payload=src.read_bytes();raw=gzip.decompress(payload);data=json.loads(raw)
assert not re.search(rb'"(?:cookie|authorization|zeus-mis_ssoid)"\s*:',raw,re.I),'Authentication header found'
assert not re.search(rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',raw),'JWT found'
counts={}
for q in data['queries']:
 assert {r['requestId'] for r in q['basic']}=={r['requestId'] for r in q['details']}
 counts[q['cvId']]={'basic':len(q['basic']),'detail':len(q['details'])}
out=root/'fixtures/zeus-logs';out.mkdir(exist_ok=True);parts=[]
for start in range(0,len(payload),256*1024):
 b=payload[start:start+256*1024];p=out/f'part-{len(parts):03d}.bin';p.write_bytes(b);parts.append({'path':str(p.relative_to(root)),'size':len(b),'sha256':hashlib.sha256(b).hexdigest()})
m={'schemaVersion':1,'window':data['window'],'counts':counts,'total':sum(q['basic']for q in counts.values()),'sha256':hashlib.sha256(payload).hexdigest(),'parts':parts,'publication':'Original log examples explicitly approved for public publication by the repository owner.'};(root/'fixtures/zeus-logs-manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print({'queries':len(counts),'requests':m['total'],'parts':len(parts),'bytes':len(payload)})
