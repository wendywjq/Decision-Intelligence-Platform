"""Package the compressed snapshot into small, hash-verified Git blobs (offline)."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1];base=root/'fixtures';payload=(base/'zeus-examples.json.gz').read_bytes();out=base/'zeus-examples';out.mkdir(exist_ok=True);parts=[]
for start in range(0,len(payload),256*1024):
 data=payload[start:start+256*1024];name=f'part-{len(parts):03d}.bin';(out/name).write_bytes(data);parts.append({'path':'zeus-examples/'+name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()})
p=base/'zeus-examples-manifest.json';m=json.loads(p.read_text());m['parts']=parts;m['sha256']=hashlib.sha256(payload).hexdigest();p.write_text(json.dumps(m,ensure_ascii=False,indent=2));print({'parts':len(parts),'bytes':len(payload)})
