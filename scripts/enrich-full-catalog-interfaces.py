"""Read-only RPC interface closure for the full feature snapshot. Reuse prior captures."""
import ast,fcntl,importlib.util,json,pathlib,time,datetime
spec=importlib.util.spec_from_file_location('capture',pathlib.Path(__file__).with_name('capture-zeus.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
base=c.ROOT/'data/zeus-source/full-catalog-20261118'
instance=open(base/'.capture.lock','a+')
try:fcntl.flock(instance,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise SystemExit('Another source capture is active; run this phase afterwards')
snapshot=json.loads((base/'snapshot.json').read_text())
previous=json.loads((c.ROOT/'data/zeus-source/detail-pages/enrichment.json').read_text())
progress_path=base/'interfaces-progress.json'
progress={'status':'running','phase':'dependencies','completed':0,'updatedAt':None}
def save(**values):
 progress.update(values);progress['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 progress_path.write_text(json.dumps(progress,ensure_ascii=False,indent=2))
def read(endpoint,id,key):
 if endpoint not in ['fetcher_dependency_config/get','fetcher_param/get_list_by_fetcher_id']:raise RuntimeError('Unaudited endpoint')
 file=base/(key+'.json')
 if file.exists():return json.loads(file.read_text())
 try:value=c.get(endpoint,{'id':id},'full-interfaces-'+key)['data']
 except RuntimeError as error:
  try:info=ast.literal_eval(str(error))
  except(ValueError,SyntaxError):raise
  desc=str(info.get('desc')or info.get('message')or'').lower()
  if not any(s in desc for s in ['不存在','未找到','未查询到','not found']):raise
  value={'unavailable':True,'id':id,'reason':desc}
 file.write_text(json.dumps(value,ensure_ascii=False));time.sleep(1)
 return value
try:
 required=set()
 for feature in snapshot['features']:
  value=feature['detail'].get('expression')or'{}'
  try:value=json.loads(value) if isinstance(value,str) else value
  except ValueError:continue
  if isinstance(value,dict) and value.get('dependencyId'):required.add(int(value['dependencyId']))
 known={int(d['id']):d for d in previous['dependencies']}
 dependencies=[];fetchers={};unavailable=[]
 save(total=len(required),reused=sum(id in known for id in required))
 for index,id in enumerate(sorted(required)):
  dep=known.get(id) or read('fetcher_dependency_config/get',id,'dependency-'+str(id))
  if not dep or dep.get('unavailable'):unavailable.append({'kind':'dependency','id':id,'reason':dep.get('reason') if dep else '接口返回空数据'})
  else:
   dependencies.append(dep)
   if dep.get('fetcherId') and dep.get('fetcher'):fetchers[int(dep['fetcherId'])]=dep['fetcher']
  save(completed=index+1)
  if (index+1)%50==0:print('dependencies',index+1,'/',len(required),flush=True)
 old_fetchers={int(f['id']):f for f in previous['fetchers']};captured=[]
 save(phase='fetcher-params',completed=0,total=len(fetchers),reused=sum(id in old_fetchers for id in fetchers))
 for index,(id,detail) in enumerate(sorted(fetchers.items())):
  if id in old_fetchers:captured.append(old_fetchers[id])
  else:
   params=read('fetcher_param/get_list_by_fetcher_id',id,'fetcher-params-'+str(id))
   if isinstance(params,dict) and params.get('unavailable'):unavailable.append({'kind':'fetcherParams','id':id,'reason':params.get('reason')})
   captured.append({'id':id,'detail':detail,'params':params})
  save(completed=index+1)
  if (index+1)%50==0:print('fetchers',index+1,'/',len(fetchers),flush=True)
 snapshot['dependencies']=dependencies;snapshot['fetchers']=captured;snapshot['unavailableInterfaces']=unavailable
 target=base/'snapshot.json';temp=target.with_suffix('.tmp');temp.write_text(json.dumps(snapshot,ensure_ascii=False));temp.replace(target)
 save(status='complete',dependencies=len(dependencies),fetchers=len(captured),unavailable=len(unavailable))
 print(json.dumps(progress,ensure_ascii=False),flush=True)
except Exception as error:
 save(status='stopped',error=repr(error));raise
