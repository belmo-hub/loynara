#!/usr/bin/env python3
"""Encrypted independent erasure intents. Only fixed diagnostics cross the CLI boundary."""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import tempfile
import time
import uuid

POLICY = '2026-10-15'
RECORD_FIELDS = {'schema_version','policy_version','namespace_id','intent_id','scope','tenant_id','member_id','cutoff_at','prepared_at','completed_at','status'}
SUBJECT_FIELDS = {'scope','tenant_id','member_id','cutoff_at'}

class ManifestError(Exception):
    pass


def timestamp(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', value):
            raise ValueError()
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        raise ManifestError('Invalid manifest timestamp') from None


def utc_now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace('+00:00','Z')


def identifier(value):
    try:
        if str(uuid.UUID(value)) != value: raise ValueError()
        return value
    except (ValueError, TypeError, AttributeError):
        raise ManifestError('Invalid manifest identifier') from None


def validate_subject(subject):
    if not isinstance(subject, dict) or set(subject) != SUBJECT_FIELDS or subject['scope'] not in ('member','tenant'):
        raise ManifestError('Invalid erasure subject')
    identifier(subject['tenant_id'])
    if subject['scope'] == 'member': identifier(subject['member_id'])
    elif subject['member_id'] is not None: raise ManifestError('Invalid tenant erasure scope')
    timestamp(subject['cutoff_at'])
    return subject


def validate_record(record, namespace_id):
    if not isinstance(record, dict) or set(record) != RECORD_FIELDS or (type(record['schema_version']) is not int or record['schema_version'] != 1) or record['policy_version'] != POLICY or record['namespace_id'] != namespace_id:
        raise ManifestError('Invalid erasure manifest')
    identifier(record['namespace_id']); identifier(record['intent_id'])
    validate_subject({key:record[key] for key in SUBJECT_FIELDS})
    prepared = timestamp(record['prepared_at'])
    if timestamp(record['cutoff_at']) > prepared: raise ManifestError('Manifest cutoff exceeds preparation')
    if record['status'] in ('prepared','closure'):
        if record['completed_at'] is not None: raise ManifestError('Invalid preparation status')
    elif record['status'] == 'completed':
        if timestamp(record['completed_at']) < prepared: raise ManifestError('Invalid completion date')
    else: raise ManifestError('Invalid completion status')
    return record


# Tools run in dedicated groups so a stopped CLI cannot leave a late uploader
# or an open maintenance transaction after its caller has rolled back.
ACTIVE_PROCESSES = set()


def start_process(command, **options):
    blocked={signal.SIGTERM,signal.SIGINT}
    previous=signal.pthread_sigmask(signal.SIG_BLOCK,blocked)
    try:
        process=subprocess.Popen(command,start_new_session=True,**options)
        ACTIVE_PROCESSES.add(process)
        return process
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK,previous)


def stop_process(process):
    try: os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError: pass
    try: process.wait(timeout=1)
    except subprocess.TimeoutExpired: pass
    finally: ACTIVE_PROCESSES.discard(process)


def cleanup_processes():
    for process in tuple(ACTIVE_PROCESSES): stop_process(process)


def install_signal_handlers():
    def terminated(signum, frame):
        # Prevent a second termination signal from interrupting group cleanup.
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        signal.signal(signal.SIGINT,signal.SIG_IGN)
        cleanup_processes()
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM,terminated)
    signal.signal(signal.SIGINT,terminated)


