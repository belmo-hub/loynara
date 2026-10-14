"""Generate the exact digest-pinned Start Command; does not contact Railway."""
import base64, gzip, hashlib, json, pathlib, shlex
root=pathlib.Path(__file__).parent
payload=(root/'snapshot-runner.py').read_bytes()
sha=hashlib.sha256(payload).hexdigest()
encoded=base64.b64encode(gzip.compress(payload,mtime=0)).decode()
bootstrap=f'''import base64,gzip,hashlib,os,pathlib,shutil,signal,subprocess,sys,tempfile
payload=gzip.decompress(base64.b64decode({encoded!r}))
if hashlib.sha256(payload).hexdigest()!={sha!r}: sys.exit(2)
root=tempfile.mkdtemp(prefix='loynara-backup-bootstrap-')
os.chmod(root,0o700)
target=pathlib.Path(root)/'snapshot-runner.py'
target.write_bytes(payload)
os.chmod(target,0o600)
child=None
result=2
try:
 child=subprocess.Popen([sys.executable,str(target)]+sys.argv[1:])
 signal.signal(signal.SIGTERM,lambda *_: child.terminate())
 signal.signal(signal.SIGINT,lambda *_: child.terminate())
 result=child.wait(timeout=450)
except Exception:
 result=2
finally:
 if child is not None and child.poll() is None:
  child.terminate()
  try: child.wait(timeout=10)
  except subprocess.TimeoutExpired: child.kill();child.wait(timeout=5)
 shutil.rmtree(root)
sys.exit(result)
'''
command='python3 -c '+shlex.quote('exec('+repr(bootstrap)+')')+' --not-after-utc 2026-10-13T20:30:00Z --execute-one-backup'
(root/'snapshot-start-command.txt').write_text(command+'\n')
(root/'snapshot-bootstrap.py').write_text(bootstrap)
request={'serviceId':'78ee0c58-c306-4f3a-95c0-1c94e72e793c','environmentId':'a3ba3a4a-3d4c-4149-91c4-735e8bae3447','startCommand':command,'pinnedBackupSource':'90ad26a0f3553c89f17ce5d07e8246591240b852','runnerSHA256':sha,'originalStartCommand':'','restoreStartCommand':'','cronSchedule':'0 3 * * *','restartPolicy':'Never','maximumExecutionSeconds':420,'executionDeadlineUTC':'2026-10-13T20:30:00Z','status':'PREPARED_ONLY_NOT_AUTHORIZED'}
request['startCommandSHA256']=hashlib.sha256(command.encode()).hexdigest()
request['executionMechanism']={'stage':'serviceInstanceUpdate input.startCommand only; one production environment verified',
 'execute':'serviceInstanceDeployV2 pinned to existing backup source90ad26a0f3553c89f17ce5d07e8246591240b852; backup service only',
 'run':'Observe deployment/cron execution first. Run now at most once only if proven not already executed. Never repeat uncertain submissions.',
 'restore':'restore startCommand exact empty string and register original pinned backup source/entrypoint; no manual extra backup',
 'permissions':'account mutation eligibility unproven; stop on rejection or unexpected source/configuration; no permission changes or alternate source',
 'temporaryConfigurationLimit':'restore immediately on success/failure, planned maximum30minutes; report any restoration failure. Expiry prevents snapshots after22:30Berlin.'}
(root/'snapshot-backup-change.json').write_text(json.dumps(request,indent=2)+'\n')
(root/'snapshot-config-mutation.graphql').write_text('mutation ($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }\n')
(root/'snapshot-deploy-mutation.graphql').write_text('mutation ($serviceId: String!, $environmentId: String!, $commitSha: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha) }\n')
common={'serviceId':request['serviceId'],'environmentId':request['environmentId']}
for name,values in [('snapshot-apply-variables.json',{**common,'input':{'startCommand':command}}),
                    ('snapshot-restore-variables.json',{**common,'input':{'startCommand':''}}),
                    ('snapshot-deploy-variables.json',{**common,'commitSha':request['pinnedBackupSource']})]:
 (root/name).write_text(json.dumps(values,indent=2)+'\n')
print('Prepared command, '+str(len(command))+' characters; runner SHA256 '+sha)
