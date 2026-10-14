#!/usr/bin/env python3
"""One bounded snapshot/count/dump/encrypt backup. Default: validate only.

No private identity, plaintext dump file, migrations or application calls.
Requires an explicit execution flag; production restricted to existing backup service.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import selectors
import shutil
import signal
import subprocess
import tempfile
import uuid

BACKUP_SERVICE = '78ee0c58-c306-4f3a-95c0-1c94e72e793c'
ENVIRONMENT = 'a3ba3a4a-3d4c-4149-91c4-735e8bae3447'
CHILDREN = []

class Refused(Exception): pass

def execution_seconds(deadline):
    if not deadline or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z',deadline):
        raise Refused('explicit UTC execution deadline required')
    cutoff=datetime.datetime.strptime(deadline,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    remaining=int((cutoff-datetime.datetime.now(datetime.timezone.utc)).total_seconds())
    if remaining<1 or remaining>3600: raise Refused('execution window expired or more than one hour away')
    return min(420,remaining)

def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--execute-one-backup', action='store_true')
    p.add_argument('--synthetic', action='store_true')
    p.add_argument('--receipt-dir')
    p.add_argument('--not-after-utc')
    return p.parse_args(argv)

def validate_target(env, synthetic):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',env.get('PGDATABASE','')):
        raise Refused('database must be a simple name, never a connection string')
    if any(env.get(k) for k in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS')):
        raise Refused('libpq connection overrides refused')
    if env.get('PGPORT') and (not env['PGPORT'].isdigit() or not 1<=int(env['PGPORT'])<=65535):
        raise Refused('invalid PostgreSQL port')
    if synthetic:
        if env.get('PGHOST') != '127.0.0.1' or not re.fullmatch(r'loynara_snapshot_test_[a-z0-9_]+', env.get('PGDATABASE','')):
            raise Refused('synthetic target must be a named loopback test database')
        if env.get('RAILWAY_SERVICE_ID') or env.get('PRODUCTION_ENVIRONMENT'):
            raise Refused('production context refused in synthetic mode')
    elif (env.get('PRODUCTION_ENVIRONMENT') != 'loynara-production'
          or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.railway\.internal',env.get('PGHOST',''))
          or env.get('RAILWAY_SERVICE_ID') != BACKUP_SERVICE
          or env.get('RAILWAY_ENVIRONMENT_ID') != ENVIRONMENT
          or env.get('BACKUP_S3_BUCKET') != 'loynara-rc-backups'
          or not re.fullmatch(r'https://[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com', env.get('BACKUP_S3_ENDPOINT',''))):
        raise Refused('wrong production backup service, environment, database or bucket')
    if env.get('BACKUP_AGE_IDENTITY_FILE'):
        raise Refused('private recovery identity is not used by this runner')

def start(args, **kwargs):
    p = subprocess.Popen(args, start_new_session=True, **kwargs)
    CHILDREN.append(p)
    return p

def stop(p):
    if p.poll() is None:
        os.killpg(p.pid, signal.SIGTERM)
        try: p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL); p.wait(timeout=3)

def run(args, *, stderr, timeout=30, **kwargs):
    p = start(args, stderr=stderr, **kwargs)
    try:
        result = p.communicate(timeout=timeout)[0]
        if p.returncode: raise Refused('subcommand failed; private diagnostics retained only during execution')
        return result
    finally: stop(p)

def marker(p, expected=None, timeout=90):
    with selectors.DefaultSelector() as sel:
        sel.register(p.stdout, selectors.EVENT_READ)
        if not sel.select(timeout): raise Refused('snapshot exporter timed out')
    value = p.stdout.readline().strip()
    if not value or (expected is not None and value != expected): raise Refused('snapshot exporter failed')
    return value

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def execute(args, env):
    os.umask(0o077)
    for name in ('PGUSER','PGDATABASE','PGPASSWORD','BACKUP_AGE_RECIPIENT',
                 'BACKUP_S3_ENDPOINT','BACKUP_S3_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'):
        if not env.get(name): raise Refused('required runtime configuration missing')
    if not env['BACKUP_AGE_RECIPIENT'].startswith('age1') or env.get('AWS_DEFAULT_REGION') != 'auto':
        raise Refused('public age recipient or R2 region invalid')
    for tool in ('psql','pg_dump','age','aws'):
        if not shutil.which(tool): raise Refused('required existing tool missing: '+tool)
    dest = pathlib.Path(args.receipt_dir) if args.receipt_dir else None
    if dest and (not dest.is_dir() or any(dest.iterdir())): raise Refused('receipt directory must already exist and be empty')
    nonce = datetime.datetime.now(datetime.timezone.utc).strftime('%Y/%m/%d/%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:12]
    key = 'loynara/'+nonce+'.dump.age'
    receipt = {}
    with tempfile.TemporaryDirectory(prefix='loynara-snapshot-') as tmp:
        root = pathlib.Path(tmp)
        with (root/'private-diagnostics.log').open('wb') as err:
            exporter = start(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=err, text=True)
            try:
                exporter.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='90s';\nSET LOCAL lock_timeout='5s';\nSET LOCAL idle_in_transaction_session_timeout='180s';\nSELECT pg_export_snapshot();\n")
                exporter.stdin.flush()
                snapshot = marker(exporter)
                if not re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+',snapshot): raise Refused('invalid exported snapshot')
                # All base tables including zero-row tables, auth and drizzle. Locks acquired
                # by the counts remain held until COMMIT, preventing intervening table DDL.
                sql = """DO $$ BEGIN
 IF current_setting('server_version_num')::int / 10000 <> 18 THEN RAISE EXCEPTION 'expected Postgres major 18'; END IF;
 IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 21 THEN RAISE EXCEPTION 'expected pre-cutover journal 21'; END IF;
 IF EXISTS (SELECT 1 FROM pg_foreign_table) THEN RAISE EXCEPTION 'foreign tables unsupported'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg\\_%' AND (table_schema !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' OR table_name !~ '^[a-zA-Z_][a-zA-Z0-9_]*$')) THEN RAISE EXCEPTION 'unsupported count-file identifier'; END IF;
