#!/usr/bin/env python3
"""Bounded local runner. The existing controller/selector remain canonical history."""
import argparse
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
import urllib.request
from pathlib import Path
from datetime import datetime, timezone, timedelta

REPO = Path('/Users/youssefbelmokhtar/Desktop/Loynara')
STATE = REPO / 'var/autopilot-v1'
CLI = Path('/Users/youssefbelmokhtar/.local/bin/codex')
FROZEN = '32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388'
MODEL = 'gpt-6.1-sol'
class Refusal(Exception): pass

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:
        json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

def usage(value):
    required=('input_tokens','cached_input_tokens','output_tokens')
    if any(k not in value or not isinstance(value[k],int) or value[k]<0 for k in required):raise Refusal('usage_unavailable')
    if value['cached_input_tokens']>value['input_tokens']:raise Refusal('usage_inconsistent')
    return {**{k:value[k] for k in required},'uncached_input_tokens':value['input_tokens']-value['cached_input_tokens'],
            'total_tokens':value['input_tokens']+value['output_tokens']}

def founder_action(state,issue,action,why,next_action):
    key=issue+':'+action
    state.setdefault('founder_actions',{}).setdefault(key,{'issue':issue,'url':'https://loynara.youtrack.cloud/issue/'+issue,
       'action_required':action,'why':why,'priority':'P1','next_human_action':next_action,'status':'waiting'})

def eligible(task,state):
    key=task['key'];issue=key.split(':')[0]
    old=state.get('issues',{}).get(issue,{})
    previous=state.get('slices',{}).get(key,{})
    return bool(task.get('gap_verified') and task.get('safe_local') and not task.get('engineering_predecessors')
      and not task.get('required_authorizations') and not task.get('active_worktree')
      and previous.get('outcome') not in ('review','blocked','no_change') and previous.get('approaches',0)<2
      and not (old.get('outcome') and not old.get('slice')))

def budget_reason(window):
    if time.time()>=window.get('expires_at_epoch',float('inf')):return 'six_hour_window_expired'
    if window.get('tasks_completed',0)>=4:return 'four_task_limit'
    u=window.get('usage',{})
    for key,limit in [('total_tokens',2500000),('uncached_input_tokens',250000),('output_tokens',60000)]:
        if u.get(key,0)>=limit:return key+'_budget_reached'
    return None

def recovery_check(state):
    if state.get('active'):raise Refusal('interrupted_or_active_owner_requires_worktree_and_message_reconciliation')
    if state.get('pending_message',{}).get('status') in ('sending','uncertain'):raise Refusal('message_delivery_requires_reconciliation')

def worker_config(root):
    fs={':root':'deny',':minimal':'read',str(root):'write',str(root/'.git'):'read',str(root/'.codex'):'deny',str(root/'.agents'):'deny',
        str(REPO/'node_modules'):'read','/opt/homebrew':'read',str(CLI):'read',str(CLI.resolve()):'read',
        '/Users/youssefbelmokhtar/.codex/packages/standalone':'read'}
    return {'approval_policy':'never','default_permissions':'autopilot','permissions.autopilot.filesystem':fs,
      'permissions.autopilot.network.enabled':False,'features.multi_agent':False,'features.apps':False,
      'web_search':'disabled','model_reasoning_effort':'medium','shell_environment_policy.inherit':'none'}

def overrides(config):
    def toml(v):
        if isinstance(v,dict):return '{'+','.join(json.dumps(k)+'='+toml(x) for k,x in v.items())+'}'
        return json.dumps(v)
    out=[]
    for k,v in config.items():out+=['-c',k+'='+toml(v)]
    return out

def clean_env(root=None):
    # Never inherit DATABASE_URL, provider credentials, MCP tokens, shell profiles or API billing keys.
    e={k:os.environ[k] for k in ('HOME','PATH','LANG','LC_ALL') if k in os.environ}
    e['PATH']='/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    if root:
        tmp=root/'var/autopilot-tmp';tmp.mkdir(parents=True,exist_ok=True);e['TMPDIR']=str(tmp)
    return e

