"""Azure VM control channel. Only sanitized command output is returned.
Sensitive file transfers use protected parameters, never command text or stdout.
"""
import json,time,uuid,requests
import runner_results_network as results_network
SCOPE="/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/rg-opa-staging"
VM=SCOPE+"/providers/Microsoft.Compute/virtualMachines/vm-opa-staging-validation-01"
BASE="https://management.azure.com"
class Transport:
    def __init__(self,credential): self.credential=credential
    def headers(self): return {"Authorization":"Bearer "+self.credential.get_token("https://management.azure.com/.default").token}
    def command(self,script,payload=None):
        path=VM+"/runCommands/opa-control-"+uuid.uuid4().hex+"?api-version=2024-07-01"
        properties={"source":{"script":script},"timeoutInSeconds":120,"asyncExecution":False,"treatFailureAsDeploymentFailure":True}
        if payload is not None: properties["protectedParameters"]=[{"name":"OPA_PAYLOAD","value":json.dumps(payload,separators=(",",":"))}]
        try:
            r=requests.put(BASE+path,headers=self.headers(),json={"location":"southafricanorth","properties":properties},timeout=90)
            if r.status_code not in (200,201,202): raise RuntimeError("VM_CONTROL_SUBMIT")
            for _ in range(90):
                time.sleep(2);r=requests.get(BASE+path+"&$expand=instanceView",headers=self.headers(),timeout=60)
                if r.status_code!=200: raise RuntimeError("VM_CONTROL_READ")
                view=r.json()["properties"].get("instanceView",{})
                if view.get("executionState")=="Succeeded":
                    if view.get("exitCode")!=0: raise RuntimeError("VM_CONTROL_EXIT")
                    lines=[x[12:] for x in view.get("output","").splitlines() if x.startswith("OPA_CONTROL ")]
                    if len(lines)!=1: raise RuntimeError("VM_CONTROL_OUTPUT")
                    return json.loads(lines[0])
                if view.get("executionState") in ("Failed","Canceled","TimedOut"): raise RuntimeError("VM_CONTROL_FAILED")
            raise RuntimeError("VM_CONTROL_TIMEOUT")
        finally:
            r=requests.delete(BASE+path,headers=self.headers(),timeout=60)
            if r.status_code not in (200,202,204,404): raise RuntimeError("VM_CONTROL_CLEANUP")
            for _ in range(30):
                if requests.get(BASE+path,headers=self.headers(),timeout=60).status_code==404: break
                time.sleep(2)
            else: raise RuntimeError("VM_CONTROL_CLEANUP_NOT_VERIFIED")
    def results(self,host,expected=None,dns_only=False):
        return self.command(results_network.PROBE_SCRIPT,results_network.payload(host,expected,dns_only))
    def engine(self):
        return self.command(results_network.ENGINE_PROBE_SCRIPT,results_network.engine_payload())
    def probe(self):
        return self.command(SCRIPT,{"action":"probe"})
    def publish(self,name,value):
        if name not in ("opa-staging-test-access.json","opa-staging-test-cleaned.json"): raise RuntimeError("VM_TRANSFER_NAME")
        return self.command(SCRIPT,{"action":"publish","name":name,"value":value})
    def request(self): return self.command(SCRIPT,{"action":"request"})
    def stop(self): return self.command(SCRIPT,{"action":"stop"})
    def clear(self): return self.command(SCRIPT,{"action":"clear"})
    def launch(self,lease,ready,jit): return self.command(SCRIPT,{"action":"launch","lease":lease,"ready":ready,"jit":jit})
