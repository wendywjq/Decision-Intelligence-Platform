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
  cooldown=0
  try:
   r=subprocess.run(['bash',str(AUTH),'prod-cn',url,'--max-time','90','-H','M-APPKEY: fe_zeus','-H','zeus: true','-w','\nZEUS_HTTP_STATUS:%{http_code}'],capture_output=True,text=True,timeout=100)
   raw,_,code=r.stdout.rpartition('\nZEUS_HTTP_STATUS:')
   if code.strip() in ('429','502','503','504'):
    cooldown=60*(attempt+1)
   elif r.returncode:
    cooldown=30*(attempt+1)
   else:
    try:
     response=json.loads(raw)
     if response.get('code')!=0 and any(term in str(response.get('desc','')).lower() for term in ['rate limit','too many requests','频繁','限流']):cooldown=60
    except (ValueError,AttributeError): pass
  finally:
   clock.seek(0);clock.truncate();clock.write(str(time.time()+cooldown));clock.flush()
 body,_,status=r.stdout.rpartition('\nZEUS_HTTP_STATUS:')
 status=status.strip()
 if r.returncode:
  if r.returncode in [5,6,7,18,28,35,52,55,56] and attempt<3:
   print("Network interruption, curl exit",r.returncode,"cooldown",30*(attempt+1),"seconds",file=sys.stderr,flush=True)
   time.sleep(30*(attempt+1));return get(path,params,key,refresh,attempt+1)
  raise RuntimeError('Network request failed: curl exit '+str(r.returncode))
 if status=='429' or status in ['502','503','504']:
  if attempt>=3:raise RuntimeError('HTTP '+status+' after bounded cooldowns; resume later')
  print('HTTP',status,'cooldown',60*(attempt+1),'seconds',file=sys.stderr,flush=True)
  time.sleep(60*(attempt+1));return get(path,params,key,refresh,attempt+1)
 if status in ['301','302','401','403']:raise RuntimeError('HTTP '+status+'; authentication/authorization required, stopped')
 try:data=json.loads(body)
 except Exception:raise RuntimeError('Invalid JSON response '+path+' '+body[:160])
 if data.get('code')!=0 and any(term in str(data.get('desc','')).lower() for term in ['rate limit','too many requests','频繁','限流']):
  if attempt>=5:raise RuntimeError('Rate limited after five 60-second cooldowns; resume from cache later')
  print("Rate limit response; cooldown 60 seconds",file=sys.stderr,flush=True)
  time.sleep(60)
  return get(path,params,key,refresh,attempt+1)
 if data.get('code')!=0:raise RuntimeError(str({k:data.get(k) for k in ['code','desc','message']}))
 dest.write_text(json.dumps(data,ensure_ascii=False,indent=2))
 return data
if __name__=='__main__':
 path=sys.argv[1];params=json.loads(sys.argv[2]);data=get(path,params)
 d=data.get('data');print(json.dumps({'path':path,'keys':list(d)[:30] if isinstance(d,dict) else None,'type':type(d).__name__,'size':len(json.dumps(d,ensure_ascii=False))},ensure_ascii=False))