def run_process(args,prompt,out,timeout,env):
    out.mkdir(parents=True,exist_ok=True,mode=0o700);start=time.monotonic()
    def interrupt(signum,frame):raise KeyboardInterrupt
    previous_handler=signal.signal(signal.SIGTERM,interrupt)
    try:
        with (out/'events.jsonl').open('w') as stdout,(out/'stderr.log').open('w') as stderr:
            p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=stdout,stderr=stderr,env=env,text=True,start_new_session=True)
            try:
                atomic(out/'process.json',{'pid':p.pid,'started_epoch':time.time()})
                first=True;code=None
                try:
                    while code is None:
                        if (out.parent/'stop.json').exists():code=130;break
                        remaining=timeout-(time.monotonic()-start)
                        if remaining<=0:code=124;break
                        try:
                            p.communicate(prompt if first else None,timeout=min(0.25,remaining));code=p.returncode
                        except subprocess.TimeoutExpired:first=False
                except KeyboardInterrupt:code=130
            finally:
                if p.poll() is None:
                    try:os.killpg(p.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                    try:p.wait(timeout=5)
                    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
                if p.stdin and not p.stdin.closed:p.stdin.close()
                # Include surviving children even if their parent completed normally.
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
    finally:signal.signal(signal.SIGTERM,previous_handler)
    result={'exit_code':code,'duration_seconds':round(time.monotonic()-start,3),'pid':p.pid}
    atomic(out/'process-result.json',result);return result

def git(root,*args):
    return subprocess.check_output(['/usr/bin/git','-C',str(root),*args],text=True,stderr=subprocess.DEVNULL).strip()

def sandbox_probe(root,out):
    # Identical immutable command profile used by the real CLI invocation.
    probe="""import json,socket,os
from pathlib import Path
home=Path('/Users/youssefbelmokhtar'); result={}
for label,path in [('production_environment',home/'Desktop/Loynara/.env.local'),('host_codex_auth',home/'.codex/auth.json'),('railway_credentials',home/'.railway/config.json'),('host_git',home/'Desktop/Loynara/.git/config')]:
 try:open(path,'rb');result[label]='FAIL_READABLE'
 except PermissionError:result[label]='denied'
 except FileNotFoundError:result[label]='absent'
try:
 Path('var/autopilot-allowed-probe').write_text('synthetic');result['local_edit']='allowed'
except OSError:result['local_edit']='FAIL_DENIED'
try:
 Path('/Users/youssefbelmokhtar/Desktop/Loynara/autopilot-forbidden-probe').write_text('synthetic');result['active_checkout_write']='FAIL_ALLOWED'
except PermissionError:result['active_checkout_write']='denied'
try:
 socket.create_connection(('1.1.1.1',443),timeout=2).close();result['external_network']='FAIL_ALLOWED'
except PermissionError:result['external_network']='denied'
except OSError:result['external_network']='unverified'
print(json.dumps(result))
"""
    command=[str(CLI.resolve()),'sandbox','-C',str(root),'-P','autopilot',*overrides(worker_config(root)),
        '/opt/homebrew/bin/python3','-c',probe]
    proc=subprocess.run(command,cwd=root,env=clean_env(root),text=True,capture_output=True,timeout=20)
    try:result=json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError,IndexError):raise Refusal('sandbox_probe_failed: '+proc.stderr[-240:])
    atomic(out/'sandbox-evidence.json',result)
    if proc.returncode or any(v.startswith('FAIL') or v=='unverified' for v in result.values()):raise Refusal('isolation_not_verified')
    return result

def tracker_token(path):
    if not path.is_file():raise Refusal('restricted_youtrack_transport_credential_missing')
    if path.stat().st_mode & 0o077:raise Refusal('tracker_credential_permissions_not_private')
    value=path.read_text().strip()
    if not value:raise Refusal('tracker_credential_empty')
    return value

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise Refusal('tracker_redirect_denied')

