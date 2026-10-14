"""Owned synthetic PostgreSQL only. Real dump/age/restore, filesystem AWS double."""
import hashlib, json, os, pathlib, secrets, shutil, shlex, subprocess, tempfile, time, uuid

HERE=pathlib.Path(__file__).parent
NAME='loynara-snapshot-test-'+uuid.uuid4().hex[:8]
base={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],'LANG':'C','PGCONNECT_TIMEOUT':'5'}
password=secrets.token_hex(16)
docker_env={**base,'POSTGRES_PASSWORD':password}
def command(args, **kw):
    return subprocess.run(args,check=True,capture_output=True,env=kw.pop('env',base),timeout=kw.pop('timeout',60),**kw)
def sql(query,db='loynara_snapshot_test_fixture'):
    return command(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',db,'-c',query],env=env).stdout.decode().strip()
passes=[]
def passed(name): passes.append(name); print('PASS: '+name,flush=True)
try:
    command(['docker','run','--pull=never','-d','--name',NAME,'--label','purpose=snapshot-backup-synthetic',
        '-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD','-e','POSTGRES_USER=restore',
        '-e','POSTGRES_DB=loynara_snapshot_test_fixture','postgres:18-bookworm'],env=docker_env)
    info=json.loads(command(['docker','inspect',NAME]).stdout)[0]
    binding=info['HostConfig']['PortBindings']['5432/tcp'][0]
    assert binding['HostIp']=='127.0.0.1'
    port=info['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    env={**base,'PGHOST':'127.0.0.1','PGPORT':port,'PGUSER':'restore','PGPASSWORD':password,
        'PGDATABASE':'loynara_snapshot_test_fixture'}
    for i in range(30):
        try: sql('SELECT 1'); break
        except subprocess.CalledProcessError: time.sleep(.5)
    else: raise AssertionError('owned synthetic Postgres did not start')
    sql("CREATE SCHEMA auth; CREATE SCHEMA drizzle; CREATE TABLE public.memberships(id int PRIMARY KEY,balance int); CREATE TABLE public.ledger_entries(id int,delta int); CREATE TABLE public.redemptions(id int); CREATE TABLE public.empty_table(id int); CREATE TABLE auth.users(id int); CREATE TABLE drizzle.__drizzle_migrations(id int,hash text,created_at bigint); INSERT INTO public.memberships VALUES(1,5); INSERT INTO public.ledger_entries VALUES(1,5); INSERT INTO auth.users VALUES(1); INSERT INTO drizzle.__drizzle_migrations SELECT s,'synthetic-'||s,s FROM generate_series(1,21)s;")
    with tempfile.TemporaryDirectory(prefix='loynara-snapshot-test-',dir=HERE) as tmp:
        root=pathlib.Path(tmp); root.chmod(0o700)
        bindir=root/'bin';bindir.mkdir(); remote=root/'remote';remote.mkdir()
        key=root/'synthetic-only.agekey'
        command(['age-keygen','-o',str(key)]); key.chmod(0o600)
        recipient=command(['age-keygen','-y',str(key)]).stdout.decode().strip()
        image=os.environ.get('SNAPSHOT_TEST_IMAGE')
        real_dump='/usr/bin/pg_dump' if image else shutil.which('pg_dump')
        real_psql='/usr/bin/psql' if image else shutil.which('psql')
        # Insert a committed row AFTER the runner counted but BEFORE pg_dump begins.
        # Removing --snapshot must make the decrypted dump differ from its baseline.
        (bindir/'pg_dump').write_text('#!/usr/bin/env python3\nimport os,subprocess,sys\n'+
            "if os.environ.get('FAKE_DUMP_FAIL'): sys.exit(1)\n"+
            f"subprocess.run([{real_psql!r},'-X','-qAt','-v','ON_ERROR_STOP=1','-c','INSERT INTO public.memberships VALUES(2,9); INSERT INTO public.ledger_entries VALUES(2,9);'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n"+
            f"os.execv({real_dump!r},[{real_dump!r}]+sys.argv[1:])\n")
        (bindir/'pg_dump').chmod(0o700)
        (bindir/'aws').write_text('''#!/usr/bin/env python3
import json,os,pathlib,shutil,sys
a=sys.argv[1:];a=a[2:] if a[:1]==['--endpoint-url'] else a
root=pathlib.Path(os.environ['FAKE_R2'])
if os.environ.get('FAKE_FAIL'): sys.exit(1)
if a[:2]==['s3','cp']:
 src=pathlib.Path(a[2]); bucket,key=a[3][5:].split('/',1); dest=root/key;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
 metadata=dict(x.split('=',1) for x in a[a.index('--metadata')+1].split(','));(root/(key+'.metadata.json')).write_text(json.dumps(metadata));sys.exit(0)
if a[:2]==['s3api','head-object']:
 key=a[a.index('--key')+1]; f=root/key; metadata=json.loads((root/(key+'.metadata.json')).read_text()); size=f.stat().st_size
 if os.environ.get('FAKE_TAMPER'): metadata['sha256']='0'*64
 print(json.dumps({'ContentLength':size,'Metadata':metadata}));sys.exit(0)
sys.exit(2)
''');(bindir/'aws').chmod(0o700)
        env.update(PATH=str(bindir)+':'+base['PATH'],BACKUP_AGE_RECIPIENT=recipient,
            BACKUP_S3_ENDPOINT='https://synthetic.invalid',BACKUP_S3_BUCKET='synthetic',
            AWS_ACCESS_KEY_ID='synthetic-only',AWS_SECRET_ACCESS_KEY='synthetic-only',AWS_DEFAULT_REGION='auto',FAKE_R2=str(remote))
        artifacts=root/'artifacts';artifacts.mkdir()
        prefix=shlex.split(pathlib.Path(os.environ['SNAPSHOT_TEST_COMMAND']).read_text())[:3] if os.environ.get('SNAPSHOT_TEST_COMMAND') else ['python3',os.environ.get('SNAPSHOT_TEST_RUNNER',str(HERE/'snapshot-runner.py'))]
        if image:
            assert image=='loynara-backup:90ad26a', 'only existing reviewed test image accepted'
            start_args=prefix[1:]
            prefix=['docker','run','--rm','--pull=never','--network','container:'+NAME,
              '--entrypoint','python3','-v',str(root)+':'+str(root)]
            for name in ['PGHOST','PGUSER','PGPASSWORD','PGDATABASE','BACKUP_AGE_RECIPIENT','BACKUP_S3_ENDPOINT',
                         'BACKUP_S3_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_DEFAULT_REGION','FAKE_R2',
                         'FAKE_TAMPER','FAKE_FAIL','FAKE_DUMP_FAIL']:
                prefix+=['-e',name]
            prefix+=['-e','PGPORT=5432','-e','PATH='+str(bindir)+':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',image]+start_args
        runner=prefix+['--synthetic','--execute-one-backup','--receipt-dir',str(artifacts)]
        result=command(runner,env=env,timeout=120); receipt=json.loads(result.stdout)
        counts=dict(line.split() for line in (artifacts/'expected-counts.txt').read_text().splitlines())
        assert counts=={'auth.users':'1','drizzle.__drizzle_migrations':'21','public.empty_table':'0','public.ledger_entries':'1','public.memberships':'1','public.redemptions':'0'}
        passed('complete all-schema counts include zero tables and journal')
        assert sql('SELECT count(*) FROM public.memberships')=='2'
        passed('concurrent committed writer actually changed source')
        decrypted=root/'synthetic.dump'
        command(['age','-d','-i',str(key),'-o',str(decrypted),str(artifacts/'backup.dump.age')])
        sql('CREATE DATABASE loynara_snapshot_test_restored',db='postgres')
        command(['pg_restore','--exit-on-error','--single-transaction','--no-owner','--no-acl','-d','loynara_snapshot_test_restored',str(decrypted)],env=env)
        assert sql('SELECT count(*) FROM public.memberships',db='loynara_snapshot_test_restored')=='1'
        assert sql('SELECT count(*) FROM public.ledger_entries',db='loynara_snapshot_test_restored')=='1'
        assert sql('SELECT sum(balance) FROM public.memberships',db='loynara_snapshot_test_restored')=='5'
        passed('real encrypted dump restores exact pre-writer snapshot and ledger total')
        assert (artifacts/'source-totals.txt').read_text().strip()=='5|5|0'
        passed('source totals match restored generation')
        assert receipt['source_journal_entries']==21 and len((artifacts/'source-journal.txt').read_text().splitlines())==21
        passed('journal captured in same snapshot')
        cipher=artifacts/'backup.dump.age';digest=hashlib.sha256(cipher.read_bytes()).hexdigest()
        assert receipt['sha256']==digest and receipt['ciphertext_bytes']==cipher.stat().st_size
        assert (remote/receipt['object']).read_bytes()==cipher.read_bytes()
        passed('producer ciphertext size/digest and uploaded-byte fixture match')
        assert receipt['state']=='UPLOADED_HEAD_METADATA_VERIFIED_NOT_RESTORE_ACCEPTED'
        passed('remote metadata check does not claim recovery acceptance')
        for flag in ('FAKE_TAMPER','FAKE_FAIL'):
            sql('DELETE FROM public.memberships WHERE id=2; DELETE FROM public.ledger_entries WHERE id=2;')
            out=root/flag;out.mkdir()
            bad=subprocess.run(runner[:-1]+[str(out)],env={**env,flag:'1'},capture_output=True,timeout=120)
            assert bad.returncode==2 and not (out/'producer-receipt.json').exists()
            passed(flag+' refuses acceptance and custody receipt')
        for flag,value in [('FAKE_DUMP_FAIL','1'),('BACKUP_AGE_RECIPIENT','age1invalid')]:
            sql('DELETE FROM public.memberships WHERE id=2; DELETE FROM public.ledger_entries WHERE id=2;')
            out=root/flag;out.mkdir()
            bad=subprocess.run(runner[:-1]+[str(out)],env={**env,flag:value},capture_output=True,timeout=120)
            assert bad.returncode==2 and not (out/'producer-receipt.json').exists()
            passed(flag+' refuses publication on dump/encryption failure')
        corrupt=root/'corrupt.age';corrupt.write_bytes(cipher.read_bytes()[:-10])
        bad=subprocess.run(['age','-d','-i',str(key),str(corrupt)],env=base,capture_output=True)
        assert bad.returncode!=0
        passed('truncated real ciphertext fails decryption')
        assert sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='psql' AND state='idle in transaction' AND pid<>pg_backend_pid()")=='0'
        passed('exporter transaction cleaned after success and failures')
        sql('DELETE FROM public.memberships WHERE id=2; DELETE FROM public.ledger_entries WHERE id=2; DELETE FROM drizzle.__drizzle_migrations WHERE id=21;')
        guard_dir=root/'wrong-journal';guard_dir.mkdir()
        bad=subprocess.run(runner[:-1]+[str(guard_dir)],env=env,capture_output=True,timeout=120)
        assert bad.returncode==2 and not (guard_dir/'producer-receipt.json').exists()
        passed('unexpected source journal refuses backup')
    print('RESULT: '+str(len(passes))+' integration PASS; no production access, real R2 API mocked only',flush=True)
finally:
    check=subprocess.run(['docker','inspect','-f','{{index .Config.Labels "purpose"}}',NAME],env=base,capture_output=True)
    if check.returncode==0 and check.stdout.decode().strip()=='snapshot-backup-synthetic':
        command(['docker','rm','-f','-v',NAME])
