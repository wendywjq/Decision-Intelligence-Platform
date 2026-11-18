"""Check catalog-missing factor IDs individually, in the same read-only rate lane."""
import ast,importlib.util,json,pathlib,time,fcntl
spec=importlib.util.spec_from_file_location('capture',pathlib.Path(__file__).with_name('capture-zeus.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
base=c.ROOT/'data/zeus-source/full-catalog-20261118'
_instance=open(base/'.capture.lock','a+')
try:fcntl.flock(_instance,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise SystemExit('A capture is already running; wait before checking missing factors')
snapshot=json.loads((base/'snapshot.json').read_text());path=base/'resolved-features.json'
resolved=json.loads(path.read_text()) if path.exists() else {'features':[],'unavailable':[]}
known={(f['kind'],f['id']) for k in ['features','unavailable'] for f in resolved[k]}
def save():
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(resolved,ensure_ascii=False,indent=2));tmp.replace(path)
for index,item in enumerate(snapshot['missingTypedFeatures']):
 kind,id=item['kind'],item['id']
 if (kind,id) in known:continue
 if kind=='param':
  resolved['unavailable'].append({'id':id,'kind':kind,'available':False,'availability':'not-in-catalog','detail':{'id':id,'name':'','alias':f'来源未收录参数定义（{id}）','reason':'完整参数目录未包含此 ID，未取得源定义'}})
  save();known.add((kind,id));continue
 try:
  data=c.get('rule_factor/get',{'id':id},f'full-feature-resolution-{kind}-{id}')['data']
  if data and int(data.get('id',-1))!=id:raise RuntimeError('Returned factor does not match requested ID')
  if data:resolved['features'].append({'id':id,'kind':kind,'detail':data})
  else:resolved['unavailable'].append({'id':id,'kind':kind,'available':False,'detail':{'id':id,'name':f'missing_factor_{id}','alias':f'来源未提供因子定义（{id}）','reason':'查询接口返回空数据'}})
 except RuntimeError as error:
  try:info=ast.literal_eval(str(error))
  except (ValueError,SyntaxError):raise
  desc=str(info.get('desc')or info.get('message')or'').lower()
  if not any(term in desc for term in ['不存在','未找到','未查询到','not found']):raise
  resolved['unavailable'].append({'id':id,'kind':kind,'available':False,'detail':{'id':id,'name':f'missing_factor_{id}','alias':f'来源未提供因子定义（{id}）','reason':desc}})
 save();known.add((kind,id));time.sleep(1)
 if index%10==0:print('feature-resolution',index+1,'/',len(snapshot['missingTypedFeatures']),'resolved',len(resolved['features']),'unavailable',len(resolved['unavailable']),flush=True)
# Preserve only names actually present in source rule references, never invent feature names.
def parse(value):
 try:return json.loads(value) if isinstance(value,str) else value
 except(ValueError,TypeError):return None
def walk(value):
 if isinstance(value,dict):
  yield value
  for child in value.values():yield from walk(child)
 elif isinstance(value,list):
  for child in value:yield from walk(child)
names={}
for rule in snapshot['rules']:
 for condition in walk(parse(rule['logic'].get('ruleConditions'))):
  for key in ['leftParamValue','rightParamValue']:
   for ref in walk(parse(condition.get(key))):
    if ref.get('id') and ref.get('zeusDataType') in [0,1] and isinstance(ref.get('value'),str):
     names.setdefault(('param' if ref['zeusDataType']==0 else 'factor',int(ref['id'])),set()).add(ref['value'])
for entry in resolved['unavailable']:
 aliases=sorted(names.get((entry['kind'],entry['id']),set()))
 entry['referenceNames']=aliases;entry['detail']['name']=aliases[0] if aliases else ''
save()
print('resolved',len(resolved['features']),'unavailable',len(resolved['unavailable']),flush=True)
