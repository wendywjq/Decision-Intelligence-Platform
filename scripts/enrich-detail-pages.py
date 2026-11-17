"""Capture missing graph versions and RPC dependency configuration, read-only."""
import gzip,json,pathlib,collections
from importlib.machinery import SourceFileLoader
c=SourceFileLoader('capture',str(pathlib.Path(__file__).with_name('capture-zeus.py'))).load_module()
s=json.load(gzip.open(c.ROOT/'fixtures/zeus-examples.json.gz','rt'));out={'graphVersions':[],'dependencies':[],'fetchers':[],'errors':[]};dest=c.ROOT/'data/zeus-source/detail-pages/enrichment.json'
if dest.exists():out=json.loads(dest.read_text())
def save():dest.write_text(json.dumps(out,ensure_ascii=False))
for item in s['graphs']:
 for v in item['versions']:
  if any(x['id']==item['graph']['id'] and x['version']==v['version'] for x in out['graphVersions']):continue
  try:
   d=c.get('graph_scene/get_by_version',{'id':item['graph']['id'],'version':v['version']},'detail-graph-'+str(item['graph']['id'])+'-'+str(v['version']))['data'];out['graphVersions'].append({'id':item['graph']['id'],'version':v['version'],'graph':d});save()
  except Exception as e:out['errors'].append({'kind':'graph','id':item['graph']['id'],'version':v['version'],'error':str(e)});save()
 print('versions',item['graph']['id'],len(out['graphVersions']),flush=True)
deps=set()
for f in s['features']:
 try:e=json.loads(f['detail'].get('expression')or'{}')
 except:continue
 if isinstance(e,dict) and e.get('dependencyId'):deps.add(e['dependencyId'])
fetchers={d['fetcherId'] for d in out['dependencies']}
for index,id in enumerate(sorted(deps)):
 if any(d['id']==id for d in out['dependencies']):continue
 try:
  d=c.get('fetcher_dependency_config/get',{'id':id},'detail-dependency-'+str(id))['data'];out['dependencies'].append(d)
  if d.get('fetcherId'):fetchers.add(d['fetcherId'])
 except Exception as e:out['errors'].append({'kind':'dependency','id':id,'error':str(e)})
 save()
 if index%30==0:print('dependencies',index,len(deps),flush=True)
for id in sorted(fetchers):
 if any(d['id']==id for d in out['fetchers']):continue
 try:
  f=next(d['fetcher'] for d in out['dependencies'] if d['fetcherId']==id);p=c.get('fetcher_param/get_list_by_fetcher_id',{'id':id},'detail-fetcher-params-'+str(id))['data'];out['fetchers'].append({'id':id,'detail':f,'params':p})
 except Exception as e:out['errors'].append({'kind':'fetcher','id':id,'error':str(e)})
 save()
 if len(out['fetchers'])%25==0:print('interfaces',len(out['fetchers']),len(fetchers),flush=True)
print('complete',len(out['graphVersions']),len(out['dependencies']),len(out['fetchers']),len(out['errors']),flush=True)
# Detail definitions for rules encountered in captured request logs and representative global references.
import sqlite3
conn=sqlite3.connect(c.ROOT/'data/zeus.sqlite')
representative=[r[0] for r in conn.execute('SELECT rule_id FROM source_configs GROUP BY rule_id ORDER BY COUNT(*) DESC LIMIT 5')]
ids=set(representative)
for p in (c.ROOT/'data/zeus-source/detail-pages').glob('*-detail.json'):
 d=json.load(open(p))
 for r in d.get('data')or[]:
  for field in ['takenEffectRules','markedRules','grayRules']:
   ids.update(int(h['id']) for h in r.get(field,[]))
logic=c.get('rule/get_by_ids',{'ids':','.join(map(str,sorted(ids)))},'detail-log-rule-definitions')['data']
if isinstance(logic,dict):logic=logic.get('list',logic.get('rules',[]))
out['rules']=[]
for r in logic:
 entry={'id':r['id'],'logic':r}
 if r['id'] in representative:
  entry['detail']=c.get('rule/get_detail',{'id':r['id'],'preferEditMode':7},'detail-rule-'+str(r['id']))['data'];entry['references']={}
  for ref,label in [(1,'scene'),(2,'rulesGroup'),(3,'layerScene'),(4,'paint'),(5,'rulePage')]:
   try:entry['references'][label]=c.get('rule/get_ref_detail',{'ruleId':r['id'],'refType':ref,'offset':0,'rowsNum':10000},'detail-rule-refs-'+str(r['id'])+'-'+str(ref))['data']
   except Exception as e:out['errors'].append({'kind':'ruleReferences','id':r['id'],'error':str(e)})
 out['rules'].append(entry);save()
print('rule details complete',len(out['rules']),flush=True)
