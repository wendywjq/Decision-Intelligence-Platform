"""Read-only detail page captures; share the one-second request lane."""
import json,pathlib,time,subprocess,fcntl,gzip
from importlib.machinery import SourceFileLoader
c=SourceFileLoader('capture',str(pathlib.Path(__file__).with_name('capture-zeus.py'))).load_module()
ROOT=c.ROOT;OUT=ROOT/'data/zeus-source/detail-pages';OUT.mkdir(exist_ok=True)
def post(path,payload,key,attempt=0):
 dest=OUT/(key+'.json')
 if dest.exists():
  old=json.loads(dest.read_text())
  if old.get("code")==0:return old
 assert path in ['log_analysis_mcp/get_basic_log_list','log_analysis_mcp/get_detail_log_list']
 with open(c.CACHE.parent/'.request-clock','a+') as clock:
  fcntl.flock(clock,fcntl.LOCK_EX);clock.seek(0);last=float(clock.read()or'0');time.sleep(max(0,last+1-time.time()));clock.seek(0);clock.truncate();clock.write(str(time.time()));clock.flush()
  r=subprocess.run(['bash',str(c.AUTH),'prod-cn','https://zeus.sankuai.com/zeus-server/manage/'+path,'--max-time','90','-H','Content-Type: application/json','--data',json.dumps(payload)],capture_output=True,text=True,timeout=100)
 d=json.loads(r.stdout)
 if d.get('code')!=0 and 'rate limit' in str(d.get('desc','')).lower():
  if attempt>=5:raise RuntimeError('Rate limited after five cooldowns')
  time.sleep(60);return post(path,payload,key,attempt+1)
 if d.get('code')!=0:raise RuntimeError(str({k:d.get(k) for k in ['code','desc']}))
 dest.write_text(json.dumps(d,ensure_ascii=False));return d
if __name__=='__main__':
 now=int(time.time());meta=OUT/'range.json'
 if meta.exists():window=json.loads(meta.read_text())
 else:window={'startTime':now-86400,'endTime':now};meta.write_text(json.dumps(window))
 for cv in ['1300247749367','255319025253','255319725675','255319033440','255317666688','1300276491424']:
  q={'businessCode':35,'logType':'COMMON_LOG_TYPE',**window,'limit':1000,'queryFields':[{'name':'cvId','op':'EQUAL','values':[cv]}]}
  for mode in ['basic','detail']:
   d=post('log_analysis_mcp/get_'+mode+'_log_list',{'userName':'weijiaqi10',**q},cv+'-'+mode)
   print(cv,mode,str(d)[:200],flush=True)
