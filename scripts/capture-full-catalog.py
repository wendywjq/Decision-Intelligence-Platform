"""Read-only, resumable full rule catalog and referenced feature capture for space 35.

Single process, one shared request lane, >=1 second between completed requests.
Never probe IDs or retry authentication failures. Resume reruns reuse successful files.
"""
import datetime, hashlib, importlib.util, json, pathlib, re, sys, time, fcntl, signal
spec = importlib.util.spec_from_file_location('capture', pathlib.Path(__file__).with_name('capture-zeus.py'))
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
ROOT = c.ROOT
OUT = ROOT / 'data/zeus-source/full-catalog-20261118'; OUT.mkdir(exist_ok=True)
_instance = open(OUT/'.capture.lock','a+')
try: fcntl.flock(_instance,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: raise SystemExit('Another full catalog capture is already running')
_STOP = False
def stop_after_request(signum, frame):
 global _STOP
 _STOP = True
signal.signal(signal.SIGTERM,stop_after_request)
signal.signal(signal.SIGINT,stop_after_request)
STATE = OUT / 'progress.json'
state = json.loads(STATE.read_text()) if STATE.exists() else {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'businessCode': 35, 'status': 'running'}
def save(**values):
 state.update(values); state['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
 temp = STATE.with_suffix('.tmp'); temp.write_text(json.dumps(state, ensure_ascii=False, indent=2)); temp.replace(STATE)
def read(path, params, key):
 if _STOP: raise RuntimeError("Paused after completed request; resume from cache")
 if path not in ['rule/search_new', 'rule/get_by_ids', 'factor/search_factor_rule_list', 'factor_param/search']: raise ValueError('Unaudited read endpoint')
 dest = OUT / (key + '.json')
 if dest.exists(): return json.loads(dest.read_text())
 data = c.get(path, params, 'full-20261118-' + key)['data']
 dest.write_text(json.dumps(data, ensure_ascii=False))
 # The shared helper limits request starts; this also leaves one full idle second after completion.
 time.sleep(1)
 return data
def parse(x):
 if isinstance(x, str):
  try: return json.loads(x)
  except (ValueError,TypeError): return None
 return x
def walk(x):
 if isinstance(x, dict):
  yield x
  for value in x.values(): yield from walk(value)
 elif isinstance(x,list):
  for value in x: yield from walk(value)
def names(logic):
 result=set()
 for key in ['factorNameList','paramNameList']:
  vals=logic.get(key) or []; vals=vals.split(',') if isinstance(vals,str) else vals
  result.update(v if isinstance(v,str) else v.get('name','') for v in vals)
 result.update((parse(logic.get('parsedExpInfo')) or {}).get('dependentEleNames') or [])
 for condition in walk(parse(logic.get('ruleConditions'))):
  for key in ['leftParamValue','rightParamValue']:
   for ref in walk(parse(condition.get(key))):
    if ref.get('zeusDataType') in [0,1] and isinstance(ref.get('value'),str): result.add(ref['value'])
 return {v.strip() for v in result if isinstance(v,str) and v.strip()}
def main():
 save(status='running',error=None)
 metadata={}; offset=0; total=None
 while total is None or offset<total:
  page=read('rule/search_new',{'offset':offset,'rowsNum':500},f'rules-page-{offset}')
  items=page['ruleList']; total=int(page['ruleTotal'])
  if not items and offset<total: raise RuntimeError('Catalog ended before advertised total')
  for rule in items: metadata[int(rule['id'])]=rule
  offset+=len(items)
  save(phase='rule-index',sourceTotal=total,indexOffset=offset,indexedRules=len(metadata))
  if offset%1000<len(items) or offset>=total: print('rule-index',offset,'/',total,'unique',len(metadata),flush=True)
 # A live catalog can reorder while paging. Reconcile with an independent pass when duplicates reveal drift.
 if len(metadata) != total:
  for pass_no in range(1,4):
   fresh={}; pos=0; target=None
   while target is None or pos<target:
    page=read('rule/search_new',{'offset':pos,'rowsNum':500},f'reconcile-{pass_no}-page-{pos}')
    items=page['ruleList'];target=int(page['ruleTotal'])
    if not items:raise RuntimeError('Reconciliation ended before advertised total')
    for rule in items:fresh[int(rule['id'])]=rule
    pos+=len(items)
    save(phase='index-reconciliation',reconciliationPass=pass_no,indexOffset=pos,sourceTotal=target,indexedRules=len(fresh))
   if len(fresh)==target:
    metadata=fresh;total=target;break
  else:raise RuntimeError('Live catalog kept changing across three passes; successful data cached, resume when stable')
 ids=sorted(metadata); definitions={}
 for start in range(0,len(ids),100):
  batch=ids[start:start+100]; suffix=hashlib.sha256(','.join(map(str,batch)).encode()).hexdigest()[:16]
  part=read('rule/get_by_ids',{'ids':','.join(map(str,batch))},f'rule-definitions-{suffix}')
  if isinstance(part,dict): part=part.get('list',part.get('rules',[]))
  for rule in part: definitions[int(rule['id'])]=rule
  save(phase='rule-definitions',completedBatches=start//100+1,totalBatches=(len(ids)+99)//100,definedRules=len(definitions))
  if (start//100+1)%20==0 or start+100>=len(ids): print('rule-definitions',len(definitions),'/',len(ids),flush=True)
 factors=list(read('factor/search_factor_rule_list',{},'factor-index')['factor_list'])
 resolved_file=OUT/'resolved-features.json'
 resolved=json.loads(resolved_file.read_text()) if resolved_file.exists() else {'features':[],'unavailable':[]}
 factors.extend(f['detail'] for f in resolved['features'] if f['kind']=='factor')
 params=[]; offset=0
 while True:
  page=read('factor_param/search',{'offset':offset,'rowsNum':1000},f'params-page-{offset}')
  items=page['paramList']; params+=items; offset+=len(items)
  save(phase='feature-index',factorIndexCount=len(factors),parameterOffset=offset,parameterTotal=int(page['paramTotal']))
  if offset>=int(page['paramTotal']): break
  if not items: raise RuntimeError('Parameter catalog ended early')
 byname={p['name']:('param',p) for p in params}; byname.update({f['name']:('factor',f) for f in factors})
 byid={(kind,int(f['id'])):(kind,f) for kind,items in [('param',params),('factor',factors)] for f in items}
 required=set(); typed=set()
 for rule in definitions.values():
  required.update(names(rule))
  factor_ids=rule.get('factorIdList') or [];factor_ids=factor_ids.split(',') if isinstance(factor_ids,str) else factor_ids
  typed.update(('factor',int(id)) for id in factor_ids if str(id).strip().isdigit())
  for obj in walk(parse(rule.get('ruleConditions'))):
   for key in ['leftParamValue','rightParamValue']:
    for ref in walk(parse(obj.get(key))):
     if ref.get('id') and ref.get('zeusDataType') in [0,1]: typed.add(('param' if ref['zeusDataType']==0 else 'factor',int(ref['id'])))
 # Expressions also refer to legacy names absent from dependency metadata. Match identifiers against the real catalog only.
 for rule in definitions.values():
  for token in re.findall(r'[A-Za-z_][A-Za-z0-9_]*',rule.get('originExpression') or rule.get('expression') or ''):
   if token in byname: required.add(token)
 selected={}; queue=[byname[n] for n in required if n in byname]+[byid[k] for k in typed if k in byid]
 while queue:
  kind,f=queue.pop(); key=(kind,int(f['id']))
  if key in selected: continue
  selected[key]=f
  deps=f.get('paramList',f.get('param_list','')) or []; deps=deps.split(',') if isinstance(deps,str) else list(deps)
  deps+=(parse(f.get('parsedExpInfo',f.get('parsed_exp_info'))) or {}).get('dependentEleNames') or []
  for token in re.findall(r'[A-Za-z_][A-Za-z0-9_]*',f.get('originExpression') or f.get('origin_expression') or f.get('expression') or ''):
   if token in byname: deps.append(token)
  for name in deps:
   if isinstance(name,str) and name.strip() in byname: queue.append(byname[name.strip()])
 all_rule_names={r.get('name') for r in definitions.values()}
 missing_definitions=sorted(set(ids)-set(definitions))
 unresolved=sorted(required-set(byname)-all_rule_names)
 snapshot={'schemaVersion':1,'businessCode':35,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceTotal':total,'indexedRuleCount':len(metadata),'rules':[{'id':id,'logic':definitions.get(id,metadata[id]),'catalogInfo':metadata[id]} for id in ids],'features':[{'id':id,'kind':kind,'detail':f,'reference':f} for (kind,id),f in sorted(selected.items())],'unresolvedFeatureNames':unresolved,'missingFeatures':resolved['unavailable'],'missingRuleDefinitions':missing_definitions,'missingTypedFeatures':[{'kind':kind,'id':id} for kind,id in sorted(typed-set(byid))]}
 (OUT/'snapshot.json').write_text(json.dumps(snapshot,ensure_ascii=False))
 if missing_definitions: raise RuntimeError(f'{len(missing_definitions)} indexed rule definitions missing; snapshot saved with explicit gaps')
 if len(metadata)<total: raise RuntimeError(f'Index drift: {len(metadata)} unique rules vs {total} advertised; inspect before packaging')
 save(status='complete',phase='complete',rules=len(ids),features=len(selected),unresolvedFeatureNames=len(unresolved),missingTypedFeatures=len(snapshot['missingTypedFeatures']))
 print(json.dumps(state,ensure_ascii=False),flush=True)
if __name__=='__main__':
 try: main()
 except Exception as e:
  save(status='stopped',error=repr(e)); print('STOPPED',repr(e),flush=True);sys.exit(1)