END $$;
"""
                sql += f"\\o {root}/expected-counts.txt\n"
                sql += "SELECT format('SELECT %L, count(*) FROM %I.%I',table_schema||'.'||table_name,table_schema,table_name) FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg\\_%' ORDER BY table_schema,table_name \\gexec\n"
                sql += f"\\o {root}/source-totals.txt\n"
                sql += "SELECT coalesce((SELECT sum(delta) FROM public.ledger_entries),0),coalesce((SELECT sum(balance) FROM public.memberships),0),(SELECT count(*) FROM public.redemptions);\n"
                sql += f"\\o {root}/source-journal.txt\nSELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id;\n"
                sql += "\\o\nSELECT 'COUNTS_READY';\n"
                exporter.stdin.write(sql); exporter.stdin.flush(); marker(exporter,'COUNTS_READY')
                counts = root/'expected-counts.txt'
                # Convert psql's default delimiter to the custodian kit's exact format.
                lines = counts.read_text().splitlines()
                if not lines or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\|[0-9]+',s) for s in lines):
                    raise Refused('complete source count file invalid')
                counts.write_text('\n'.join(s.replace('|',' ') for s in lines)+'\n')
                ciphertext = root/'backup.dump.age'
                dump = start(['pg_dump','--format=custom','--no-owner','--no-acl','--snapshot='+snapshot], stdout=subprocess.PIPE, stderr=err)
                with ciphertext.open('wb') as out:
                    crypt = start(['age','--encrypt','--recipient',env['BACKUP_AGE_RECIPIENT']],stdin=dump.stdout,stdout=out,stderr=err)
                    dump.stdout.close()
                    try:
                        crypt.wait(timeout=90); dump.wait(timeout=5)
                        if crypt.returncode or dump.returncode: raise Refused('snapshot dump/encryption failed')
                    finally: stop(crypt); stop(dump)
                exporter.stdin.write("COMMIT;\nSELECT 'EXPORTER_COMMITTED';\n\\q\n"); exporter.stdin.flush()
                marker(exporter,'EXPORTER_COMMITTED'); exporter.wait(timeout=5)
                if exporter.returncode: raise Refused('snapshot exporter did not complete')
                size = ciphertext.stat().st_size
                if not size: raise Refused('empty ciphertext')
                files = {'ciphertext':ciphertext,'counts':counts,'totals':root/'source-totals.txt','journal':root/'source-journal.txt'}
                receipt = {'version':1,'object':key,'bucket':env['BACKUP_S3_BUCKET'],'ciphertext_bytes':size,
                    'sha256':digest(ciphertext),'counts_sha256':digest(counts),'snapshot':snapshot,
                    'source_journal_entries':len((root/'source-journal.txt').read_text().splitlines()),
                    'runner_sha256':digest(pathlib.Path(__file__)),
                    'totals_sha256':digest(files['totals']),'journal_sha256':digest(files['journal']),
                    'state':'PRODUCER_CREATED_REMOTE_NOT_YET_VERIFIED'}
                aws = ['aws','--endpoint-url',env['BACKUP_S3_ENDPOINT']]
                paths = {'ciphertext':key,'counts':key+'.counts.txt','totals':key+'.totals.txt','journal':key+'.journal.txt'}
                for kind,path in files.items():
                    sha = digest(path)
                    metadata = 'sha256='+sha+',counts-sha256='+receipt['counts_sha256']
                    run(aws+['s3','cp',str(path),'s3://'+env['BACKUP_S3_BUCKET']+'/'+paths[kind],
                        '--metadata',metadata,'--only-show-errors'],stderr=err,stdout=subprocess.DEVNULL)
                    raw = run(aws+['s3api','head-object','--bucket',env['BACKUP_S3_BUCKET'],'--key',paths[kind]],
                        stderr=err,stdout=subprocess.PIPE)
                    head = json.loads(raw)
                    if head.get('ContentLength') != path.stat().st_size or head.get('Metadata',{}).get('sha256') != sha or head.get('Metadata',{}).get('counts-sha256') != receipt['counts_sha256']:
                        raise Refused('remote HEAD size/digest metadata mismatch')
                receipt['state']='UPLOADED_HEAD_METADATA_VERIFIED_NOT_RESTORE_ACCEPTED'
                receipt['objects']=paths
                manifest = root/'producer-receipt.json'; manifest.write_text(json.dumps(receipt,indent=2)+'\n')
                run(aws+['s3','cp',str(manifest),'s3://'+env['BACKUP_S3_BUCKET']+'/'+key+'.receipt.json',
                         '--metadata','sha256='+digest(manifest),'--only-show-errors'],stderr=err,stdout=subprocess.DEVNULL)
                raw=run(aws+['s3api','head-object','--bucket',env['BACKUP_S3_BUCKET'],'--key',key+'.receipt.json'],stderr=err,stdout=subprocess.PIPE)
                head=json.loads(raw)
                if head.get('ContentLength')!=manifest.stat().st_size or head.get('Metadata',{}).get('sha256')!=digest(manifest):
                    raise Refused('receipt HEAD mismatch')
                if dest:
                    for path in [*files.values(),manifest]: shutil.copyfile(path,dest/path.name)
                print(json.dumps(receipt,sort_keys=True),flush=True)
            finally:
                stop(exporter)
    return receipt

def main():
    args=parse_args(); env=dict(os.environ)
    try:
        validate_target(env,args.synthetic)
        if not args.execute_one_backup:
            print('CHECK ONLY: execution disabled'); return 0
        signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(Refused('terminated')))
        signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(Refused('overall time limit exceeded')))
        signal.alarm(execution_seconds(args.not_after_utc) if not args.synthetic or args.not_after_utc else 420)
        execute(args,env)
        return 0
    except (Refused,subprocess.TimeoutExpired,OSError,ValueError) as exc:
        print('BLOCKED: '+(str(exc) if isinstance(exc,Refused) else 'runner failed; no acceptance'),flush=True)
        return 2
    finally:
        for p in reversed(CHILDREN): stop(p)

if __name__=='__main__': raise SystemExit(main())
