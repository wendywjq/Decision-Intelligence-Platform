import importlib.util,json,pathlib
spec=importlib.util.spec_from_file_location('c',pathlib.Path(__file__).with_name('capture-zeus.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
errors=[];releases=[]
def read(path,params,key):
 try:return c.get(path,params,key)['data']
 except Exception as e:errors.append({'object':key,'error':str(e)});print('ERROR',key,str(e),flush=True);return None
for id in [27049,13046,51281,65069,91031]:
 basic=read('cs_publish/get_basic',{'id':id},f'release-{id}');r={'id':id,'basic':basic};sub=basic['publishSubTask']
 r['changes']=read('drill/change_scene',{'taskId':sub['baseTaskId']},f'release-changes-{id}')
 r['summary']=read('drill/query_task_change_and_affected_summary',{'taskId':sub['baseTaskId']},f'release-summary-{id}')
 r['experiments']=[]
 for labId in sub.get('allLabTaskIds')or[]:
  d=read('lab/query_detail',{'taskId':labId},f'lab-{labId}')
  a=read('lab/analyse',{'taskId':labId},f'lab-analysis-{labId}')
  r['experiments'].append({'id':labId,'detail':d,'analysis':a})
 pub=sub.get('publishTaskId')
 if pub:
  r['gray']={'progress':read('drill/progress',{'taskId':pub},f'gray-progress-{pub}'),'detail':read('deploy/query_deploy_content_detail',{'taskId':pub},f'gray-content-{pub}'),'results':read('deploy/query_deploy_result',{'taskId':pub,'offset':0,'rowsNum':10000},f'gray-results-{pub}')}
 releases.append(r);print('release',id,'complete',flush=True)
(c.ROOT/'data/zeus-source/releases.json').write_text(json.dumps({'releases':releases,'errors':errors},ensure_ascii=False))
