import datetime,gzip,hashlib,importlib.util,json,pathlib,time,collections
spec=importlib.util.spec_from_file_location('c',pathlib.Path(__file__).with_name('capture-zeus.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
base=c.ROOT/'data/zeus-source';data=json.loads((base/'export.json').read_text());errors=[]
def read(path,params,key,required=False):
 try:return c.get(path,params,key)['data']
 except Exception as e:
  errors.append({'object':key,'error':str(e),'required':required});print('ERROR',key,str(e),flush=True);return None
# Parameter names are resolved by exact matches against the paginated source catalog.
params=[];offset=0
while True:
 d=read('factor_param/search',{'offset':offset,'rowsNum':10000},f'param-full-index-{offset}',True)
 if d is None:break
 params+=d['paramList'];offset+=len(d['paramList'])
 if offset>=d['paramTotal']or not d['paramList']:break
factors=read('factor/search_factor_rule_list',{},'feature-full-index',True)['factor_list']
byName={p['name']:('param',p) for p in params};byName.update({f['name']:('factor',f) for f in factors})
byId={(kind,int(d['id'])):d for kind,items in [('factor',factors),('param',params)] for d in items}
def walk(x):
 if isinstance(x,dict):
  yield x
  for v in x.values():yield from walk(v)
 elif isinstance(x,list):
  for v in x:yield from walk(v)
def parse(x):
 if not isinstance(x,str):return x
 try:return json.loads(x)
 except:return None
required=set()
for r in data['rules']:
 d=r['logic']
 for key in ['factorNameList','paramNameList']:
  vals=d.get(key)or[];vals=vals.split(',') if isinstance(vals,str) else vals
  required.update(v for v in vals if isinstance(v,str))
 required.update((parse(d.get('parsedExpInfo'))or{}).get('dependentEleNames')or[])
for f in data['features']:required.add(f['detail']['name'])
for x in walk([data['graphs'],data['rules']]):
 for key in ['leftParamValue','rightParamValue']:
  for p in walk(parse(x.get(key))):
   if isinstance(p.get('value'),str) and p.get('id') and p.get('zeusDataType')in[0,1]:required.add(p['value'])
selected={};queue=[byName[n] for n in required if n in byName]
while queue:
 kind,d=queue.pop();key=(kind,int(d['id']))
 if key in selected:continue
 selected[key]=d;names=d.get('paramList',d.get('param_list',''))or'';names=names.split(',') if isinstance(names,str)else list(names)
 names+=(parse(d.get('parsedExpInfo',d.get('parsed_exp_info')))or{}).get('dependentEleNames')or[]
 for n in names:
  if isinstance(n,str)and n.strip()in byName:queue.append(byName[n.strip()])
data['features']=[{'id':id,'kind':kind,'detail':d,'reference':d}for(kind,id),d in selected.items()]
data['unresolvedFeatureNames']=sorted(n for n in required if n and n not in byName and not any(r['logic']['name']==n for r in data['rules']))
print('features',len(data['features']),'unresolved',len(data['unresolvedFeatureNames']),flush=True)
# Capture UI-backed result tables with their total counts and complete pagination.
def pages(path,params,key,resultKey):
 rows=[];offset=0;first=None
 while True:
  value=read(path,{**params,'offset':offset,'rowNum':10000},f'{key}-{offset}')
  if value is None:return {'items':rows,'available':False,'total':len(rows)}
  if first is None:first={k:v for k,v in value.items()if k!=resultKey}
  items=value.get(resultKey)or[];rows+=items
  total=value.get('total',value.get('totalCount',len(rows)))
  if not items or len(rows)>=total:break
  offset+=len(items)
 return {**(first or{}),'items':rows,'total':total,'available':True}
releases=[]
for id in data['selection']['releaseIds']:
 b=read('cs_publish/get_basic',{'id':id},f'release-{id}',True);sub=b['publishSubTask'];r={'id':id,'basic':b,'changes':read('drill/change_scene',{'taskId':sub['baseTaskId']},f'release-changes-{id}',True),'summary':read('drill/query_task_change_and_affected_summary',{'taskId':sub['baseTaskId']},f'release-summary-{id}'),'experiments':[],'affected':{}}
 for typ in ['scene','graph_template','rule_group','rule']:
  a=read('cs_publish/get_affected',{'taskId':id,'affectedType':typ,'offset':0,'rowNum':10000},f'release-affected-{id}-{typ}')
  r['affected'][typ]=a
 for lab in sub.get('allLabTaskIds')or[]:r['experiments'].append({'id':lab,'detail':read('lab/query_detail',{'taskId':lab},f'lab-{lab}')})
 r['experimentResults']=[]
 for typ in ([] if b.get('deployMode')==0 else str(b.get('trafficSourceTypes')or'').split(',')):
  if not typ:continue
  p={'id':id,'trafficSourceType':typ}
  result={'trafficSourceType':typ,'statistics':read('cs_publish/get_lab_time_data',p,f'lab-time-{id}-{typ}'),'comparison':pages('cs_publish/get_sample_lab_compare_data'if typ=='3'else'cs_publish/get_lab_compare_data',p,f'lab-compare-{id}-{typ}','sceneCompareDatas'),'details':pages('cs_publish/get_lab_detail_data',p,f'lab-detail-{id}-{typ}','requestIds')}
  r['experimentResults'].append(result)
 r['grayStages']=[]
 for cfg in b.get('autoDeployConfig')or[]:
  stage=cfg.get('stage');p={'id':id,'deployStage':stage}
  r['grayStages'].append({'config':cfg,'statistics':read('cs_publish/get_gray_time_data',p,f'gray-time-{id}-{stage}'),'comparison':pages('cs_publish/get_gray_compare_data',p,f'gray-compare-{id}-{stage}','sceneCompareDatas'),'details':pages('cs_publish/get_gray_detail_data',{**p,'dataType':'gray'},f'gray-detail-{id}-{stage}','requestIds')})
 releases.append(r);(base/'releases-complete.json').write_text(json.dumps(releases,ensure_ascii=False));print('release-complete',id,flush=True)
data['releases']=releases
# Definitions for every template used by selected graphs, with effective-version metadata.
templateIds={int(x['template']['id'])for x in walk(data['graphs'])if isinstance(x.get('template'),dict)and x['template'].get('id')}
data['templates']=[]
for id in sorted(templateIds):
 versions=read('graph_template/get_versions',{'id':id},f'template-versions-{id}')
 if not versions:continue
 vals=versions if isinstance(versions,list) else versions.get('versionList',[])
 if not vals:continue
 version=next((v for v in vals if v.get('status')==64),vals[0])['version']
 graph=read('graph_template/get_by_version',{'id':id,'version':version},f'template-{id}-v{version}')
 if graph:data['templates'].append({'graph':graph,'versions':vals})
# Bulk decision definitions; no production state changes.
decisionIds={int(x['decisionId'])for x in walk([data['scenes'],data['groups'],data['graphs']])if isinstance(x.get('decisionId'),int)and x['decisionId']>0}
data['decisions']=[]
for off in range(0,len(decisionIds),50):
 ids=sorted(decisionIds)[off:off+50];d=read('decision/search_by_ids',{'ids':','.join(map(str,ids))},f'decisions-{off}')
 if isinstance(d,list):data['decisions']+=d
 elif isinstance(d,dict):data['decisions']+=d.get('decisionList',d.get('decisions',[]))
data['errors']+=errors;data['capturedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
# Store original API business fields only, never transport headers or authentication files.
raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();out=c.ROOT/'fixtures';out.mkdir(exist_ok=True)
with gzip.GzipFile(filename=str(out/'zeus-examples.json.gz'),mode='wb',mtime=0)as f:f.write(raw)
report={'schemaVersion':1,'capturedAt':data['capturedAt'],'selection':data['selection'],'counts':{k:len(data.get(k,[]))for k in ['scenes','graphs','groups','rules','features','tags','releases','templates','decisions']},'bindingCounts':{'scene':sum(len(x['configs'])for x in data['scenes']),'groups':sum(len(x['configs'])for x in data['groups'])},'errors':data['errors'],'unresolvedFeatureNames':data['unresolvedFeatureNames'],'sha256':hashlib.sha256((out/'zeus-examples.json.gz').read_bytes()).hexdigest()}
(out/'zeus-examples-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