SCRIPT="""#!/bin/sh
set -eu
python3 - <<'PY'
import os,json,pathlib,subprocess,socket,re,base64
x=json.loads(os.environ.pop('OPA_PAYLOAD'));action=x['action'];root=pathlib.Path('/runner');out={}
def write(name,value,secret=False):
 p=root/name
 if p.exists() or p.is_symlink():p.unlink()
 fd=os.open(str(p),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f)
 os.chown(p,1001,1001)
if action=='probe':
 mem={k:int(v.split()[0])*1024 for k,v in (l.split(':',1) for l in pathlib.Path('/proc/meminfo').read_text().splitlines()) if k in ['MemTotal','MemAvailable']}
 dns={}
 for h,expected,port in [('opa-pg-staging.postgres.database.azure.com','10.72.1.4',5432),('opa-kv-staging.vault.azure.net','10.72.2.4',443)]:
  ips=sorted({a[4][0] for a in socket.getaddrinfo(h,port,socket.AF_INET,socket.SOCK_STREAM)});assert ips==[expected];s=socket.create_connection((h,port),timeout=10);s.close();dns[h]=expected
 env={'PATH':'/opt/opa/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}
 r=subprocess.run(['/home/runner/externals/node24/bin/node','/opt/opa/verify-toolchain.cjs'],env=env,capture_output=True,text=True);assert r.returncode==0
 assert subprocess.run(['pgrep','-x','Runner.Listener'],capture_output=True).returncode!=0
 assert mem['MemAvailable']>=4*1024**3
 settings=json.loads(base64.b64decode(json.loads(base64.b64decode((root/'.opa-jitconfig').read_text()))['.runner'])) if (root/'.opa-jitconfig').exists() else {}
 out={'memory':mem,'dns':dns,'tools':json.loads(r.stdout),'listenerStopped':True,'jitEphemeral':settings.get('ephemeral',settings.get('Ephemeral')),'jitDisableUpdate':settings.get('disableUpdate',settings.get('DisableUpdate')),'jitSettingKeys':sorted(settings.keys())}
elif action=='publish':
 assert x['name'] in ['opa-staging-test-access.json','opa-staging-test-cleaned.json'];write(x['name'],x['value'],True);out={'written':True}
elif action=='request':
 p=root/'opa-staging-custodian-request.json';out={'request':None}
 if p.exists():
  d=json.loads(p.read_text());assert set(d)=={'action','sha','lease'} and d['action'] in ['create','drop','cleanup'];assert re.fullmatch('[a-f0-9]{40}',d['sha']) and re.fullmatch('[a-f0-9]{24}',d['lease']);out={'request':d}
elif action=='launch':
 l=x['lease'];assert l['source']=='10.72.4.4/32' and l['mode']=='migration-validation' and l['cleanupOwner']=='operator-host-azure'
 assert subprocess.run(['pgrep','-x','Runner.Listener'],capture_output=True).returncode!=0
 p=pathlib.Path('/opt/opa/lease.json');p.write_text(json.dumps(l));os.chmod(p,0o444)
 write('opa-staging-lease.json',l);write('opa-staging-custodian-ready.json',x['ready'])
 env={'PATH':'/opt/opa/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/runner/home','RUNNER_TOOL_CACHE':'/opt/hostedtoolcache','LANG':'C.UTF-8'}
 (root/'home').mkdir(exist_ok=True);os.chown(root/'home',1001,1001)
 old=root/'.opa-jitconfig'
 if old.exists():old.unlink()
 env['ACTIONS_RUNNER_INPUT_JITCONFIG']=x['jit']
 subprocess.Popen(['/usr/sbin/runuser','-u','runner','--','/runner/run.sh'],cwd='/runner',env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 out={'launched':True}
elif action=='stop':
 subprocess.run(['pkill','-KILL','-u','1001'],capture_output=True);out={'stopped':subprocess.run(['pgrep','-u','1001'],capture_output=True).returncode!=0}
elif action=='clear':
 subprocess.run(['pkill','-KILL','-u','1001'],capture_output=True)
 # Removing the tmpfs mount erases all transient job, JIT and secret material.
 r=subprocess.run(['umount','/runner'],capture_output=True);assert r.returncode==0
 out={'tmpfsRemoved':True}
else:raise RuntimeError('CONTROL_ACTION')
print('OPA_CONTROL '+json.dumps(out,separators=(',',':')))
PY
"""
