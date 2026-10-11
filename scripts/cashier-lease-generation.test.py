"""Run the cashier lease lifecycle regression with an owned disposable local database.
Requires existing dependencies and a reviewed compiled build; starts no worker/provider.
The web cwd contains only public build artifacts and dependencies, never env files.
"""
import argparse, hashlib, os, pathlib, signal, socket, subprocess, tempfile, time, urllib.request, uuid
if not __debug__:raise RuntimeError('Optimized execution refused')
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--build-root',required=True,type=pathlib.Path,help='Reviewed compiled source directory, with .next/BUILD_ID')
BUILD=parser.parse_args().build_root.resolve()
page=pathlib.Path('src/app/cashier/page.tsx')
assert hashlib.sha256((ROOT/page).read_bytes()).digest()==hashlib.sha256((BUILD/page).read_bytes()).digest(),'Compiled source directory must match the current cashier implementation'
NAME='looplocal_cashier_124_'+uuid.uuid4().hex[:12]
DSN='postgresql://looplocal:looplocal_local_only@localhost:55433/'
ENV={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','LANG','USER','SHELL'] if k in os.environ}
ENV.update(DATABASE_URL=DSN+NAME,BETTER_AUTH_SECRET='loynara-disposable-contact-export-124-secret-only',BETTER_AUTH_URL='http://localhost:3000',PUBLIC_BASE_URL='http://localhost:3000',PUBLIC_REGISTRATION_ENABLED='true',TRUST_PROXY_CLIENT_IP='false',SMTP_HOST='disabled',EXTERNAL_EMAIL_ENABLED='false',TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED='false',PROMOTIONAL_EXTERNAL_EMAIL_ENABLED='false',PASSFAST_ENABLED='false',GOOGLE_WALLET_ENABLED='false',APPLE_WALLET_ENABLED='false',NFC_ENABLED='false',LIVE_BILLING_ENABLED='false',NODE_ENV='development',NEXT_TELEMETRY_DISABLED='1',MAILGUN_PROMOTIONAL_SEND_APPROVED='false',GOOGLE_WALLET_ASSET_ENABLED='false',DOTENV_CONFIG_PATH='/tmp/loynara-124-absent-dotenv')
def query(name,sql):return subprocess.check_output(['psql',DSN+name,'-Atc',sql],env=ENV,text=True).strip()
def run(args,**kw):return subprocess.run(args,cwd=ROOT,env=ENV,check=True,**kw)
assert query('postgres','SHOW data_directory')=='/private/tmp/loynara-goal-133-pg'
assert query('postgres',"SELECT count(*) FROM pg_database WHERE datname='"+NAME+"'")=='0'
assert (BUILD/'.next/BUILD_ID').is_file()
with socket.socket() as p:assert p.connect_ex(('127.0.0.1',3000))!=0,'Occupied3000; do not stop another process'
created=False;child=None
with tempfile.TemporaryDirectory(prefix='loy-124-',dir='/tmp') as directory:
 os.chmod(directory,0o700)
 try:
  run(['psql',DSN+'postgres','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE '+NAME],stdout=subprocess.DEVNULL);created=True
  run(['psql',DSN+NAME,'-v','ON_ERROR_STOP=1','-f','drizzle/auth.sql'],stdout=subprocess.DEVNULL)
  run(['./node_modules/.bin/drizzle-kit','migrate'])
  assert query(NAME,'SELECT count(*) FROM drizzle.__drizzle_migrations')=='25'
  with open(pathlib.Path(directory)/'web.log','w') as log:
   shadow=pathlib.Path(directory)/'web';shadow.mkdir()
   for name in ['.next','node_modules','public']:(shadow/name).symlink_to((BUILD if name=='.next' else ROOT)/name,target_is_directory=True)
   for name in ['package.json','next.config.ts']:(shadow/name).write_bytes((ROOT/name).read_bytes())
   child=subprocess.Popen([str(ROOT/'node_modules/.bin/next'),'start','--hostname','127.0.0.1','--port','3000'],cwd=shadow,env=dict(ENV,NODE_ENV='production',PUBLIC_REGISTRATION_ENABLED='false'),stdout=log,stderr=subprocess.STDOUT)
   deadline=time.monotonic()+45
   while True:
    assert child.poll() is None,'Owned compiled web exited'
    try:
     with urllib.request.urlopen('http://localhost:3000/login',timeout=2) as response:assert response.status==200
     break
    except OSError:
     if time.monotonic()>deadline:raise RuntimeError('Readiness timeout')
     time.sleep(.3)
   run(['./node_modules/.bin/playwright','test','e2e/cashier-lease-generation.spec.ts','--output='+directory+'/browser-results'])
 finally:
  if child and child.poll() is None:child.send_signal(signal.SIGTERM)
  if child:child.wait(timeout=30)
  if created:
   assert query('postgres',"SELECT count(*) FROM pg_stat_activity WHERE datname='"+NAME+"'")=='0','Refuse database cleanup with active clients'
   run(['psql',DSN+'postgres','-v','ON_ERROR_STOP=1','-c','DROP DATABASE '+NAME],stdout=subprocess.DEVNULL)
print('OWNED SYNTHETIC CASHIER LEASE DRILL COMPLETE; normal server stop and unique DB cleanup; providers OFF')
