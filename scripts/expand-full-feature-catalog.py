"""Expand the rule closure to the complete cached business feature catalogs, offline."""
import datetime, fcntl, json, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
base=root/'data/zeus-source/full-catalog-20261118'
lock=open(base/'.capture.lock','a+')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
snapshot=json.loads((base/'snapshot.json').read_text())
factor_index=json.loads((base/'factor-index.json').read_text())
factors=factor_index['factor_list']
assert len(factors)==int(factor_index['page_nav']['total']), 'Incomplete factor catalog'
params=[];offset=0
while True:
 page=json.loads((base/f'params-page-{offset}.json').read_text())
 assert page['offset']==offset
 params.extend(page['paramList']);offset+=len(page['paramList'])
 if offset>=int(page['paramTotal']):break
 assert page['paramList'],'Incomplete parameter catalog'
assert len(params)==int(page['paramTotal'])
features={}
for kind,items in [('factor',factors),('param',params)]:
 for detail in items:
  key=(kind,int(detail['id']))
  assert key not in features, f'Duplicate catalog entry: {key}'
  features[key]={'id':key[1],'kind':kind,'detail':detail,'reference':detail}
snapshot['features']=[features[k] for k in sorted(features)]
snapshot['featureScope']='all'
snapshot['featureCatalogCounts']={'factor':len(factors),'param':len(params)}
snapshot['featuresExpandedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
path=base/'snapshot.json';temp=path.with_suffix('.tmp')
temp.write_text(json.dumps(snapshot,ensure_ascii=False));temp.replace(path)
print(json.dumps({'scope':snapshot['featureScope'],'counts':snapshot['featureCatalogCounts'],'features':len(features)}))