def run(command, *, env, data=None, timeout=30):
    process=None
    try:
        process=start_process(command,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                              stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
        try: output,_=process.communicate(input=data,timeout=timeout)
        except subprocess.TimeoutExpired:
            raise ManifestError('Erasure tool deadline exceeded') from None
        if process.returncode: raise ManifestError('Erasure tool failed')
        return output
    except OSError:
        raise ManifestError('Erasure tool unavailable') from None
    finally:
        if process:
            stop_process(process)
            if process.stdin and not process.stdin.closed: process.stdin.close()
            if process.stdout: process.stdout.close()


class Store:
    def __init__(self, env=None, kind='purge'):
        if kind not in ('purge','closure'): raise ManifestError('Invalid archive purpose')
        self.kind=kind
        self.env = dict(os.environ if env is None else env)
        stem='ERASURE_CLOSURE_' if kind=='closure' else 'ERASURE_'
        self.endpoint = self.env.get(stem+'S3_ENDPOINT','')
        self.bucket = self.env.get(stem+'S3_BUCKET','')
        self.prefix = self.env.get(stem+'S3_PREFIX','')
        self.namespace_id = identifier(self.env.get(stem+'NAMESPACE_ID',''))
        self.recipient=self.env.get(stem+'AGE_RECIPIENT') or self.env.get('ERASURE_AGE_RECIPIENT','')
        self.identity=self.env.get(stem+'AGE_IDENTITY_FILE') or self.env.get('ERASURE_AGE_IDENTITY_FILE','')
        if self.env.get('ERASURE_S3_BUCKET') and self.env.get('ERASURE_S3_BUCKET')==self.env.get('ERASURE_CLOSURE_S3_BUCKET'): raise ManifestError('Closure and purge writer buckets must be separate')
        if (not re.fullmatch(r'https://[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com',self.endpoint)
            or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',self.bucket)
            or not re.fullmatch(r'[a-z0-9][a-z0-9/_-]{0,100}',self.prefix)
            or self.prefix.endswith('/') or '//' in self.prefix
            or self.prefix == 'loynara' or self.prefix.startswith('loynara/')
            or not self.env.get(stem+'AWS_ACCESS_KEY_ID') or not self.env.get(stem+'AWS_SECRET_ACCESS_KEY')):
            raise ManifestError('Independent erasure store configuration required')
        self.tool_env = {key:self.env[key] for key in ('PATH','HOME','TMPDIR','LANG') if key in self.env}
        self.aws_env = {**self.tool_env,'AWS_ACCESS_KEY_ID':self.env[stem+'AWS_ACCESS_KEY_ID'],
                        'AWS_SECRET_ACCESS_KEY':self.env[stem+'AWS_SECRET_ACCESS_KEY'], 'AWS_DEFAULT_REGION':'auto',
                        'AWS_MAX_ATTEMPTS':'3','AWS_RETRY_MODE':'standard','AWS_EC2_METADATA_DISABLED':'true',
                        'AWS_CONFIG_FILE':os.devnull,'AWS_SHARED_CREDENTIALS_FILE':os.devnull}

    def aws(self, *arguments):
        return run(['aws','--endpoint-url',self.endpoint,'--cli-connect-timeout','10','--cli-read-timeout','30',*arguments], env=self.aws_env)

    def head(self, key):
        try: return json.loads(self.aws('s3api','head-object','--bucket',self.bucket,'--key',key))
        except (ValueError, TypeError): raise ManifestError('Invalid erasure storage verification') from None

    def verify_namespace(self):
        metadata = self.head(self.prefix + '/namespace.age').get('Metadata',{})
        if metadata.get('namespace') != self.namespace_id or metadata.get('policy') != POLICY or metadata.get('purpose')!=self.kind:
            raise ManifestError('Erasure namespace not initialized or mismatched')
        recipient = self.recipient
        if recipient and metadata.get('recipient_sha256') != hashlib.sha256(recipient.encode()).hexdigest():
            raise ManifestError('Erasure recipient does not match initialized custody')

    def _write(self, key, value):
        recipient = self.recipient
        if not re.fullmatch(r'age1[0-9a-z]{50,100}',recipient): raise ManifestError('Erasure encryption recipient required')
        raw = json.dumps(value,sort_keys=True,separators=(',',':')).encode()
        encrypted = run(['age','-r',recipient],env=self.tool_env,data=raw)
        if not encrypted.startswith(b'age-encryption.org/v1\n'): raise ManifestError('Erasure encryption failed')
        digest = hashlib.sha256(encrypted).hexdigest()
        with tempfile.TemporaryDirectory(prefix='loynara-erasure-') as directory:
            Path(directory).chmod(0o700)
            path = Path(directory)/'manifest.age'
            descriptor = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(descriptor,'wb') as output: output.write(encrypted)
            self.aws('s3','cp',str(path),f's3://{self.bucket}/{key}','--only-show-errors','--metadata',f'namespace={self.namespace_id},policy={POLICY},purpose={self.kind},sha256={digest},recipient_sha256={hashlib.sha256(recipient.encode()).hexdigest()}')
        head = self.head(key)
        if head.get('ContentLength') != len(encrypted) or head.get('Metadata',{}).get('sha256') != digest:
            raise ManifestError('Erasure upload verification failed')
        return key

    def initialize(self):
        # Initialization is exclusive custodian work, never an automatic purge step.
        try: existing = json.loads(self.aws('s3api','list-objects-v2','--bucket',self.bucket,'--prefix',self.prefix+'/namespace.age','--max-keys','2','--no-paginate'))
        except (ValueError, TypeError): raise ManifestError('Namespace initialization could not verify absence') from None
        if existing.get('KeyCount') != 0 or existing.get('Contents') or existing.get('IsTruncated') is not False:
            raise ManifestError('Erasure namespace already exists or cannot be verified')
        return self._write(self.prefix+'/namespace.age',{'schema_version':1,'policy_version':POLICY,'namespace_id':self.namespace_id,'created_at':iso(utc_now())})

    def append(self, record):
        validate_record(record,self.namespace_id)
        if (record['status']=='closure') != (self.kind=='closure'): raise ManifestError('Manifest authority does not match archive purpose')
        return self._write(self.prefix+'/entries/'+str(uuid.uuid4())+'.age',record)

    def _read(self, key):
        identity = Path(self.identity)
        if not identity.is_file() or identity.stat().st_mode & 0o777 not in (0o400,0o600):
            raise ManifestError('Private erasure recovery identity required')
        with tempfile.TemporaryDirectory(prefix='loynara-erasure-read-') as directory:
            Path(directory).chmod(0o700)
            encrypted = Path(directory)/'manifest.age'
            self.aws('s3','cp',f's3://{self.bucket}/{key}',str(encrypted),'--only-show-errors')
            if encrypted.stat().st_size > 65536: raise ManifestError('Oversized erasure manifest')
            plain = run(['age','-d','-i',str(identity),str(encrypted)],env=self.tool_env)
        try: return json.loads(plain)
        except (ValueError, TypeError): raise ManifestError('Invalid decrypted erasure manifest') from None

    def inventory(self):
        objects = {}
        token = None
        tokens = set()
        pages = 0
        while True:
            pages += 1
            if pages > 20: raise ManifestError('Erasure inventory requires bounded operator batches')
            arguments = ['s3api','list-objects-v2','--bucket',self.bucket,'--prefix',self.prefix+'/entries/','--max-keys','1000','--no-paginate']
            if token is not None: arguments += ['--continuation-token',token]
            try: page = json.loads(self.aws(*arguments))
            except (ValueError, TypeError): raise ManifestError('Invalid erasure inventory') from None
            if not isinstance(page,dict) or not isinstance(page.get('Contents',[]),list) or page.get('KeyCount') != len(page.get('Contents',[])):
                raise ManifestError('Incomplete erasure inventory')
            for item in page.get('Contents',[]):
                key = item.get('Key','')
                if not re.fullmatch(re.escape(self.prefix)+r'/entries/[0-9a-f-]{36}\.age',key) or key in objects:
                    raise ManifestError('Unexpected erasure object')
                objects[key] = {field:item.get(field) for field in ('Size','ETag','LastModified')}
                if len(objects) > 10000: raise ManifestError('Erasure inventory requires bounded operator batches')
            if page.get('IsTruncated') is False: return objects
            next_token = page.get('NextContinuationToken')
            if not isinstance(next_token,str) or not next_token or next_token in tokens:
                raise ManifestError('Incomplete erasure pagination')
            tokens.add(next_token)
            token = next_token

    def load_current(self):
        self.verify_namespace()
        anchor = self._read(self.prefix+'/namespace.age')
        if (not isinstance(anchor,dict) or set(anchor) != {'schema_version','policy_version','namespace_id','created_at'}
            or anchor['schema_version'] != 1 or anchor['policy_version'] != POLICY or anchor['namespace_id'] != self.namespace_id):
            raise ManifestError('Invalid erasure namespace identity')
        timestamp(anchor['created_at'])
        inventory = self.inventory()
        records = {}
        self.keys_by_intent = {}
        self.prepared_keys = set()
        for key in sorted(inventory):
            record = validate_record(self._read(key),self.namespace_id)
            if (record['status']=='closure') != (self.kind=='closure'): raise ManifestError('Wrong manifest authority in archive')
            self.keys_by_intent.setdefault(record['intent_id'],[]).append(key)
            if record['status'] in ('prepared','closure'): self.prepared_keys.add(key)
            previous = records.get(record['intent_id'])
            if previous:
                stable = RECORD_FIELDS-({'status','completed_at','prepared_at'} if previous['status']=='closure' and record['status']=='closure' else {'status','completed_at'})
                if any(previous[field] != record[field] for field in stable): raise ManifestError('Conflicting erasure intents')
                if previous['status']=='closure' and record['status']=='closure' and timestamp(previous['prepared_at'])<=timestamp(record['prepared_at']): continue
                if previous['status'] == 'completed':
                    if record['status'] == 'completed' and previous['completed_at'] != record['completed_at']: raise ManifestError('Conflicting erasure completion')
                    continue
            records[record['intent_id']] = record
        return inventory, sorted(records.values(),key=lambda record:(timestamp(record['prepared_at']),record['intent_id']))


    def delete(self, key):
        self.aws('s3api','delete-object','--bucket',self.bucket,'--key',key)

    def backup_times(self):
        endpoint = self.env.get('BACKUP_S3_ENDPOINT','')
        bucket = self.env.get('BACKUP_S3_BUCKET','')
        access = self.env.get('ERASURE_BACKUP_AWS_ACCESS_KEY_ID')
        secret = self.env.get('ERASURE_BACKUP_AWS_SECRET_ACCESS_KEY')
        if (not re.fullmatch(r'https://[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com',endpoint)
            or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',bucket) or not access or not secret):
            raise ManifestError('Independent backup expiry inventory access required')
        env = {**self.aws_env,'AWS_ACCESS_KEY_ID':access,'AWS_SECRET_ACCESS_KEY':secret}
        values = []
        token = None
        tokens = set()
        for _ in range(20):
            args = ['aws','--endpoint-url',endpoint,'--cli-connect-timeout','10','--cli-read-timeout','30','s3api','list-objects-v2','--bucket',bucket,'--prefix','loynara/','--max-keys','1000','--no-paginate']
            if token is not None: args += ['--continuation-token',token]
            try: page = json.loads(run(args,env=env))
            except (ValueError,TypeError): raise ManifestError('Invalid backup expiry inventory') from None
            contents = page.get('Contents',[])
            if not isinstance(contents,list) or page.get('KeyCount') != len(contents): raise ManifestError('Incomplete backup inventory')
            for item in contents:
                key = item.get('Key','')
                match = re.fullmatch(r'loynara/(\d{4}/\d{2}/\d{2})/(\d{8}T\d{6}Z)-[0-9a-f]{12}\.dump\.age',key)
                if not match: raise ManifestError('Unrecognized backup prevents manifest expiry')
                try: created = datetime.strptime(match[2],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                except ValueError: raise ManifestError('Unrecognized backup date') from None
                if created.strftime('%Y/%m/%d') != match[1]: raise ManifestError('Inconsistent backup date')
                modified = timestamp(item.get('LastModified','').replace('+00:00','Z'))
                values.append(min(created,modified))
                if len(values)>10000: raise ManifestError('Backup inventory requires bounded operator review')
            if page.get('IsTruncated') is False: return values
            token = page.get('NextContinuationToken')
            if not isinstance(token,str) or not token or token in tokens: raise ManifestError('Incomplete backup pagination')
            tokens.add(token)
        raise ManifestError('Backup inventory requires bounded operator review')


def covers(purge, intent):
    return (purge['tenant_id']==intent['tenant_id'] and timestamp(purge['cutoff_at'])>=timestamp(intent['cutoff_at'])
            and (purge['scope']=='tenant' or (intent['scope']=='member' and purge['member_id']==intent['member_id'])))


def prune_archive(store, now=utc_now, closure_store=None):
    if store.env.get('ERASURE_PRUNE_CONFIRMED') != 'completed-30-days-and-other-backups-expired':
        raise ManifestError('Custodian backup expiry confirmation required')
    through=timestamp(store.env.get('ERASURE_OTHER_BACKUPS_EXPIRED_THROUGH',''))
    current=now()
    if through>current+timedelta(minutes=5): raise ManifestError('Future backup expiry confirmation refused')
    inventory,records=store.load_current()
    closure_inventory,closures=closure_store.load_current() if closure_store else ({},[])
    completed=[record for record in records if record['status']=='completed' and timestamp(record['completed_at'])+timedelta(days=30)<=current]
    candidates=[]
    closure_candidates=[]
    proofs=[]
    for intent,collection in [(record,candidates) for record in records]+[(record,closure_candidates) for record in closures]:
        matching=[proof for proof in completed if covers(proof,intent)]
        if matching:
            proof=min(matching,key=lambda item:timestamp(item['completed_at']))
            proofs.append(timestamp(proof['completed_at'])); collection.append(intent)
    keys=[]
    closure_keys=[]
    if proofs:
        if any(completed_at>through for completed_at in proofs): raise ManifestError('Other backup copies have not expired')
        backups=store.backup_times()
        if any(backup<=completed_at for completed_at in proofs for backup in backups): raise ManifestError('Older database backups still require erasure manifests')
        if store.inventory()!=inventory or (closure_store and closure_store.inventory()!=closure_inventory): raise ManifestError('Erasure archive changed before pruning')
        closure_keys=[key for record in closure_candidates for key in closure_store.keys_by_intent[record['intent_id']]]
        keys=[key for record in candidates for key in store.keys_by_intent[record['intent_id']]]
        # Covering completion records stay available until every covered closure
        # and prepared copy is gone, including if cleanup crashes midway.
        for key in closure_keys: closure_store.delete(key)
        for key in sorted(keys,key=lambda key:key not in store.prepared_keys): store.delete(key)
        remaining=store.inventory()
        closure_remaining=closure_store.inventory() if closure_store else {}
        if any(key in remaining for key in keys) or any(key in closure_remaining for key in closure_keys): raise ManifestError('Erasure archive deletion could not be verified')
    removed_ids={record['intent_id'] for record in candidates}
    return {'status':'pruned','intents':len(candidates),'closure_intents':len(closure_candidates),'objects':len(keys)+len(closure_keys),
            'unresolved_prepared':sum(record['status']=='prepared' and record['intent_id'] not in removed_ids for record in records),
            'retained_closure_intents':len(closures)-len(closure_candidates)}


HOLD_FIELDS = {'tenant_uuid','member_uuid','categories','basis','reason','custodian','review_at','release_condition'}
HOLD_CATEGORIES = {'membership','ledger','redemptions','purchases','consent','security','tenant'}


def load_holds_file(env, now=utc_now):
    path = Path(env.get('RESTORE_CURRENT_HOLDS_FILE',''))
    if not path.is_file() or path.stat().st_mode & 0o777 not in (0o400,0o600) or path.stat().st_uid != os.getuid() or path.stat().st_size>1048576:
        raise ManifestError('Private current hold checkpoint required')
    try: value = json.loads(path.read_bytes())
    except (ValueError,OSError): raise ManifestError('Invalid current hold checkpoint') from None
    if (not isinstance(value,dict) or set(value)!={'schema_version','generated_at','holds'}
        or type(value['schema_version']) is not int or value['schema_version']!=1
        or not isinstance(value['holds'],list) or len(value['holds'])>1000):
        raise ManifestError('Invalid current hold checkpoint')
    generated = timestamp(value['generated_at'])
    current = now()
    if generated<current-timedelta(minutes=15) or generated>current+timedelta(minutes=5): raise ManifestError('Stale current hold checkpoint')
    for hold in value['holds']:
        if not isinstance(hold,dict) or set(hold)!=HOLD_FIELDS: raise ManifestError('Invalid hold record')
        identifier(hold['tenant_uuid'])
        if hold['member_uuid'] is not None: identifier(hold['member_uuid'])
        categories = hold['categories']
        if (not isinstance(categories,list) or not categories or len(categories)>7
            or any(not isinstance(category,str) or category not in HOLD_CATEGORIES for category in categories)
            or len(categories)!=len(set(categories))): raise ManifestError('Invalid hold categories')
        for field,maximum in (('basis',500),('reason',1000),('custodian',300),('release_condition',1000)):
            text = hold[field]
            if not isinstance(text,str) or not text.strip() or len(text)>maximum or '\x00' in text: raise ManifestError('Invalid hold field')
        review = timestamp(hold['review_at'])
        if review<=current or review>current+timedelta(days=30): raise ManifestError('Hold review requires current custodian action')
    return value['holds']


def sql_literal(value):
    # All fields have already passed the strict hold schema; the connection
    # fixes standard_conforming_strings=on, and quotes remain data.
    return "'"+value.replace("'","''")+"'"


def apply_current_holds(holds, session_factory):
    applied=0
    skipped=0
    if not holds: return {'holds_applied':0,'holds_skipped':0}
    with session_factory() as session:
        for hold in holds:
            tenant = sql_literal(hold['tenant_uuid'])+'::uuid'
            member = 'NULL' if hold['member_uuid'] is None else sql_literal(hold['member_uuid'])+'::uuid'
            subject = session.query(f"SELECT CASE WHEN {member} IS NOT NULL AND EXISTS(SELECT 1 FROM public.memberships WHERE id={member} AND tenant_id<>{tenant}) THEN 'mismatch' WHEN EXISTS(SELECT 1 FROM public.tenants WHERE id={tenant}) AND ({member} IS NULL OR EXISTS(SELECT 1 FROM public.memberships WHERE tenant_id={tenant} AND id={member})) THEN 'present' ELSE 'missing' END;")
            if subject=='missing': skipped+=1; continue
            if subject!='present': raise ManifestError('Current hold subject mismatch')
            categories = 'ARRAY['+','.join(sql_literal(category) for category in sorted(hold['categories']))+']::text[]'
            fields = [sql_literal(hold[key]) for key in ('basis','reason','custodian','review_at','release_condition')]
            existing = session.query(f"SELECT CASE WHEN EXISTS(SELECT 1 FROM public.retention_holds WHERE tenant_id={tenant} AND membership_id IS NOT DISTINCT FROM {member} AND released_at IS NULL AND categories={categories} AND legal_basis={fields[0]} AND reason={fields[1]} AND custodian={fields[2]} AND review_at={fields[3]}::timestamptz AND release_condition={fields[4]}) THEN 'existing' ELSE 'new' END;")
            if existing=='existing': skipped+=1; continue
            if existing!='new': raise ManifestError('Invalid current hold comparison')
            session.query('SET ROLE loynara_maintenance;')
            session.query(f"SELECT public.loynara_set_retention_hold({tenant},{member},{categories},{fields[0]},{fields[1]},{fields[2]},{fields[3]}::timestamptz,{fields[4]});")
            session.query('RESET ROLE;')
            applied+=1
        session.commit()
    return {'holds_applied':applied,'holds_skipped':skipped}


def record_closure(request, store, now=utc_now):
    if not isinstance(request,dict) or set(request)!=SUBJECT_FIELDS|{'intent_id'}: raise ManifestError('Invalid closure intent')
    subject=validate_subject({key:request[key] for key in SUBJECT_FIELDS})
    identifier(request['intent_id'])
    record={'schema_version':1,'policy_version':POLICY,'namespace_id':store.namespace_id,'intent_id':request['intent_id'],
            **subject,'prepared_at':iso(now()),'completed_at':None,'status':'closure'}
    validate_record(record,store.namespace_id)
    store.verify_namespace(); store.append(record)


def purge_subject(subject, store, session_factory, now=utc_now):
    validate_subject(subject)
    prepared_at = iso(now())
    if timestamp(subject['cutoff_at']) > timestamp(prepared_at): raise ManifestError('Future erasure cutoff refused')
    store.verify_namespace()
    with session_factory() as session:
        if not session.prepare(subject): return False
        record = {'schema_version':1,'policy_version':POLICY,'namespace_id':store.namespace_id,'intent_id':str(uuid.uuid4()),
                  **subject,'prepared_at':prepared_at,'completed_at':None,'status':'prepared'}
        store.append(record)
        session.purge(subject)
        session.commit()
    record = {**record,'status':'completed','completed_at':iso(now())}
    store.append(record)
    return True


REPLAY_AUTHORITY_SQL = """
WITH signatures(signature) AS (VALUES
 ('public.loynara_prepare_erasure(text,uuid,uuid,timestamp with time zone)'),
 ('public.loynara_purge_member(uuid,timestamp with time zone)'),
 ('public.loynara_purge_tenant(uuid,timestamp with time zone)'),
 ('public.loynara_replay_erasure(text,uuid,uuid,timestamp with time zone,uuid)'),
 ('public.loynara_replay_closure(text,uuid,uuid,timestamp with time zone,uuid)'),
 ('public.loynara_prune_expired(integer)'),
 ('public.loynara_set_retention_hold(uuid,uuid,text[],text,text,text,timestamp with time zone,text)')),
functions AS (SELECT p.* FROM signatures s JOIN pg_proc p ON p.oid=to_regprocedure(s.signature)),
roles AS (SELECT * FROM pg_roles WHERE rolname IN ('loynara_purge_owner','loynara_maintenance','loynara_restore'))
SELECT CASE WHEN (SELECT count(*) FROM roles)=3
 AND NOT EXISTS (SELECT 1 FROM roles WHERE rolsuper OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication OR rolbypassrls)
 AND (SELECT count(*) FROM functions)=7
 AND NOT EXISTS (SELECT 1 FROM functions p WHERE NOT p.prosecdef
   OR pg_get_userbyid(p.proowner)<>'loynara_purge_owner'
   OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) config WHERE replace(config,' ','') IN ('search_path=pg_catalog','search_path=pg_catalog,public'))
   OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
   OR CASE WHEN p.proname IN ('loynara_replay_erasure','loynara_replay_closure') THEN
      NOT has_function_privilege('loynara_restore',p.oid,'EXECUTE') OR has_function_privilege('loynara_maintenance',p.oid,'EXECUTE')
      ELSE NOT has_function_privilege('loynara_maintenance',p.oid,'EXECUTE') OR has_function_privilege('loynara_restore',p.oid,'EXECUTE') END)
 THEN 'ok' ELSE 'unsafe' END;
"""


def validate_restore_environment(env):
    if (env.get('RESTORE_ERASURE_CHECKPOINT_CONFIRMED') != 'current-writers-paused'
        or env.get('RESTORE_TRANSPORTS_CONFIRMED') != 'disabled'
        or env.get('RESTORE_LEGAL_HOLDS_CONFIRMED') != 'current'
        or env.get('RESTORE_TARGET_CONFIRMED') != 'isolated'
        or env.get('PGHOST') != env.get('RESTORE_PGHOST')
        or env.get('PGDATABASE') != env.get('RESTORE_PGDATABASE')
        or not env.get('PGDATABASE','').startswith('loynara_restore_')
        or not env.get('PRODUCTION_PGHOST') or env.get('PGHOST') == env.get('PRODUCTION_PGHOST')):
        raise ManifestError('Confirmed isolated current-checkpoint restore required')
    if env.get('VAPID_PRIVATE_KEY'): raise ManifestError('Restore push transport must be absent')
    for name in ('EXTERNAL_EMAIL_ENABLED','PROMOTIONAL_EXTERNAL_EMAIL_ENABLED','TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED','GOOGLE_WALLET_ENABLED','APPLE_WALLET_ENABLED','PASSFAST_ENABLED'):
        if env.get(name) != 'false': raise ManifestError('Explicitly disabled restore transports required')


class Session:
    def __init__(self, env=None, role='loynara_maintenance'):
        if role not in (None,'loynara_maintenance','loynara_restore'): raise ManifestError('Invalid maintenance authority')
        self.role = role
        self.env = dict(os.environ if env is None else env)
        self.process = None
        self.buffer = b''
        self.committed = False

    def __enter__(self):
        host = self.env.get('PGHOST','')
        local = (host == '127.0.0.1' and self.env.get('ERASURE_ALLOW_LOCAL_ISOLATED') == 'true'
                 and self.env.get('PGPORT','').isdigit() and self.env.get('PGPORT') != '5432'
                 and (self.env.get('PGDATABASE','').startswith('loynara_') or self.env.get('PGDATABASE') == 'looplocal_test') and self.env.get('ERASURE_EXPECTED_DATA_DIRECTORY'))
        if not (local or (host.endswith('.railway.internal') and self.env.get('PRODUCTION_ENVIRONMENT') == 'loynara-production')):
            raise ManifestError('Explicit maintenance target required')
        if self.env.get('ERASURE_POLICY_APPROVED') != POLICY: raise ManifestError('Approved erasure policy required')
        self.env.update(PGCONNECT_TIMEOUT='10',PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=120000 -c search_path=pg_catalog -c standard_conforming_strings=on')
        try: self.process = start_process(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=self.env)
        except OSError: raise ManifestError('Maintenance client unavailable') from None
        try:
            if local and Path(self.query('SHOW data_directory;')).resolve() != Path(self.env['ERASURE_EXPECTED_DATA_DIRECTORY']).resolve():
                raise ManifestError('Maintenance target ownership mismatch')
            if self.query(REPLAY_AUTHORITY_SQL) != 'ok': raise ManifestError('Maintenance authority is not safely provisioned')
            self.query('BEGIN;'+(' SET ROLE '+self.role+';' if self.role else ''))
            return self
        except BaseException:
            self.__exit__(*sys.exc_info()); raise

    def query(self, statement):
        marker = str(uuid.uuid4())
        try:
            self.process.stdin.write((statement+'\n\\echo '+marker+'\n').encode()); self.process.stdin.flush()
            deadline = time.monotonic()+30
            lines = []
            while True:
                while b'\n' in self.buffer:
                    line,self.buffer = self.buffer.split(b'\n',1)
                    decoded = line.decode().strip()
                    if decoded == marker: return '\n'.join(lines).strip()
                    lines.append(decoded)
                remaining = deadline-time.monotonic()
                if remaining <= 0 or not select.select([self.process.stdout],[],[],remaining)[0]: raise ManifestError('Maintenance query deadline exceeded')
                chunk = os.read(self.process.stdout.fileno(),65536)
                if not chunk: raise ManifestError('Maintenance transaction refused')
                self.buffer += chunk
                if len(self.buffer) > 65536 or len(lines)>100: raise ManifestError('Unexpected maintenance output')
        except (OSError, UnicodeError): raise ManifestError('Maintenance transaction failed') from None

    def prepare(self, subject):
        member = "NULL" if subject['member_id'] is None else "'"+subject['member_id']+"'::uuid"
        output = self.query(f"SELECT public.loynara_prepare_erasure('{subject['scope']}', '{subject['tenant_id']}'::uuid, {member}, '{subject['cutoff_at']}'::timestamptz);")
        if output not in ('t','f'): raise ManifestError('Invalid maintenance eligibility result')
        return output == 't'

    def purge(self, subject):
        name = 'loynara_purge_member' if subject['scope'] == 'member' else 'loynara_purge_tenant'
        value = subject['member_id'] if subject['scope'] == 'member' else subject['tenant_id']
        if self.query(f"SELECT public.{name}('{value}'::uuid, '{subject['cutoff_at']}'::timestamptz);") != 't':
            raise ManifestError('Prepared erasure subject changed')

    def replay(self, record):
        member = "NULL" if record['member_id'] is None else "'"+record['member_id']+"'::uuid"
        function='loynara_replay_closure' if record['status']=='closure' else 'loynara_replay_erasure'
        self.query(f"SELECT public.{function}('{record['scope']}', '{record['tenant_id']}'::uuid, {member}, '{record['cutoff_at']}'::timestamptz, '{record['intent_id']}'::uuid);")

    def commit(self):
        self.query('COMMIT;'); self.committed = True

    def __exit__(self, *args):
        if not self.process: return
        try:
            self.process.stdin.write((('' if self.committed else 'ROLLBACK;\n')+'\\q\n').encode()); self.process.stdin.flush()
            self.process.wait(timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            if self.process.poll() is None: os.killpg(self.process.pid,signal.SIGKILL)
            self.process.wait()
        finally:
            stop_process(self.process)
            self.process.stdin.close(); self.process.stdout.close()


def checkpoint_digest(inventories):
    return hashlib.sha256(json.dumps(inventories,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def replay_current(store, session_factory, closure_store=None):
    inventory,records=store.load_current()
    inventories={'purge':inventory}
    if closure_store:
        closure_inventory,closures=closure_store.load_current()
        inventories['closure']=closure_inventory
        records+=closures
    records.sort(key=lambda record:(timestamp(record['cutoff_at']),0 if record['status']=='closure' else 1,record['intent_id']))
    with session_factory() as session: session.commit()
    for record in records:
        with session_factory() as session:
            session.replay(record); session.commit()
    final={'purge':store.inventory()}
    if closure_store: final['closure']=closure_store.inventory()
    if final!=inventories: raise ManifestError('Erasure checkpoint changed during restore')
    return {'status':'replayed','intents':len(records),'closure_intents':sum(record['status']=='closure' for record in records),
            'checkpoint_sha256':checkpoint_digest(inventories),'checkpoint_at':iso(utc_now())}


def prune_restored_expiry(session_factory, max_iterations=20, max_seconds=120, clock=time.monotonic):
    started=clock()
    total=0
    for iteration in range(1,max_iterations+1):
        if clock()-started>=max_seconds: raise ManifestError('Restored expiry backlog exceeds recovery deadline')
        with session_factory() as session:
            try: counts=json.loads(session.query('SELECT public.loynara_prune_expired(1000)::text;'))
            except (ValueError,TypeError): raise ManifestError('Invalid restored expiry measurement') from None
            if (not isinstance(counts,dict) or not counts or len(counts)>100
                or any(not isinstance(key,str) or not re.fullmatch(r'[a-z_]{1,63}',key) or type(count) is not int or count<0 or count>1000 for key,count in counts.items())):
                raise ManifestError('Invalid restored expiry measurement')
            session.commit()
        removed=sum(counts.values())
        total+=removed
        if removed==0: return {'expiry_prune_count':total,'expiry_prune_batches':iteration}
    raise ManifestError('Restored expiry backlog remains; no recovery signoff')


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise ManifestError('Invalid erasure command')


def main():
    parser = SafeParser(description='Independent encrypted erasure archive; no raw subject output')
    parser.add_argument('operation',choices=['initialize','initialize-closures','record-closure','purge','replay','verify','check-namespace','prune','verify-holds'])
    args = parser.parse_args()
    store = Store(kind='closure' if args.operation in ('initialize-closures','record-closure') else 'purge')
    if args.operation in ('initialize','initialize-closures'):
        if os.environ.get('ERASURE_INITIALIZE_CONFIRMED') != 'new-protected-namespace': raise ManifestError('Explicit namespace initialization required')
        store.initialize(); result = {'status':'initialized'}
    elif args.operation == 'check-namespace':
        store.verify_namespace(); Store(kind='closure').verify_namespace(); result = {'status':'ready'}
    elif args.operation == 'prune':
        result = prune_archive(store,closure_store=Store(kind='closure'))
    elif args.operation in ('purge','record-closure'):
        if os.environ.get('ERASURE_POLICY_APPROVED') != POLICY: raise ManifestError('Approved erasure policy required')
        raw = sys.stdin.buffer.read(4097)
        if len(raw)>4096: raise ManifestError('Oversized erasure request')
        try: subject = json.loads(raw)
        except ValueError: raise ManifestError('Invalid erasure request') from None
        if args.operation=='record-closure':
            record_closure(subject,store); result={'status':'recorded'}
        else: result = {'status':'completed','purged':purge_subject(subject,store,Session)}
    elif args.operation == 'verify-holds':
        validate_restore_environment(os.environ)
        result = {'status':'verified','holds':len(load_holds_file(os.environ))}
    elif args.operation == 'replay':
        validate_restore_environment(os.environ)
        holds = load_holds_file(os.environ)
        holds_digest=hashlib.sha256(Path(os.environ['RESTORE_CURRENT_HOLDS_FILE']).read_bytes()).hexdigest()
        hold_result = apply_current_holds(holds,lambda:Session(role=None))
        closure_store=Store(kind='closure')
        result = {**replay_current(store,lambda:Session(role='loynara_restore'),closure_store),**hold_result,**prune_restored_expiry(Session)}
        final_inventory=checkpoint_digest({'purge':store.inventory(),'closure':closure_store.inventory()})
        if final_inventory!=result['checkpoint_sha256'] or hashlib.sha256(Path(os.environ['RESTORE_CURRENT_HOLDS_FILE']).read_bytes()).hexdigest()!=holds_digest:
            raise ManifestError('Recovery checkpoints changed during reconciliation')
    else:
        inventory,records = store.load_current()
        closure_inventory,closures=Store(kind='closure').load_current()
        result = {'status':'verified','intents':len(records)+len(closures),'objects':len(inventory)+len(closure_inventory)}
    print(json.dumps(result,sort_keys=True))

if __name__ == '__main__':
    install_signal_handlers()
    try: main()
    except Exception:
        print('Erasure operation failed; diagnostic details withheld.',file=sys.stderr)
        sys.exit(1)
    finally: cleanup_processes()
