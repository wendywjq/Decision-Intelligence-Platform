"""Page global inbound references to completion; preserve source counters."""
import json,pathlib,sqlite3
from importlib.machinery import SourceFileLoader
c=SourceFileLoader('capture',str(pathlib.Path(__file__).with_name('capture-zeus.py'))).load_module();p=c.ROOT/'data/zeus-source/detail-pages/enrichment.json';data=json.load(open(p));rules=[r for r in data['rules']if r.get('references')]
conn=sqlite3.connect(c.ROOT/'data/zeus.sqlite');r=json.loads(conn.execute("SELECT data FROM source_archives WHERE kind='rule' AND id=5595").fetchone()[0]);r.pop('references',None);r['references']={};rules.append(r)
for r in rules:
 for typ,label,field,totalField in [(1,'scene','sceneConfList','sceneTotal'),(2,'rulesGroup','sceneConfList','sceneTotal'),(3,'layerScene','graphSceneConfList','graphSceneTotal'),(4,'paint','canvasRefList','canvas_total'),(5,'rulePage','ruleList','rule_total')]:
  offset=0;items=[];total=None;pages=0
  while total is None or offset<total:
   result=c.get('rule/get_ref_detail',{'ruleId':r['id'],'refType':typ,'offset':offset,'rowsNum':10000},'full-rule-ref-'+str(r['id'])+'-'+str(typ)+'-'+str(offset))['data'];total=result.get(totalField,0);page=result.get(field,[]);pages+=1
   if not page:break
   items.extend(page);offset+=10000
  count=sum(len(x.get('rules',[]))for x in items)if typ in [1,2,3] else len(items)
  r['references'][label]={field:items,totalField:total,'_capture':{'reportedTotal':total,'returnedConfigs':count,'pages':pages,'complete':count>=total}}
  print(r['id'],label,total,count,pages,flush=True)
 if not any(x['id']==r['id']for x in data['rules']):data['rules'].append(r)
 p.write_text(json.dumps(data,ensure_ascii=False))
