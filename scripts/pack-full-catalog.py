"""Package a verified complete capture offline; never includes auth state."""
import gzip, hashlib, json, pathlib, io
root=pathlib.Path(__file__).resolve().parents[1]
source=root/'data/zeus-source/full-catalog-20261118'
progress=json.loads((source/'progress.json').read_text())
if progress['status']!='complete':raise SystemExit('Capture is not complete; refusing to publish partial data')
snapshot=json.loads((source/'snapshot.json').read_text())
interfaces_path=source/'interfaces-progress.json'
if not interfaces_path.exists() or json.loads(interfaces_path.read_text())['status']!='complete':raise SystemExit('RPC interface closure is not complete')
snapshot['interfacesCapturedAt']=json.loads(interfaces_path.read_text())['updatedAt']
ids=[r['id'] for r in snapshot['rules']]
assert len(ids)==len(set(ids))==snapshot['indexedRuleCount']
assert len(ids)>=snapshot['sourceTotal']
assert not snapshot['missingRuleDefinitions']
def check(x):
 if isinstance(x,dict):
  for key,value in x.items():
   if key.lower() in ['cookie_string','zeus-mis_ssoid','access_token','refresh_token','authorization']:raise ValueError('Authentication field found: '+key)
   check(value)
 elif isinstance(x,list):
  for value in x:check(value)
check(snapshot)
packed=source/'packed-catalog.json.gz'
with packed.open('wb') as raw:
 with gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as compressed:
  with io.TextIOWrapper(compressed,encoding='utf-8') as text:json.dump(snapshot,text,ensure_ascii=False,separators=(',',':'))
payload=packed.read_bytes()
out=root/'fixtures/zeus-full-catalog';out.mkdir(exist_ok=True)
parts=[]
for offset in range(0,len(payload),256*1024):
 value=payload[offset:offset+256*1024];path=out/f'part-{len(parts):03d}.bin';path.write_bytes(value)
 parts.append({'path':str(path.relative_to(root)),'size':len(value),'sha256':hashlib.sha256(value).hexdigest()})
for path in out.glob('part-*.bin'):
 if str(path.relative_to(root)) not in {p['path'] for p in parts}:path.unlink()
manifest={'schemaVersion':1,'businessCode':35,'capturedAt':snapshot['capturedAt'],'interfacesCapturedAt':snapshot['interfacesCapturedAt'],'startedAt':progress['startedAt'],'sourceTotal':snapshot['sourceTotal'],'sha256':hashlib.sha256(payload).hexdigest(),'parts':parts,'counts':{'rules':len(ids),'features':len(snapshot['features']),'unavailableFeatures':len(snapshot.get('missingFeatures',[])),'dependencies':len(snapshot.get('dependencies',[])),'fetchers':len(snapshot.get('fetchers',[]))},'missingRuleDefinitions':snapshot['missingRuleDefinitions'],'unavailableFeatures':[{'id':f['id'],'kind':f['kind'],'reason':f['detail'].get('reason'),'referenceNames':f.get('referenceNames',[])} for f in snapshot.get('missingFeatures',[])],'missingTypedFeatures':snapshot['missingTypedFeatures'],'unavailableInterfaces':snapshot.get('unavailableInterfaces',[]),'unresolvedFeatureNames':snapshot['unresolvedFeatureNames'],'requestPolicy':{'concurrency':1,'minimumIdleSeconds':1,'rateLimitCooldownSeconds':60,'resumable':True}}
(root/'fixtures/zeus-full-catalog-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'counts':manifest['counts'],'bytes':len(payload),'parts':len(parts),'unresolved':len(snapshot['unresolvedFeatureNames'])},ensure_ascii=False))
