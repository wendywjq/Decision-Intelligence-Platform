"""Read-only source capture via the installed Zeus auth skill. No credentials are copied."""
import json, os, pathlib, subprocess, urllib.parse, sys, time, threading, fcntl
_RATE_LOCK=threading.Lock()
_NEXT_REQUEST=0
ROOT=pathlib.Path(__file__).resolve().parents[1]
CACHE=ROOT/'data'/'zeus-source'/'responses'; CACHE.mkdir(parents=True,exist_ok=True)
AUTH=pathlib.Path.home()/'.codex/skills/zeus-auth/scripts/zeus_request.sh'
BASE='https://zeus.sankuai.com/zeus-server/ajax/rule_platform/'
def get(path, params, key=None, refresh=False, attempt=0):
 assert not any(x in path.split('/')[-1:] for x in ['create','update','delete','add','publish','run','deploy','upgrade','terminate'])
 key=key or path.replace('/','-')+'-'+str(params.get('id',params.get('sceneId',params.get('taskId','list'))))
 dest=CACHE/(key+'.json')
 if dest.exists() and not refresh:return json.loads(dest.read_text())
 url=BASE+path+'?'+urllib.parse.urlencode({'userName':'weijiaqi10','businessCode':35,**params})
 with _RATE_LOCK, open(CACHE.parent/'.request-clock','a+') as clock:
  fcntl.flock(clock,fcntl.LOCK_EX);clock.seek(0)
  try:last=float(clock.read()or'0')
  except ValueError:last=0
  delay=last+1.0-time.time()
  if delay>0:time.sleep(delay)
  clock.seek(0);clock.truncate();clock.write(str(time.time()));clock.flush()
  fcntl.flock(clock,fcntl.LOCK_UN)
 r=subprocess.run(['bash',str(AUTH),'prod-cn',url,'--max-time','90','-H','M-APPKEY: fe_zeus','-H','zeus: true'],capture_output=True,text=True,timeout=100)
 if r.returncode:raise RuntimeError(r.stderr[:300])
 try:data=json.loads(r.stdout)
 except Exception:raise RuntimeError('Invalid JSON response '+path+' '+r.stdout[:160])
 if data.get('code')!=0 and 'rate limit' in str(data.get('desc','')):
  if attempt>=5:raise RuntimeError('Rate limited after five 60-second cooldowns; resume from cache later')
  time.sleep(60)
  return get(path,params,key,refresh,attempt+1)
 if data.get('code')!=0:raise RuntimeError(str({k:data.get(k) for k in ['code','desc','message']}))
 dest.write_text(json.dumps(data,ensure_ascii=False,indent=2))
 return data
if __name__=='__main__':
 path=sys.argv[1];params=json.loads(sys.argv[2]);data=get(path,params)
 d=data.get('data');print(json.dumps({'path':path,'keys':list(d)[:30] if isinstance(d,dict) else None,'type':type(d).__name__,'size':len(json.dumps(d,ensure_ascii=False))},ensure_ascii=False))
