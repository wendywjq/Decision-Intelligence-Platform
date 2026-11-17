import gzip,hashlib,importlib.util,json,pathlib
spec=importlib.util.spec_from_file_location('c',pathlib.Path(__file__).with_name('capture-zeus.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
p=c.ROOT/'fixtures/zeus-examples.json.gz';data=json.load(gzip.open(p,'rt'));ids={'factor_consec_765_dp_userid_device_cumulate_1_7d_highrisk':2372525,'factor_receive_uid':45614,'factor_rt_s_cat1name':2379153};unresolved=[]
for name,id in ids.items():
 try:
  d=c.get('rule_factor/get',{'id':id},f'alias-factor-{id}')['data']
  existing=next((f for f in data['features']if f['kind']=='factor'and f['id']==id),None)
  if existing:existing['referenceNames']=list(set(existing.get('referenceNames',[])+[name]));existing['detail']=d
  else:data['features'].append({'id':id,'kind':'factor','detail':d,'referenceNames':[name]})
  print(name,'resolved',d.get('name'),flush=True)
 except Exception as e:unresolved.append(name);print(name,str(e),flush=True)
data['unresolvedFeatureNames']=unresolved
raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
with gzip.GzipFile(filename=str(p),mode='wb',mtime=0)as f:f.write(raw)
m=c.ROOT/'fixtures/zeus-examples-manifest.json';manifest=json.loads(m.read_text());manifest['unresolvedFeatureNames']=unresolved;manifest['counts']['features']=len(data['features']);manifest['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();m.write_text(json.dumps(manifest,ensure_ascii=False,indent=2));print('done')