def tracker_get(token,path):
    if not re.fullmatch(r'/(users/me|issues)(\?[^\r\n]*)?',path):raise Refusal('tracker_path_denied')
    request=urllib.request.Request('https://loynara.youtrack.cloud/api'+path,headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    with urllib.request.build_opener(NoRedirect).open(request,timeout=20) as f:return json.load(f)

def tracker_preflight(token_path):
    token=tracker_token(token_path)
    identity=tracker_get(token,'/users/me?fields=login')
    if identity.get('login') in (None,'','admin'):raise Refusal('restricted_non_admin_youtrack_identity_required')
    # Effective server privileges need independently captured negative tests, never inferred from username.
    raise Refusal('restricted_youtrack_server_privileges_not_verified')

def parse_events(path):
    measured=None;session=None;completed=False;failures=[]
    for line in path.read_text().splitlines():
        try:e=json.loads(line)
        except ValueError:continue
        if e.get('type')=='thread.started':session=e.get('thread_id')
        if e.get('type')=='turn.completed':measured=usage(e.get('usage',{}));completed=True
        if e.get('type') in ('turn.failed','error'):failures.append(e.get('type'))
    if measured is None:raise Refusal('cli_usage_event_missing')
    return {'session_id':session,'usage':measured,'turn_completed':completed,'failures':failures,'model':MODEL,'effort':'medium'}

def controlled_cycle(root,prompt,out,seconds):
    if not git(root,'branch','--show-current').startswith('codex/'):raise Refusal('isolated_codex_branch_required')
    if Path(git(root,'rev-parse','--git-common-dir')).resolve()==(root/'.git').resolve():raise Refusal('linked_worktree_required')
    if git(REPO,'rev-parse','codex/nfc-final-customer-policy-v1')!=FROZEN:raise Refusal('frozen_ref_drift')
    sandbox_probe(root,out)
    args=[str(CLI.resolve()),'exec','--ignore-user-config','--ignore-rules','--strict-config','--json','-C',str(root),'-m',MODEL,
          *overrides(worker_config(root)),'-']
    result=run_process(args,prompt,out,seconds,clean_env(root))
    result.update(parse_events(out/'events.jsonl'));atomic(out/'invocation.json',result);return result

def locked_state(directory):
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(directory/'state.lock',os.O_CREAT|os.O_RDWR,0o600)
    lock=os.fdopen(fd,'r+')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:lock.close();raise Refusal('another_run_owns_lock')
    return lock

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--state-dir',type=Path,default=STATE)
    sub=p.add_subparsers(dest='command',required=True)
    for cmd in ('start','status','stop','resume'):sub.add_parser(cmd)
    probe=sub.add_parser('probe');probe.add_argument('--worktree',type=Path,required=True)
    cycle=sub.add_parser('cycle');cycle.add_argument('--worktree',type=Path,required=True);cycle.add_argument('--prompt',type=Path,required=True)
    cycle.add_argument('--issue',required=True);cycle.add_argument('--slice',required=True);cycle.add_argument('--timeout',type=int,default=900)
    a=p.parse_args();directory=a.state_dir;path=directory/'state.json';run_dir=directory/'runner'
    try:
        if a.command=='status':
            s=json.loads(path.read_text());print(json.dumps({'status':s.get('runner',{}),'active':s.get('active'),'founder_actions':s.get('founder_actions',{}),'usage':s.get('runner_usage',{})}));return 0
        if a.command=='stop':
            atomic(run_dir/'stop.json',{'requested_epoch':time.time()});print(json.dumps({'status':'stop_requested','note':'No process is signalled by an unverified stale PID.'}));return 0
        with locked_state(directory):
            s=json.loads(path.read_text()) if path.exists() else {}
            recovery_check(s)
            if a.command in ('start','resume'):
                # No fake activation receipt: refuse before launching a background job until an actual restricted transport is available.
                try:tracker_preflight(directory/'credentials/youtrack-read.token')
                except Refusal as e:
                    s['runner']={'status':'BLOCKED','pid':None,'job':None,'reason':str(e),'checked_at':datetime.now(timezone.utc).isoformat()}
                    atomic(path,s);raise
            if a.command=='probe':
                print(json.dumps(sandbox_probe(a.worktree,run_dir/'probe')));return 0
            if a.command=='cycle':
                if not re.fullmatch(r'LOY-[1-9][0-9]*',a.issue) or not re.fullmatch(r'[a-z][a-z0-9-]{2,63}',a.slice):raise Refusal('invalid_task_key')
                key=a.issue+':'+a.slice
                if not eligible({'key':key,'gap_verified':True,'safe_local':True},s):raise Refusal('task_has_existing_history_or_blocker')
                run=uuid.uuid4().hex;out=run_dir/run
                s['active']={'run':run,'issue':a.issue,'slice':a.slice,'worktree':str(a.worktree),'base_sha':git(a.worktree,'rev-parse','HEAD'),
                    'lease_expires_epoch':time.time()+min(a.timeout,3600),'started_at':datetime.now(timezone.utc).isoformat(),'deadline':(datetime.now(timezone.utc)+timedelta(seconds=min(a.timeout,3600))).isoformat(),'model':MODEL,'mode':'rehearsal','report_dir':str(out)}
                record=s.setdefault('slices',{}).setdefault(key,{})
                record['approaches']=record.get('approaches',0)+1
                atomic(path,s)
                try:
                    result=controlled_cycle(a.worktree,a.prompt.read_text(),out,min(a.timeout,3600))
                    s['active'].update({'session_id':result['session_id'],'last_checkpoint':'CLI completed; independent verification and commit pending'})
                    s.setdefault('runner_usage',{})
                    for k,v in result['usage'].items():s['runner_usage'][k]=s['runner_usage'].get(k,0)+v
                    s['active']['invocation']=result
                    # Keep claim until supervised reviewer verifies and finishes using the existing controller.
                    atomic(path,s);print(json.dumps(result));return result['exit_code']
                except Exception as e:
                    s['active']['failure']=type(e).__name__;s['active']['last_checkpoint']='interrupted; inspect before resume'
                    atomic(path,s);raise
        raise Refusal('unattended_integration_incomplete')
    except (Refusal,OSError,ValueError,subprocess.SubprocessError) as e:
        print(json.dumps({'ok':False,'reason':str(e) if isinstance(e,Refusal) else type(e).__name__}));return 2
if __name__=='__main__':raise SystemExit(main())
