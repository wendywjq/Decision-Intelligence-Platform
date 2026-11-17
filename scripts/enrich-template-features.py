"""Offline closure pass over already captured catalogs; performs no network requests."""
import gzip,hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1];fixture=root/'fixtures/zeus-examples.json.gz';data=json.load(gzip.open(fixture,'rt'));cache=root/'data/zeus-source/responses'
factors=json.load(open(cache/'feature-full-index.json'))['data']['factor_list'];params=[]
for f in cache.glob('param-full-index-*.json'):params+=json.load(open(f))['data']['paramList']
byName={f['name']:('factor',f)for f in factors};byName.update({p['name']:('param',p)for p in params});known={(f['kind'],f['id'])for f in data['features']}
def walk(x):
 if isinstance(x,dict):
  yield x
  for v in x.values():yield from walk(v)
 elif isinstance(x,list):
  for v in x:yield from walk(v)
required=set()
for x in walk(data['templates']):
 for k in ['leftParamValue','rightParamValue']:
  try:p=json.loads(x.get(k,''))
  except:continue
  for r in walk(p):
   if r.get('id')and r.get('zeusDataType')in[0,1]and isinstance(r.get('value'),str):required.add(r['value'])
queue=[byName[n]for n in required if n in byName];added=0
while queue:
 kind,d=queue.pop();key=(kind,d['id'])
 if key in known:continue
 known.add(key);data['features'].append({'id':d['id'],'kind':kind,'detail':d});added+=1
 names=d.get('param_list',d.get('paramList',''))or'';names=names.split(',')if isinstance(names,str)else names
 for name in names:
  if isinstance(name,str)and name.strip()in byName:queue.append(byName[name.strip()])
with gzip.GzipFile(filename=str(fixture),mode='wb',mtime=0)as f:f.write(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode())
p=root/'fixtures/zeus-examples-manifest.json';m=json.loads(p.read_text());m['counts']['features']=len(data['features']);m['sha256']=hashlib.sha256(fixture.read_bytes()).hexdigest();p.write_text(json.dumps(m,ensure_ascii=False,indent=2));print({'addedTemplateDependencies':added,'features':len(data['features'])})
