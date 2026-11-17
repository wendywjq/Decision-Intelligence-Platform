"""Read decision trees for each captured scene version on the same request lane."""
import pathlib,json
from importlib.machinery import SourceFileLoader
c=SourceFileLoader('capture',str(pathlib.Path(__file__).with_name('capture-zeus.py'))).load_module();p=c.ROOT/'data/zeus-source/detail-pages/enrichment.json';data=json.load(open(p))
for i,v in enumerate(data['graphVersions']):
 try:v['decisionTree']=c.get('decision_tree/get_decision_tree',{'id':v['id'],'version':v['version']},'detail-decision-tree-'+str(v['id'])+'-'+str(v['version']))['data']
 except Exception as e:data['errors'].append({'kind':'decisionTree','id':v['id'],'version':v['version'],'error':str(e)})
 if i%10==0:print('decision versions',i,flush=True)
 p.write_text(json.dumps(data,ensure_ascii=False))
print('decision trees complete',len(data['graphVersions']),flush=True)
