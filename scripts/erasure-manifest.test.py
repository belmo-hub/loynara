"""Synthetic erasure-intent contract checks; no hosted service or existing database."""
import importlib.util
import sys
sys.dont_write_bytecode = True
import pathlib
import hashlib
import json
import os
import shutil
import subprocess
import signal
import time
import tempfile
import uuid
import unittest
from datetime import datetime, timezone, timedelta

SPEC = importlib.util.spec_from_file_location('erasure_manifest', pathlib.Path(__file__).with_name('erasure_manifest.py'))
manifest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manifest)

TENANT = '11111111-1111-4111-8111-111111111111'
MEMBER = '22222222-2222-4222-8222-222222222222'
SUBJECT = {'scope': 'member', 'tenant_id': TENANT, 'member_id': MEMBER, 'cutoff_at': '2026-10-15T09:00:00Z'}

class ChildProcessCleanup(unittest.TestCase):
    def test_termination_of_cli_kills_detached_blocking_transport_group(self):
        with tempfile.TemporaryDirectory(prefix='loynara-child-cleanup-') as directory:
            root=pathlib.Path(directory); pidfile=root/'pid'
            runner=root/'runner.py'
            command=[sys.executable,'-c',"import os,time,pathlib;pathlib.Path("+repr(str(pidfile))+").write_text(str(os.getpid()));time.sleep(30)"]
            runner.write_text("import importlib.util,sys,os\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('manifest',sys.argv[1])\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ngetattr(m,'install_signal_handlers',lambda:None)()\nm.run("+repr(command)+",env=dict(os.environ))\n")
            process=subprocess.Popen([sys.executable,str(runner),str(pathlib.Path(__file__).with_name('erasure_manifest.py'))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            child=None
            try:
                deadline=time.monotonic()+3
                while not pidfile.exists() and time.monotonic()<deadline and process.poll() is None: time.sleep(.01)
                self.assertTrue(pidfile.exists(),'blocking transport did not start')
                child=int(pidfile.read_text())
                process.terminate(); process.wait(timeout=3)
                deadline=time.monotonic()+2
                while time.monotonic()<deadline:
                    state=subprocess.run(['ps','-o','stat=','-p',str(child)],capture_output=True,text=True).stdout.strip()
                    if not state or state.startswith('Z'): break
                    time.sleep(.01)
                self.assertTrue(not state or state.startswith('Z'),'detached transport survived CLI termination')
            finally:
                if process.poll() is None: process.kill(); process.wait()
                if child:
                    try: os.killpg(child,signal.SIGKILL)
                    except ProcessLookupError: pass

    def test_internal_tool_deadline_reaps_blocked_child(self):
        with tempfile.TemporaryDirectory(prefix='loynara-child-deadline-') as directory:
            path=pathlib.Path(directory)/'pid'
            command=[sys.executable,'-c',"import os,time,pathlib;pathlib.Path("+repr(str(path))+").write_text(str(os.getpid()));time.sleep(30)"]
            with self.assertRaises(manifest.ManifestError): manifest.run(command,env=dict(os.environ),timeout=.15)
            child=int(path.read_text())
            with self.assertRaises(ProcessLookupError): os.kill(child,0)

class PreparedIntent(unittest.TestCase):
    def workflow(self, failure=None, eligible=True):
        effects = []
        class Store:
            namespace_id = '33333333-3333-4333-8333-333333333333'
            def verify_namespace(self): effects.append('namespace')
            def append(self, record):
                effects.append(record['status'])
                manifest.validate_record(record, self.namespace_id)
                if record['status'] == failure: raise manifest.ManifestError('unavailable')
        class Session:
            def __enter__(self): effects.append('begin'); return self
            def __exit__(self, *args): effects.append('end')
            def prepare(self, subject): effects.append('lock-and-check'); return eligible
            def purge(self, subject): effects.append('purge')
            def commit(self): effects.append('commit')
        return effects, lambda: manifest.purge_subject(SUBJECT, Store(), Session, now=lambda: datetime(2026,10,15,9,1,tzinfo=timezone.utc))

    def test_prepared_intent_is_verified_before_purge_and_completion_follows_commit(self):
        effects, run = self.workflow()
        self.assertTrue(run())
        self.assertEqual(effects, ['namespace','begin','lock-and-check','prepared','purge','commit','end','completed'])

    def test_unavailable_prepared_archive_never_runs_irreversible_purge(self):
        effects, run = self.workflow(failure='prepared')
        with self.assertRaises(manifest.ManifestError): run()
        self.assertNotIn('purge', effects)
        self.assertNotIn('commit', effects)

    def test_completion_upload_failure_keeps_a_prepared_recovery_intent(self):
        effects, run = self.workflow(failure='completed')
        with self.assertRaises(manifest.ManifestError): run()
        self.assertEqual(effects[-3:], ['commit','end','completed'])
        self.assertIn('prepared', effects)

    def test_ineligible_or_missing_subject_never_creates_an_erasure_intent(self):
        effects, run = self.workflow(eligible=False)
        self.assertFalse(run())
        self.assertNotIn('prepared', effects)
        self.assertNotIn('purge', effects)

    def test_subject_contract_rejects_extra_personal_data_and_malformed_scope(self):
        for subject in ({**SUBJECT,'email':'private@example.test'}, {**SUBJECT,'scope':'all'}, {**SUBJECT,'member_id':None}, {**SUBJECT,'tenant_id':'not-a-uuid'}, {**SUBJECT,'cutoff_at':'2026-10-15'}):
            with self.subTest(subject=subject):
                with self.assertRaises(manifest.ManifestError): manifest.validate_subject(subject)

class CurrentHoldCheckpoint(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='loynara-private-holds-')
        self.addCleanup(self.temp.cleanup)
        self.path = pathlib.Path(self.temp.name)/'holds.json'
        self.current = datetime(2026,10,15,9,0,tzinfo=timezone.utc)
        self.value = {'schema_version':1,'generated_at':'2026-10-15T09:00:00Z','holds':[]}
        self.env = {'RESTORE_CURRENT_HOLDS_FILE':str(self.path)}

    def load(self):
        self.path.write_text(json.dumps(self.value)); self.path.chmod(0o600)
        return manifest.load_holds_file(self.env,now=lambda:self.current)

    def test_empty_fresh_verified_checkpoint_and_private_file_permissions(self):
        self.assertEqual(self.load(),[])
        self.path.chmod(0o644)
        with self.assertRaises(manifest.ManifestError): manifest.load_holds_file(self.env,now=lambda:self.current)

    def test_stale_or_extra_fields_and_invalid_hold_types_are_refused(self):
        self.value['generated_at']='2026-10-15T08:44:59Z'
        with self.assertRaises(manifest.ManifestError): self.load()
        self.value['generated_at']='2026-10-15T09:00:00Z'
        valid = {'tenant_uuid':TENANT,'member_uuid':MEMBER,'categories':['ledger'],'basis':'Specific synthetic basis','reason':'Synthetic preservation','custodian':'Synthetic operator','review_at':'2026-10-16T09:00:00Z','release_condition':'Synthetic review'}
        self.value['holds']=[valid]
        self.assertEqual(self.load(),[valid])
        for changed in ({**valid,'email':'private@example.test'},{**valid,'categories':['all']},{**valid,'basis':'x'*501},{**valid,'member_uuid':'bad'},{**valid,'review_at':'2026-10-14T09:00:00Z'}):
            self.value['holds']=[changed]
            with self.subTest(changed=changed):
                with self.assertRaises(manifest.ManifestError): self.load()


class RestoredExpiry(unittest.TestCase):
    def factory(self, results):
        calls=[]
        class Session:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def query(self,statement): calls.append(statement); return json.dumps(results.pop(0))
            def commit(self): pass
        return calls,Session

    def test_batches_until_all_category_counts_zero(self):
        calls,session=self.factory([{'session':1000,'rate_limits':2},{'session':1,'rate_limits':0},{'session':0,'rate_limits':0}])
        result=manifest.prune_restored_expiry(session)
        self.assertEqual(result,{'expiry_prune_count':1003,'expiry_prune_batches':3})
        self.assertEqual(len(calls),3)

    def test_backlog_and_invalid_measurement_withhold_signoff(self):
        for results in ([{'session':1}]*3,[{}],[{'session':-1}],[{'session':True}]):
            calls,session=self.factory(list(results))
            with self.subTest(results=results):
                with self.assertRaises(manifest.ManifestError): manifest.prune_restored_expiry(session,max_iterations=3)


class CustodianPruning(unittest.TestCase):
    def fixture(self, completed=True):
        record = {'schema_version':1,'policy_version':manifest.POLICY,'namespace_id':'33333333-3333-4333-8333-333333333333',
            'intent_id':'55555555-5555-4555-8555-555555555555',**SUBJECT,'prepared_at':'2026-10-15T09:01:00Z',
            'completed_at':'2026-10-15T09:02:00Z' if completed else None,'status':'completed' if completed else 'prepared'}
        class Store:
            env = {'ERASURE_PRUNE_CONFIRMED':'completed-30-days-and-other-backups-expired','ERASURE_OTHER_BACKUPS_EXPIRED_THROUGH':'2026-11-14T09:02:00Z'}
            keys_by_intent = {record['intent_id']:['prepared','completed'] if completed else ['prepared']}
            objects = {key:{} for key in keys_by_intent[record['intent_id']]}
            deleted = []
            prepared_keys = {'prepared'}
            backups = []
            def load_current(self): return dict(self.objects),[record]
            def inventory(self): return dict(self.objects)
            def backup_times(self): return self.backups
            def delete(self,key): self.deleted.append(key); del self.objects[key]
        return Store()

    def test_30_elapsed_days_boundary_and_completed_object_removed_last(self):
        store = self.fixture()
        threshold = datetime(2026,11,14,9,2,tzinfo=timezone.utc)
        result = manifest.prune_archive(store,now=lambda:threshold-timedelta(microseconds=1))
        self.assertEqual(result['intents'],0)
        self.assertEqual(store.deleted,[])
        result = manifest.prune_archive(store,now=lambda:threshold)
        self.assertEqual(result['intents'],1)
        self.assertEqual(store.deleted,['prepared','completed'])

    def test_prepared_only_never_expires_by_age(self):
        store = self.fixture(completed=False)
        result = manifest.prune_archive(store,now=lambda:datetime(2030,1,1,tzinfo=timezone.utc))
        self.assertEqual(result['intents'],0)
        self.assertEqual(result['unresolved_prepared'],1)
        self.assertEqual(store.deleted,[])

    def test_current_older_backup_blocks_deletion(self):
        store = self.fixture()
        store.backups = [datetime(2026,10,15,9,1,tzinfo=timezone.utc)]
        with self.assertRaises(manifest.ManifestError): manifest.prune_archive(store,now=lambda:datetime(2026,11,14,9,2,tzinfo=timezone.utc))
        self.assertEqual(store.deleted,[])

    def test_confirmation_and_external_copy_expiry_required_before_deletion(self):
        for env in ({}, {'ERASURE_PRUNE_CONFIRMED':'completed-30-days-and-other-backups-expired'},
                    {'ERASURE_PRUNE_CONFIRMED':'completed-30-days-and-other-backups-expired','ERASURE_OTHER_BACKUPS_EXPIRED_THROUGH':'2026-10-14T09:00:00Z'}):
            store = self.fixture(); store.env = env
            with self.subTest(env=env):
                with self.assertRaises(manifest.ManifestError): manifest.prune_archive(store,now=lambda:datetime(2026,11,14,9,2,tzinfo=timezone.utc))
                self.assertEqual(store.deleted,[])

    def test_decryption_failure_prevents_any_deletion(self):
        store = self.fixture()
        def unavailable(): raise manifest.ManifestError('Cannot authenticate ciphertext')
        store.load_current = unavailable
        with self.assertRaises(manifest.ManifestError): manifest.prune_archive(store,now=lambda:datetime(2026,11,14,9,2,tzinfo=timezone.utc))
        self.assertEqual(store.deleted,[])


class EncryptedIndependentStore(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='loynara-erasure-contract-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.root.chmod(0o700)
        self.objects = self.root / 'objects'
        self.objects.mkdir(mode=0o700)
        self.bin = self.root / 'bin'
        self.bin.mkdir(mode=0o700)
        self.identity = self.root / 'identity'
        keygen = shutil.which('age-keygen')
        if not keygen or not shutil.which('age'): raise RuntimeError('Existing age tools required; installs nothing')
        generated = subprocess.run([keygen,'-o',str(self.identity)],capture_output=True)
        self.assertEqual(generated.returncode,0)
        self.identity.chmod(0o600)
        recipient = subprocess.run([keygen,'-y',str(self.identity)],capture_output=True,text=True)
        self.assertEqual(recipient.returncode,0)
        adapter = self.bin / 'aws'
        adapter.write_text('#!/usr/bin/env python3\nROOT = ' + repr(str(self.objects)) + '\nMODE = ' + repr(str(self.root/'transport-mode')) + '\n' + r"""
import json, pathlib, shutil, sys
root = pathlib.Path(ROOT).resolve()
args = sys.argv[1:]
assert args[:2] == ['--endpoint-url','https://'+'0'*32+'.eu.r2.cloudflarestorage.com']
args = args[2:]
while args and args[0] in ('--cli-connect-timeout','--cli-read-timeout'): args = args[2:]
mode = pathlib.Path(MODE).read_text() if pathlib.Path(MODE).exists() else ''
def path(uri):
    bucket,_,key = uri.removeprefix('s3://').partition('/')
    assert bucket in ('synthetic-erasure','synthetic-closure')
    base = root if bucket=='synthetic-erasure' else root/'closure-objects'
    value = (base / key).resolve()
    assert value.is_relative_to(root)
    return value
def value(flag): return args[args.index(flag)+1]
if args[:2] == ['s3','cp']:
    source,target = args[2:4]
    if source.startswith('s3://'): shutil.copyfile(path(source),target)
    else:
        if mode == 'upload':
            print('private-customer@example.test synthetic-secret',file=sys.stderr)
            sys.exit(7)
        output = path(target)
        output.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,output)
        output.with_suffix('.metadata').write_text(json.dumps(dict(part.split('=',1) for part in value('--metadata').split(','))))
elif args[:2] == ['s3api','head-object']:
    output = path('s3://'+value('--bucket')+'/'+value('--key'))
    print(json.dumps({'ContentLength':output.stat().st_size,'Metadata':json.loads(output.with_suffix('.metadata').read_text())}))
elif args[:2] == ['s3api','delete-object']:
    output = path('s3://'+value('--bucket')+'/'+value('--key'))
    output.unlink(); output.with_suffix('.metadata').unlink()
    print('{}')
elif args[:2] == ['s3api','list-objects-v2']:
    bucket = value('--bucket')
    assert bucket in ('synthetic-erasure','synthetic-closure','synthetic-backups')
    if mode == 'list': sys.exit(8)
    prefix = value('--prefix')
    found = []
    listing_root = root if bucket == 'synthetic-erasure' else root/('closure-objects' if bucket=='synthetic-closure' else 'backup-objects')
    for output in sorted(listing_root.rglob('*.age')):
        key = str(output.relative_to(listing_root))
        if key.startswith(prefix):
            found.append({'Key':key,'Size':output.stat().st_size,'ETag':str(output.stat().st_mtime_ns),'LastModified':'2026-10-15T09:00:00+00:00'})
    print(json.dumps({'Contents':found,'KeyCount':len(found),'IsTruncated':False}))
else: raise RuntimeError('Unexpected private filesystem transport call')
""")
        adapter.chmod(0o700)
        self.env = {key:os.environ[key] for key in ('PATH','HOME','TMPDIR','LANG') if key in os.environ}
        self.env.update(PATH=str(self.bin)+os.pathsep+self.env['PATH'],
            ERASURE_S3_ENDPOINT='https://'+'0'*32+'.eu.r2.cloudflarestorage.com',ERASURE_S3_BUCKET='synthetic-erasure',
            ERASURE_S3_PREFIX='erasure-v1',ERASURE_NAMESPACE_ID='33333333-3333-4333-8333-333333333333',
            ERASURE_AWS_ACCESS_KEY_ID='synthetic-access',ERASURE_AWS_SECRET_ACCESS_KEY='synthetic-secret',
            ERASURE_AGE_RECIPIENT=recipient.stdout.strip(),ERASURE_AGE_IDENTITY_FILE=str(self.identity),
            BACKUP_S3_ENDPOINT='https://'+'0'*32+'.eu.r2.cloudflarestorage.com',BACKUP_S3_BUCKET='synthetic-backups',
            ERASURE_BACKUP_AWS_ACCESS_KEY_ID='synthetic-readonly-backup',ERASURE_BACKUP_AWS_SECRET_ACCESS_KEY='synthetic-readonly-secret')
        self.store = manifest.Store(self.env)
        self.store.initialize()

    def record(self, status='prepared', intent_id=None, scope='member'):
        return {'schema_version':1,'policy_version':manifest.POLICY,'namespace_id':self.store.namespace_id,
            'intent_id':intent_id or str(uuid.uuid4()),**SUBJECT,'scope':scope,'member_id':MEMBER if scope == 'member' else None,
            'prepared_at':'2026-10-15T09:01:00Z','completed_at':None if status in ('prepared','closure') else '2026-10-15T09:02:00Z','status':status}

    def test_encryption_upload_verification_and_namespace_are_real(self):
        self.store.append(self.record())
        objects = list(self.objects.rglob('*.age'))
        self.assertEqual(len(objects),2)
        for path in objects:
            ciphertext = path.read_bytes()
            self.assertTrue(ciphertext.startswith(b'age-encryption.org/v1\n'))
            self.assertNotIn(TENANT.encode(),ciphertext)
            self.assertNotIn(MEMBER.encode(),ciphertext)
        inventory,records = self.store.load_current()
        self.assertEqual(len(inventory),1)
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['member_id'],MEMBER)
        with self.assertRaises(manifest.ManifestError): self.store.initialize()

    def test_prepared_and_completed_intents_both_replay_but_duplicate_states_do_not(self):
        prepared = self.record()
        self.store.append(prepared)
        self.store.append({**prepared,'status':'completed','completed_at':'2026-10-15T09:02:00Z'})
        self.store.append(self.record(scope='tenant'))
        calls = []
        class Session:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def replay(self,record): calls.append(record['scope'])
            def commit(self): pass
        result = manifest.replay_current(self.store,Session)
        self.assertEqual(result['intents'],2)
        self.assertEqual(sorted(calls),['member','tenant'])

    def test_corrupt_ciphertext_or_unavailable_inventory_prevents_any_replay(self):
        key = self.store.append(self.record())
        path = self.objects/key
        cipher = path.read_bytes()
        changed = bytearray(cipher); changed[-20] ^= 64
        path.write_bytes(changed)
        with self.assertRaises(manifest.ManifestError): self.store.load_current()
        path.write_bytes(cipher)
        (self.root/'transport-mode').write_text('list')
        with self.assertRaises(manifest.ManifestError): self.store.load_current()

    def test_conflicting_intent_subject_and_extra_personal_data_are_refused(self):
        record = self.record()
        with self.assertRaises(manifest.ManifestError): self.store.append({**record,'email':'private@example.test'})
        self.store.append(record)
        self.store.append({**record,'member_id':'44444444-4444-4444-8444-444444444444'})
        with self.assertRaises(manifest.ManifestError): self.store.load_current()

    def test_real_encrypted_pruning_checks_current_backup_inventory_before_deleting(self):
        record = self.record()
        self.store.append(record)
        self.store.append({**record,'status':'completed','completed_at':'2026-10-15T09:02:00Z'})
        self.store.env.update(ERASURE_PRUNE_CONFIRMED='completed-30-days-and-other-backups-expired',ERASURE_OTHER_BACKUPS_EXPIRED_THROUGH='2026-11-14T09:02:00Z')
        older = self.objects/'backup-objects/loynara/2026/10/15/20261015T080000Z-000000000000.dump.age'
        older.parent.mkdir(parents=True)
        older.write_bytes(b'Private synthetic inventory fixture; not a real backup')
        with self.assertRaisesRegex(manifest.ManifestError,'Older database backups'):
            manifest.prune_archive(self.store,now=lambda:datetime(2026,11,14,9,2,tzinfo=timezone.utc))
        self.assertEqual(len(self.store.inventory()),2)
        older.unlink()
        result = manifest.prune_archive(self.store,now=lambda:datetime(2026,11,14,9,2,tzinfo=timezone.utc))
        self.assertEqual(result['intents'],1)
        self.assertEqual(result['objects'],2)
        self.assertEqual(self.store.inventory(),{})
        self.store.verify_namespace()

    def closure_store(self):
        self.env.update(ERASURE_CLOSURE_S3_ENDPOINT=self.env['ERASURE_S3_ENDPOINT'],ERASURE_CLOSURE_S3_BUCKET='synthetic-closure',
            ERASURE_CLOSURE_S3_PREFIX='closure-v1',ERASURE_CLOSURE_NAMESPACE_ID='44444444-4444-4444-8444-444444444444',
            ERASURE_CLOSURE_AWS_ACCESS_KEY_ID='closure-only-access',ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY='closure-only-secret')
        store=manifest.Store(self.env,kind='closure'); store.initialize()
        return store

    def test_closure_writer_needs_no_database_private_identity_or_purge_credentials(self):
        closure=self.closure_store()
        env={key:value for key,value in self.env.items() if key not in ('ERASURE_AWS_ACCESS_KEY_ID','ERASURE_AWS_SECRET_ACCESS_KEY','ERASURE_AGE_IDENTITY_FILE')}
        request={**SUBJECT,'intent_id':str(uuid.uuid4())}
        result=subprocess.run(['python3',str(pathlib.Path(__file__).with_name('erasure_manifest.py')),'record-closure'],
            input=json.dumps(request),env={**env,'ERASURE_POLICY_APPROVED':manifest.POLICY},capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{'status':'recorded'})
        self.assertEqual(closure.load_current()[1][0]['status'],'closure')
        self.assertEqual(self.store.load_current()[1],[])
        with self.assertRaises(manifest.ManifestError): closure.append({**self.record(),'namespace_id':closure.namespace_id})
        with self.assertRaises(manifest.ManifestError): self.store.append(self.record(status='closure'))
        with self.assertRaises(manifest.ManifestError): manifest.Store({**self.env,'ERASURE_CLOSURE_S3_BUCKET':self.env['ERASURE_S3_BUCKET']},kind='closure')

    def test_closure_precedes_purge_and_survives_until_covering_completion_expires(self):
        closure=self.closure_store()
        record={**self.record(status='closure'),'namespace_id':closure.namespace_id}
        closure.append(record)
        self.store.env.update(ERASURE_PRUNE_CONFIRMED='completed-30-days-and-other-backups-expired',ERASURE_OTHER_BACKUPS_EXPIRED_THROUGH='2026-11-14T09:02:00Z')
        threshold=lambda:datetime(2026,11,14,9,2,tzinfo=timezone.utc)
        retained=manifest.prune_archive(self.store,closure_store=closure,now=threshold)
        self.assertEqual(retained['retained_closure_intents'],1)
        purge=self.record(status='completed',scope='tenant')
        self.store.append(purge)
        calls=[]
        class Session:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def replay(self,record): calls.append(record['status'])
            def commit(self): pass
        manifest.replay_current(self.store,Session,closure)
        self.assertEqual(calls,['closure','completed'])
        deleted=[]
        for store in (closure,self.store):
            original=store.delete
            def tracked(key,store=store,original=original): deleted.append(store.kind); original(key)
            store.delete=tracked
        result=manifest.prune_archive(self.store,closure_store=closure,now=threshold)
        self.assertEqual(result['closure_intents'],1)
        self.assertEqual(deleted,['closure','purge'])
        self.assertEqual(closure.inventory(),{})

    def test_transport_failure_is_redacted_at_cli_boundary(self):
        (self.root/'transport-mode').write_text('upload')
        result = subprocess.run(['python3',str(pathlib.Path(__file__).with_name('erasure_manifest.py')),'initialize'],
            env={**self.env,'ERASURE_S3_PREFIX':'erasure-unavailable','ERASURE_INITIALIZE_CONFIRMED':'new-protected-namespace'},capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('private-customer',result.stdout+result.stderr)
        self.assertNotIn('synthetic-secret',result.stdout+result.stderr)
        self.assertIn('diagnostic details withheld',result.stderr)

if __name__ == '__main__': unittest.main(verbosity=2)
