"""Capture the user-selected examples. This program only uses audited read endpoints."""
import concurrent.futures as futures, datetime, gzip, importlib.util, json, pathlib, threading
spec=importlib.util.spec_from_file_location('capture',pathlib.Path(__file__).with_name('capture-zeus.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
SELECTION={'sceneIds':[3503,32707,3509,3510,5005,21715,21716,21717,21718,21719],'graphIds':[77000,34214,31844],'groupIds':[114000,77004,34908,34909],'releaseIds':[27049,13046,51281,65069,91031]}
OUT=c.ROOT/'data/zeus-source/export.json';errors=[];lock=threading.Lock()
def request(path,params,key):return c.get(path,params,key)['data']
def safe(label,fn):
 try:return fn()
 except Exception as e:
  with lock:errors.append({'object':label,'error':str(e)})
  print('ERROR',label,str(e),flush=True);return None
def batch(items,fn,label):
 results=[]
 with futures.ThreadPoolExecutor(max_workers=1) as pool:
  jobs={pool.submit(safe,f'{label}:{i}',lambda i=i:fn(i)):i for i in items}
  for idx,f in enumerate(futures.as_completed(jobs),1):
   value=f.result()
   if value is not None:results.append(value)
   if idx%50==0 or idx==len(jobs):print(label,idx,'/',len(jobs),flush=True)
 return results
def paged(path,params,key,listKey,totalKey='total'):
 result=[];offset=0
 while True:
  data=request(path,{**params,'offset':offset,'rowsNum':10000,'rowNum':10000},key+'-'+str(offset));items=data.get(listKey,[]) if isinstance(data,dict) else data
  result.extend(items or []);total=data.get(totalKey,len(result)) if isinstance(data,dict) else len(result)
  if not items or len(result)>=total:break
  offset+=len(items)
 return result
def scene(id):return {'scene':request('scene/search_scene_by_id',{'id':id},f'scene-{id}'),'configs':paged('scene_rule_conf/search_normal_configs',{'sceneId':id},f'scene-confs-{id}','items')}
def graph(id):
 versions=request('graph_scene/get_scene_versions',{'id':id},f'graph-versions-{id}')['versionList'];active=next((v for v in versions if v.get('status')==64),versions[0]);v=active['version']
 data=request('graph_scene/get_by_version',{'id':id,'version':v},f'graph-{id}-v{v}')
 tree=request('decision_tree/get_decision_tree',{'id':id,'version':v},f'decision-tree-{id}-v{v}')
 return {'graph':data,'decisionTree':tree,'versions':versions}
def walk(value):
 if isinstance(value,dict):
  yield value
  for v in value.values():yield from walk(v)
 elif isinstance(value,list):
  for v in value:yield from walk(v)
def group(id):
 data=request('rule_group/search_rule_groups',{'query':id,'offset':0,'rowsNum':100},f'group-{id}')
 meta=next((g for g in data['ruleGroups'] if g['id']==id),None)
 if not meta:raise ValueError('No exact group ID match')
 return {'group':meta,'configs':paged('rule_group/simple_search_rule_group_confs',{'ruleGroupId':id},f'group-confs-{id}','ruleGroupConfList','totalNum')}
def checkpoint(data):OUT.write_text(json.dumps(data,ensure_ascii=False))
def main():
 data={'schemaVersion':1,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'selection':SELECTION}
 data['scenes']=batch(SELECTION['sceneIds'],scene,'scenes');data['graphs']=batch(SELECTION['graphIds'],graph,'graphs')
 groups=set(SELECTION['groupIds'])
 for obj in walk([data['scenes'],data['graphs']]):
  if obj.get('ruleGroupId'):groups.add(int(obj['ruleGroupId']))
 data['groups']=batch(sorted(groups),group,'groups');checkpoint(data)
 ruleIds=set()
 for obj in walk([data['scenes'],data['graphs'],data['groups']]):
  if obj.get('ruleId') and isinstance(obj['ruleId'],int):ruleIds.add(obj['ruleId'])
 print('unique rules',len(ruleIds),flush=True)
 chunks=[sorted(ruleIds)[i:i+50] for i in range(0,len(ruleIds),50)]
 captured=batch(list(range(len(chunks))),lambda idx:request('rule/get_by_ids',{'ids':','.join(map(str,chunks[idx]))},f'rules-batch-{idx}'),'rules-batches')
 logics={r['id']:r for part in captured for r in part}
 missing=ruleIds-set(logics)
 for id in sorted(missing):errors.append({'object':f'rule:{id}','error':'not returned by bulk API'})
 data['rules']=[]
 for id,logic in logics.items():
  cache=c.CACHE/f'rule-detail-{id}.json'
  detail=json.loads(cache.read_text())['data'] if cache.exists() else {'basicInfo':{'rule':logic},'refInfo':{}}
  data['rules'].append({'id':id,'logic':logic,'detail':detail})
 checkpoint(data)
 # A source-provided index contains full legacy factor definitions and input parameters.
 index=request('factor/search_factor_rule_list',{},'feature-full-index')
 candidates=index.get('factor_list',[])
 byName={str(f['name']):f for f in candidates};byId={int(f['id']):f for f in candidates}
 requiredNames=set(); requiredIds=set()
 def parse(value):
  if isinstance(value,str):
   try:return json.loads(value)
   except:return None
  return value
 for r in data['rules']:
  logic=r['logic']
  for key in ['factorNameList','paramNameList']:
   vals=logic.get(key) or []
   if isinstance(vals,str):vals=vals.split(',')
   requiredNames.update(v for v in vals if isinstance(v,str))
  p=parse(logic.get('parsedExpInfo')) or {}
  requiredNames.update(p.get('dependentEleNames') or [])
  for obj in walk(logic.get('ruleConditions',[])):
   for key in ['leftParamValue','rightParamValue']:
    for ref in walk(parse(obj.get(key))):
     if ref.get('id') and ref.get('zeusDataType') in [0,1]:requiredIds.add(int(ref['id']));requiredNames.add(str(ref.get('value','')))
 for obj in walk(data['graphs']):
  for key in ['leftParamValue','rightParamValue']:
   for ref in walk(parse(obj.get(key))):
    if ref.get('id') and ref.get('zeusDataType') in [0,1]:requiredIds.add(int(ref['id']));requiredNames.add(str(ref.get('value','')))
 selected={};queue=[byName[n] for n in requiredNames if n in byName]+[byId[i] for i in requiredIds if i in byId]
 while queue:
  f=queue.pop();id=int(f['id'])
  if id in selected:continue
  selected[id]=f
  names=f.get('param_list',f.get('paramList','')) or ''
  names=names.split(',') if isinstance(names,str) else names
  p=parse(f.get('parsed_exp_info',f.get('parsedExpInfo'))) or {}
  names+=p.get('dependentEleNames') or []
  for n in names:
   if isinstance(n,str) and n.strip() in byName:queue.append(byName[n.strip()])
 data['features']=[{'id':id,'kind':'param' if f.get('factor_type')=='param' or f.get('zeusDataType')==0 or f.get('isParam') else 'factor','detail':f,'reference':f} for id,f in selected.items()]
 data['featureIndexFields']={key:value for key,value in index.items() if key!='factor_list'}
 data['unresolvedFeatureNames']=sorted(n for n in requiredNames if n and n not in byName)
 checkpoint(data)
 tags=request('tag/get_list',{},'all-tags')
 data['tags']=[t for t in tags['tagList'] if t.get('riskTag') or t.get('objType')==5]
 data['tagCounts']={k:v for k,v in tags.items() if k!='tagList'}
 data['errors']=errors;checkpoint(data)
 print(json.dumps({k:len(data[k]) for k in ['scenes','graphs','groups','rules','features','tags','errors']}),flush=True)
if __name__=='__main__':main()
