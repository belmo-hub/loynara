"""Real age + PostgreSQL drill of the existing production scripts; no hosted transport.

Only AWS transport and the production-only dump hostname are adapted for this
explicit synthetic test. Production guards and scripts are unchanged. All database
operations are pinned to the owned ephemeral loopback server and unique names.
Run: python3 scripts/production-encrypted-backup.test.py
"""
import hashlib
import importlib.util
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import shutil
import socket
import time
import subprocess
import sys
import tempfile
import unittest
import uuid

if sys.flags.optimize:
    raise RuntimeError("This safety-guarded drill requires Python assertions enabled")

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('erasure_manifest',ROOT/'scripts/erasure_manifest.py')
ERASURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ERASURE)
PORT = None
BASE = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG") if k in os.environ}
BASE.update(PGHOST="127.0.0.1", PGPORT="5432", PGUSER="looplocal", PGPASSWORD="looplocal_local_only", PGDATABASE="postgres")
REAL = {tool: shutil.which(tool, path=BASE["PATH"]) for tool in ("psql", "pg_dump", "pg_restore", "age", "age-keygen", "initdb", "pg_ctl")}
assert all(REAL.values()), "Existing PostgreSQL and age tools are required; no installation performed"


def execute(args, env=BASE, **kwargs):
    return subprocess.run(args, cwd=ROOT, env=env, capture_output=True, timeout=60, **kwargs)


def sql(database, statement):
    env = {**BASE, "PGDATABASE": database}
    result = execute([REAL["psql"], "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], env, text=True)
    assert result.returncode == 0, "Owned synthetic database query failed"
    return result.stdout.strip()


def snapshot(database):
    result = {}
    tables = sql(database, "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY 1").splitlines()
    for table in tables:
        schema, name = table.split(".")
        quoted = '"' + schema.replace('"', '""') + '"."' + name.replace('"', '""') + '"'
        result[table] = sql(database, "SELECT count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) FROM " + quoted + " t")
    return result


class EncryptedRecovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global PORT
        cls.started = time.monotonic()
        cls.temp = tempfile.TemporaryDirectory(prefix="loynara-encrypted-108-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.directory = Path(cls.temp.name)
        cls.directory.chmod(0o700)
        cls.data = cls.directory / "data"
        initialized = execute([REAL["initdb"], "-D", str(cls.data), "-U", "looplocal", "--auth=trust", "--no-locale"])
        assert initialized.returncode == 0, "Owned PostgreSQL initialization failed: " + initialized.stderr.decode()
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            PORT = str(reservation.getsockname()[1])
        BASE["PGPORT"] = PORT
        started = execute([REAL["pg_ctl"], "-D", str(cls.data), "-l", str(cls.directory / "server.log"),
                           "-o", f"-h 127.0.0.1 -p {PORT} -k {cls.directory}", "-w", "start"])
        assert started.returncode == 0, "Owned PostgreSQL startup failed"
        cls.addClassCleanup(cls.stop_cluster)
        assert Path(sql("postgres", "SHOW data_directory")).resolve() == cls.data.resolve(), "Cluster ownership mismatch"
        cls.databases = []
        cls.addClassCleanup(cls.cleanup_databases)
        cls.source = cls.database("backup")
        cls.bin = cls.directory / "bin"
        cls.bin.mkdir(mode=0o700)
        cls.store = cls.directory / "object-store"
        cls.store.mkdir(mode=0o700)
        cls.erasure_store = cls.directory / "erasure-store"
        cls.erasure_store.mkdir(mode=0o700)
        cls.closure_store = cls.directory / "closure-store"
        cls.closure_store.mkdir(mode=0o700)
        cls.trace = cls.directory / "transport-trace"
        cls.transport_control = cls.directory / "transport-control"
        cls.identity = cls.directory / "identity"
        cls.wrong_identity = cls.directory / "wrong-identity"
        cls.erasure_identity = cls.directory / "erasure-identity"
        for target in (cls.identity, cls.wrong_identity, cls.erasure_identity):
            keygen = execute([REAL["age-keygen"], "-o", str(target)])
            assert keygen.returncode == 0, "Ephemeral local age identity generation failed"
            target.chmod(0o600)
        recipient = execute([REAL["age-keygen"], "-y", str(cls.identity)], text=True)
        assert recipient.returncode == 0
        erasure_recipient = execute([REAL["age-keygen"], "-y", str(cls.erasure_identity)], text=True)
        assert erasure_recipient.returncode == 0
        # No real AWS executable is called. This adapter only copies ciphertext
        # inside a private test directory and checks the exact synthetic bucket.
        adapter = cls.bin / "aws"
        adapter.write_text("#!/usr/bin/env python3\nROOT_BACKUP = " + repr(str(cls.store)) + "\nROOT_ERASURE = " + repr(str(cls.erasure_store)) + "\nROOT_CLOSURE = " + repr(str(cls.closure_store)) + "\nTRACE = " + repr(str(cls.trace)) + "\nCONTROL = " + repr(str(cls.transport_control)) + "\n" + r"""
import hashlib, json, os, pathlib, shutil, sys
args = sys.argv[1:]
while args and args[0].startswith('--'):
    option,value = args[:2]; args = args[2:]
    assert option in ('--endpoint-url','--cli-connect-timeout','--cli-read-timeout')
    if option == '--endpoint-url': assert value == 'https://'+'0'*32+'.eu.r2.cloudflarestorage.com'
mode = pathlib.Path(CONTROL).read_text() if pathlib.Path(CONTROL).exists() else ''
if mode == 'unavailable' or os.environ.get('BACKUP_TEST_TRANSPORT') == 'error':
    print('synthetic-customer-private@example.test',file=sys.stderr); sys.exit(9)
if os.environ.get('BACKUP_TEST_TRANSPORT') == 'hang':
    import time; time.sleep(5)
roots = {'synthetic-108':pathlib.Path(ROOT_BACKUP).resolve(),'synthetic-erasure':pathlib.Path(ROOT_ERASURE).resolve(),'synthetic-closure':pathlib.Path(ROOT_CLOSURE).resolve()}
def object_path(uri):
    assert uri.startswith('s3://')
    bucket,key = uri[5:].split('/',1)
    assert bucket in roots
    path = (roots[bucket]/key).resolve()
    assert path.is_relative_to(roots[bucket])
    return path
def value(flag): return args[args.index(flag)+1]
with open(TRACE,'a') as trace: trace.write(' '.join(args[:2])+'\n')
if args[:2] == ['s3','cp']:
    source,target = args[2:4]
    if source.startswith('s3://'): shutil.copyfile(object_path(source),target)
    else:
        if mode == 'manifest-upload-fail' and target.startswith('s3://synthetic-erasure/'):
            print('synthetic-private-upload-failure',file=sys.stderr); sys.exit(8)
        path = object_path(target)
        path.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,path); path.chmod(0o600)
        if '--metadata' in args: path.with_suffix('.metadata').write_text(json.dumps(dict(item.split('=',1) for item in value('--metadata').split(','))))
elif args[:2] == ['s3api','head-object']:
    path = object_path('s3://'+value('--bucket')+'/'+value('--key'))
    metadata = json.loads(path.with_suffix('.metadata').read_text()) if path.with_suffix('.metadata').exists() else {}
    print(json.dumps({'ContentLength':path.stat().st_size,'Metadata':metadata}))
elif args[:2] == ['s3api','list-objects-v2']:
    bucket,prefix = value('--bucket'),value('--prefix')
    assert bucket in roots
    found = []
    for path in sorted(roots[bucket].rglob('*.age')):
        key = str(path.relative_to(roots[bucket]))
        if key.startswith(prefix): found.append({'Key':key,'Size':path.stat().st_size,'ETag':hashlib.sha256(path.read_bytes()).hexdigest(),'LastModified':'2026-10-15T09:00:00Z'})
    print(json.dumps({'Contents':found,'KeyCount':len(found),'IsTruncated':False}))
elif args[:2] == ['s3api','delete-object']:
    path = object_path('s3://'+value('--bucket')+'/'+value('--key'))
    path.unlink(); path.with_suffix('.metadata').unlink(missing_ok=True)
    print('{}')
else: raise RuntimeError('Unsupported private local transport operation')
""")
        adapter.chmod(0o700)
        dump = cls.bin / "pg_dump"
        dump.write_text("#!/usr/bin/env python3\n" + r"""
import os, pathlib, subprocess, sys
assert sys.argv[1:] == ['--format=custom', '--no-owner', '--no-acl']
assert os.environ['PGHOST'] == 'synthetic.railway.internal'
assert os.environ['PGDATABASE'] == os.environ['BACKUP_TEST_SOURCE']
env = os.environ.copy()
env['PGHOST'] = '127.0.0.1'
env['PGPORT'] = os.environ['BACKUP_TEST_PORT']
check = subprocess.run([os.environ['BACKUP_TEST_PSQL'], '-X', '-At', '-c', 'SHOW data_directory'], env=env, capture_output=True, text=True)
assert check.returncode == 0 and pathlib.Path(check.stdout.strip()).resolve() == pathlib.Path(os.environ['BACKUP_TEST_DATA']).resolve()
os.execve(os.environ['BACKUP_TEST_PG_DUMP'], [os.environ['BACKUP_TEST_PG_DUMP'], *sys.argv[1:]], env)
""")
        dump.chmod(0o700)
        # The backup's schema probe gets the same treatment: only that exact read-only query, redirected to the same
        # verified synthetic cluster. Every other psql call (the restore check shares this PATH) runs unchanged.
        probe = cls.bin / "psql"
        probe.write_text("#!/usr/bin/env python3\n" + r"""
import os, pathlib, subprocess, sys
if os.environ.get('PGHOST') != 'synthetic.railway.internal':
    os.execv(os.environ['BACKUP_TEST_PSQL'], [os.environ['BACKUP_TEST_PSQL'], *sys.argv[1:]])
assert sys.argv[1:5] == ['-X', '-At', '-v', 'ON_ERROR_STOP=1'] and sys.argv[5] == '-c' and len(sys.argv) == 7
assert sys.argv[6].startswith("SELECT to_regclass('public.ledger_entries') IS NOT NULL")
assert os.environ['PGHOST'] == 'synthetic.railway.internal'
assert os.environ['PGDATABASE'] == os.environ['BACKUP_TEST_SOURCE']
env = os.environ.copy()
env['PGHOST'] = '127.0.0.1'
env['PGPORT'] = os.environ['BACKUP_TEST_PORT']
check = subprocess.run([os.environ['BACKUP_TEST_PSQL'], '-X', '-At', '-c', 'SHOW data_directory'], env=env, capture_output=True, text=True)
assert check.returncode == 0 and pathlib.Path(check.stdout.strip()).resolve() == pathlib.Path(os.environ['BACKUP_TEST_DATA']).resolve()
os.execve(os.environ['BACKUP_TEST_PSQL'], [os.environ['BACKUP_TEST_PSQL'], *sys.argv[1:]], env)
""")
        probe.chmod(0o700)
        cls.env = {**BASE, "PATH": str(cls.bin) + os.pathsep + BASE["PATH"],
                   "PRODUCTION_ENVIRONMENT": "loynara-production", "PGHOST": "synthetic.railway.internal", "PGDATABASE": cls.source,
                   "BACKUP_S3_ENDPOINT": "https://" + "0" * 32 + ".eu.r2.cloudflarestorage.com", "BACKUP_S3_BUCKET": "synthetic-108",
                   "BACKUP_AGE_RECIPIENT": recipient.stdout.strip(), "AWS_ACCESS_KEY_ID": "synthetic-access-only",
                   "AWS_SECRET_ACCESS_KEY": "synthetic-local-secret-only", "AWS_DEFAULT_REGION": "auto",
                   "BACKUP_TEST_SOURCE": cls.source, "BACKUP_TEST_PSQL": REAL["psql"], "BACKUP_TEST_PG_DUMP": REAL["pg_dump"],
                   "ERASURE_S3_ENDPOINT": "https://"+"0"*32+".eu.r2.cloudflarestorage.com", "ERASURE_S3_BUCKET": "synthetic-erasure", "ERASURE_S3_PREFIX": "erasure-v1",
                   "ERASURE_NAMESPACE_ID": "33333333-3333-4333-8333-333333333333", "ERASURE_AGE_RECIPIENT": erasure_recipient.stdout.strip(),
                   "ERASURE_AGE_IDENTITY_FILE": str(cls.erasure_identity), "ERASURE_AWS_ACCESS_KEY_ID": "synthetic-erasure-access-only", "ERASURE_AWS_SECRET_ACCESS_KEY": "synthetic-erasure-secret-only",
                   "ERASURE_CLOSURE_S3_ENDPOINT":"https://"+"0"*32+".eu.r2.cloudflarestorage.com", "ERASURE_CLOSURE_S3_BUCKET":"synthetic-closure", "ERASURE_CLOSURE_S3_PREFIX":"closure-v1",
                   "ERASURE_CLOSURE_NAMESPACE_ID":"44444444-4444-4444-8444-444444444444", "ERASURE_CLOSURE_AWS_ACCESS_KEY_ID":"synthetic-closure-access-only", "ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY":"synthetic-closure-secret-only",
                   "ERASURE_POLICY_APPROVED": "2026-10-15", "ERASURE_ALLOW_LOCAL_ISOLATED": "true", "ERASURE_EXPECTED_DATA_DIRECTORY": str(cls.data),
                   "RESTORE_ERASURE_CHECKPOINT_CONFIRMED": "current-writers-paused", "RESTORE_TRANSPORTS_CONFIRMED": "disabled", "RESTORE_LEGAL_HOLDS_CONFIRMED": "current",
                   "EXTERNAL_EMAIL_ENABLED": "false", "PROMOTIONAL_EXTERNAL_EMAIL_ENABLED": "false", "TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED": "false", "GOOGLE_WALLET_ENABLED": "false", "APPLE_WALLET_ENABLED": "false", "PASSFAST_ENABLED": "false",
                   "BACKUP_TEST_PORT": PORT, "BACKUP_TEST_DATA": str(cls.data), "BACKUP_TEST_STORE": str(cls.store), "BACKUP_TEST_TRACE": str(cls.trace), "TMPDIR": str(cls.directory)}
        cls.app_env = {**BASE, "NODE_ENV": "test", "BETTER_AUTH_SECRET": "synthetic-recovery-local-only-secret",
                       "BETTER_AUTH_URL": "http://localhost:3000", "PUBLIC_BASE_URL": "http://localhost:3000",
                       "EXTERNAL_EMAIL_ENABLED": "false", "PROMOTIONAL_EXTERNAL_EMAIL_ENABLED": "false",
                       "BACKUP_TEST_PORT": PORT, "BACKUP_TEST_DATA": str(cls.data), "TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED": "false", "GOOGLE_WALLET_ENABLED": "false", "APPLE_WALLET_ENABLED": "false", "PASSFAST_ENABLED": "false", "DOTENV_CONFIG_PATH": str(cls.directory / "no-dotenv-file")}
        cls.probe(cls.source, "seed")
        assert sql(cls.source,"SELECT count(*) FROM retention_holds WHERE released_at IS NULL") == "0"
        cls.holds = cls.directory / "current-holds.json"
        cls.holds.write_text(json.dumps({"schema_version":1,"generated_at":ERASURE.iso(ERASURE.utc_now()),"holds":[]}))
        cls.holds.chmod(0o600)
        cls.env["RESTORE_CURRENT_HOLDS_FILE"] = str(cls.holds)
        ERASURE.Store(cls.env).initialize()
        ERASURE.Store(cls.env,kind="closure").initialize()
        cls.trace.write_text("")
        cls.before = snapshot(cls.source)
        cls.backup = execute(["bash", "scripts/production-backup.sh"], cls.env, text=True)
        assert cls.backup.returncode == 0, "Existing backup script failed its synthetic drill"
        objects = list(cls.store.rglob("*.dump.age"))
        assert len(objects) == 1
        cls.object = objects[0]
        cls.key = str(cls.object.relative_to(cls.store))
        cls.ciphertext = cls.object.read_bytes()

    @classmethod
    def database(cls, kind):
        name = "loynara_" + kind + "_108_" + uuid.uuid4().hex
        sql("postgres", 'CREATE DATABASE "' + name + '"')
        cls.databases.append(name)
        return name

    @classmethod
    def probe(cls, database, mode, extra_env=None):
        env = {**cls.app_env, **(extra_env or {}), "DATABASE_URL": f"postgresql://looplocal:looplocal_local_only@127.0.0.1:{PORT}/{database}"}
        result = execute(["./node_modules/.bin/tsx", "scripts/encrypted-backup-fixture.ts", mode], env, text=True)
        assert result.returncode == 0, "Synthetic application fixture/probe failed: " + result.stderr[:1000]

    def restore(self, target, **overrides):
        env = {**self.env, "RESTORE_TARGET_CONFIRMED": "isolated", "RESTORE_PGHOST": "127.0.0.1", "RESTORE_PGPORT": PORT,
               "RESTORE_ALLOW_LOCAL_ISOLATED": "true", "RESTORE_PGDATABASE": target, "RESTORE_PGUSER": "looplocal",
               "RESTORE_PGPASSWORD": "looplocal_local_only", "PRODUCTION_PGHOST": "synthetic.railway.internal",
               "BACKUP_OBJECT_KEY": self.key, "BACKUP_AGE_IDENTITY_FILE": str(self.identity), **overrides}
        result = execute(["bash", "scripts/production-restore-check.sh"], env, text=True)
        combined = result.stdout + result.stderr
        for forbidden in ("AGE-SECRET-KEY-", "synthetic-local-secret-only", "synthetic-customer-", "looplocal_local_only"):
            self.assertNotIn(forbidden, combined)
        self.assertFalse(list(self.directory.glob("tmp.*")), "Script temporary encrypted/decrypted artifacts must be cleaned")
        return result

    def test_01_ciphertext_is_not_plaintext_dump(self):
        self.assertTrue(self.ciphertext.startswith(b"age-encryption.org/v1\n"))
        self.assertNotIn(b"PGDMP", self.ciphertext[:5])
        self.assertNotIn(b"synthetic-customer-", self.ciphertext)
        self.assertEqual(self.object.stat().st_mode & 0o777, 0o600)
        result = execute([REAL["pg_restore"], "--list", str(self.object)])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.trace.read_text().splitlines()[:4], ["s3api head-object", "s3api head-object", "s3 cp", "s3api head-object"])
        self.assertNotIn("AGE-SECRET-KEY-", self.backup.stdout + self.backup.stderr)
        self.assertNotIn("synthetic-local-secret-only", self.backup.stdout + self.backup.stderr)

    def test_02_independent_restore_preserves_every_table_and_business_invariants(self):
        target = self.database("restore")
        result = self.restore(target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Isolated restore PASS", result.stdout)
        self.assertEqual(snapshot(target), self.before)
        self.probe(target, "probe")
        # Actual trigger and tenant FK must still reject changes after restore.
        for statement in ("UPDATE ledger_entries SET delta=delta+1", "UPDATE memberships SET program_id=(SELECT program_id FROM memberships ORDER BY id LIMIT 1) WHERE program_id<>(SELECT program_id FROM memberships ORDER BY id LIMIT 1)"):
            denied = execute([REAL["psql"], "-X", "-v", "ON_ERROR_STOP=1", "-c", statement], {**BASE, "PGDATABASE": target})
            self.assertNotEqual(denied.returncode, 0)
        self.assertEqual(snapshot(target), self.before)
        self.assertEqual(snapshot(self.source), self.before)
        self.assertEqual(sql(target, "SELECT count(*) FROM outbox_jobs WHERE status IN ('pending','retry') AND next_attempt_at<=now()"), "0")
        worker_env = {**self.app_env, "DATABASE_URL": f"postgresql://looplocal:looplocal_local_only@127.0.0.1:{PORT}/{target}"}
        worker = execute(["./node_modules/.bin/tsx", "scripts/worker.ts", "--once"], worker_env, text=True)
        self.assertEqual(worker.returncode, 0, worker.stderr)
        self.assertIn("Worker examined 0 due job(s)", worker.stdout)
        self.assertNotIn("AGE-SECRET-KEY-", worker.stdout + worker.stderr)
        self.assertNotIn("synthetic-customer-", worker.stdout + worker.stderr)
        self.probe(target, "probe")
        # Worker housekeeping/health state may change; application invariants and
        # the untouched source fingerprint remain authoritative after startup.
        self.assertEqual(snapshot(self.source), self.before)

    def test_03_wrong_identity_fails_before_any_restore(self):
        target = self.database("restore")
        result = self.restore(target, BACKUP_AGE_IDENTITY_FILE=str(self.wrong_identity))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Isolated restore PASS", result.stdout)
        self.assertEqual(snapshot(target), {})
        self.assertEqual(snapshot(self.source), self.before)

    def test_04_corruption_and_truncation_fail_before_any_restore(self):
        for mode in ("corrupt", "truncated"):
            with self.subTest(mode=mode):
                target = self.database("restore")
                changed = bytearray(self.ciphertext)
                if mode == "corrupt":
                    changed[-20] ^= 0x40
                else:
                    changed = changed[:-100]
                self.object.write_bytes(changed)
                try:
                    result = self.restore(target)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn("Isolated restore PASS", result.stdout)
                    self.assertEqual(snapshot(target), {})
                finally:
                    self.object.write_bytes(self.ciphertext)
        self.assertEqual(snapshot(self.source), self.before)

    def test_05_nonempty_target_and_broad_identity_permissions_are_rejected(self):
        target = self.database("restore")
        sql(target, "CREATE TABLE preservation_marker (id integer); INSERT INTO preservation_marker VALUES (7)")
        before = snapshot(target)
        result = self.restore(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not empty", result.stderr)
        self.assertEqual(snapshot(target), before)
        empty = self.database("restore")
        self.identity.chmod(0o644)
        try:
            result = self.restore(empty)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("readable only by its owner", result.stderr)
            self.assertEqual(snapshot(empty), {})
        finally:
            self.identity.chmod(0o600)

    @classmethod
    def stop_cluster(cls):
        assert Path(sql("postgres", "SHOW data_directory")).resolve() == cls.data.resolve()
        result = execute([REAL["pg_ctl"], "-D", str(cls.data), "-m", "fast", "-w", "stop"])
        assert result.returncode == 0, "Owned synthetic cluster cleanup failed"

    def damaged_backup(self, statement):
        database = self.database("backup")
        # Clone only the synthetic source; never an existing hosted database.
        sql("postgres", 'DROP DATABASE "' + database + '"')
        sql("postgres", 'CREATE DATABASE "' + database + '" TEMPLATE "' + self.source + '"')
        sql(database, statement)
        dumped = execute([REAL["pg_dump"], "--format=custom", "--no-owner", "--no-acl"], {**BASE, "PGDATABASE": database})
        self.assertEqual(dumped.returncode, 0)
        encrypted = execute([REAL["age"], "-r", self.env["BACKUP_AGE_RECIPIENT"]], input=dumped.stdout)
        self.assertEqual(encrypted.returncode, 0)
        self.object.write_bytes(encrypted.stdout)
        self.addCleanup(self.object.write_bytes, self.ciphertext)

    def test_06_restore_failure_rolls_back_all_database_objects_and_redacts_tool_errors(self):
        self.damaged_backup("ALTER TABLE memberships DISABLE TRIGGER ALL; UPDATE memberships SET program_id='00000000-0000-0000-0000-000000000000'; ALTER TABLE memberships ENABLE TRIGGER ALL")
        target = self.database("restore")
        result = self.restore(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(snapshot(target), {}, "Failed pg_restore must roll back all changes")
        self.assertNotIn("DETAIL:", result.stderr)
        self.assertEqual(sql(target, "SELECT count(*) FROM pg_namespace WHERE nspname='drizzle'"), "0")

    def test_07_inconsistent_membership_balance_is_not_reported_as_success(self):
        self.damaged_backup("UPDATE memberships SET balance=999")
        result = self.restore(self.database("restore"))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Isolated restore PASS", result.stdout)
        self.assertIn("balance", result.stderr.lower())

    def test_08_migration_metadata_tampering_is_not_reported_as_success(self):
        self.damaged_backup("UPDATE drizzle.__drizzle_migrations SET hash=repeat('0',64) WHERE id=(SELECT max(id) FROM drizzle.__drizzle_migrations)")
        result = self.restore(self.database("restore"))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Isolated restore PASS", result.stdout)
        self.assertIn("migration", result.stderr.lower())

    def test_09_disabled_ledger_guard_is_not_reported_as_success(self):
        self.damaged_backup("ALTER TABLE ledger_entries DISABLE TRIGGER ledger_append_only")
        result = self.restore(self.database("restore"))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Isolated restore PASS", result.stdout)

    def test_09b_only_the_known_0025_checks_may_stay_unvalidated(self):
        # The baseline restore passes with 0025's five NOT VALID checks; any other unvalidated constraint withholds PASS.
        self.assertEqual(sql(self.source, "SELECT count(*) FROM pg_constraint WHERE contype='c' AND NOT convalidated AND connamespace='public'::regnamespace"), "5")
        self.damaged_backup("ALTER TABLE memberships ADD CONSTRAINT synthetic_unvalidated_guard CHECK (balance >= 0) NOT VALID")
        result = self.restore(self.database("restore"))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Isolated restore PASS", result.stdout)
        self.assertIn("unvalidated", result.stderr.lower())

    def test_10_transport_diagnostics_are_redacted(self):
        result = self.restore(self.database("restore"), BACKUP_TEST_TRANSPORT="error")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("synthetic-customer-private", result.stderr)

    def test_11_hung_transport_is_bounded(self):
        started = time.monotonic()
        result = self.restore(self.database("restore"), BACKUP_TEST_TRANSPORT="hang", RESTORE_TOOL_TIMEOUT_SECONDS="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertLess(time.monotonic() - started, 4)
        self.assertIn("timed out", result.stderr)

    def test_12_missing_or_incomplete_release_manifest_refuses_before_transport(self):
        incomplete = self.directory / "incomplete-manifest"
        (incomplete / "meta").mkdir(parents=True)
        shutil.copyfile(ROOT / "drizzle/meta/_journal.json", incomplete / "meta/_journal.json")
        for manifest in (self.directory / "missing-manifest", incomplete):
            with self.subTest(manifest=manifest.name):
                target = self.database("restore")
                before = self.trace.read_text()
                result = self.restore(target, RESTORE_MIGRATIONS_DIR=str(manifest))
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(target), {})
                self.assertEqual(self.trace.read_text(), before)

    def test_13_explicit_reviewed_release_manifest_is_used(self):
        manifest = self.directory / "reviewed-manifest"
        (manifest / "meta").mkdir(parents=True)
        shutil.copyfile(ROOT / "drizzle/meta/_journal.json", manifest / "meta/_journal.json")
        for source in (ROOT / "drizzle").glob("*.sql"):
            shutil.copyfile(source, manifest / source.name)
        target = self.database("restore")
        restored = self.restore(target, RESTORE_MIGRATIONS_DIR=str(manifest))
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual(snapshot(target), self.before)
        (manifest / "0024_outbox_claim_token.sql").write_text("-- Synthetic altered release file\n")
        mismatched = self.restore(self.database("restore"), RESTORE_MIGRATIONS_DIR=str(manifest))
        self.assertNotEqual(mismatched.returncode, 0)
        self.assertIn("migration", mismatched.stderr.lower())
        self.assertNotIn("Isolated restore PASS", mismatched.stdout)

    def erasure_fixture(self):
        database = self.database("backup")
        sql("postgres", 'DROP DATABASE "'+database+'"')
        sql("postgres", 'CREATE DATABASE "'+database+'" TEMPLATE "'+self.source+'"')
        env = {**self.env,"PGHOST":"127.0.0.1","PGDATABASE":database,
               "ERASURE_S3_PREFIX":"erasure-"+uuid.uuid4().hex,"ERASURE_NAMESPACE_ID":str(uuid.uuid4()),
               "ERASURE_CLOSURE_S3_PREFIX":"closure-"+uuid.uuid4().hex,"ERASURE_CLOSURE_NAMESPACE_ID":str(uuid.uuid4())}
        store = ERASURE.Store(env)
        store.initialize()
        ERASURE.Store(env,kind="closure").initialize()
        member = sql(database,"SELECT tenant_id::text||','||id::text FROM memberships ORDER BY id LIMIT 1").split(',')
        survivor = sql(database,"SELECT tenant_id::text FROM memberships ORDER BY id OFFSET 1 LIMIT 1")
        before = self.tenant_snapshot(database,survivor)
        self.probe(database,"close-first",env)
        subject = {"scope":"member","tenant_id":member[0],"member_id":member[1],"cutoff_at":ERASURE.iso(ERASURE.utc_now())}
        return database,env,store,subject,survivor,before

    def tenant_snapshot(self,database,tenant):
        tables = sql(database,"SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' ORDER BY table_name").splitlines()
        result = {}
        for name in tables:
            quoted = '"'+name.replace('"','""')+'"'
            result[name] = sql(database,"SELECT count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) FROM "+quoted+" t WHERE tenant_id='"+tenant+"'::uuid")
        return result

    def test_14_completed_independent_erasure_prevents_resurrection_and_preserves_survivor(self):
        database,env,store,subject,survivor,before = self.erasure_fixture()
        result = execute(['python3','scripts/erasure_manifest.py','purge'],env,input=json.dumps(subject),text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{'status':'completed','purged':True})
        self.assertEqual(sql(database,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'0')
        self.assertEqual(self.tenant_snapshot(database,survivor),before)
        inventory,records = store.load_current()
        self.assertEqual(len(inventory),2)
        self.assertEqual(records[0]['status'],'completed')
        target = self.database('restore')
        restored = self.restore(target,**env)
        self.assertEqual(restored.returncode,0,restored.stderr)
        self.assertEqual(sql(target,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'0')
        self.assertEqual(sql(target,"SELECT count(*) FROM ledger_entries WHERE membership_id='"+subject['member_id']+"'"),'0')
        self.assertEqual(self.tenant_snapshot(target,survivor),before)
        self.probe(target,'probe-survivor')
        # Neither runtime nor the scheduled maintenance role may force-close a
        # live card by invoking the isolated-recovery entry point.
        survivor_member=sql(target,"SELECT id::text FROM memberships WHERE tenant_id='"+survivor+"'")
        for role in ('loynara_runtime','loynara_maintenance'):
            denied = execute([REAL['psql'],'-X','-v','ON_ERROR_STOP=1','-c',"SET ROLE "+role+"; SELECT public.loynara_replay_erasure('member','"+survivor+"','"+survivor_member+"',clock_timestamp(),gen_random_uuid())"],{**BASE,'PGDATABASE':target})
            self.assertNotEqual(denied.returncode,0)
        self.assertEqual(self.tenant_snapshot(target,survivor),before)

    def test_15_crash_after_commit_replays_prepared_intent_without_completion_object(self):
        database,env,store,subject,survivor,before = self.erasure_fixture()
        class CompletionUnavailable(ERASURE.Store):
            def append(self,record):
                if record['status']=='completed': raise ERASURE.ManifestError('Synthetic completion outage')
                return super().append(record)
        with self.assertRaises(ERASURE.ManifestError):
            ERASURE.purge_subject(subject,CompletionUnavailable(env),lambda:ERASURE.Session(env))
        self.assertEqual(sql(database,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'0')
        self.assertEqual(store.load_current()[1][0]['status'],'prepared')
        target=self.database('restore')
        restored=self.restore(target,**env)
        self.assertEqual(restored.returncode,0,restored.stderr)
        self.assertEqual(sql(target,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'0')
        self.assertEqual(self.tenant_snapshot(target,survivor),before)
        self.probe(target,'probe-survivor')

    def test_16_unavailable_erasure_archive_rolls_back_without_purging(self):
        database,env,store,subject,survivor,before = self.erasure_fixture()
        self.transport_control.write_text('manifest-upload-fail')
        try:
            result=execute(['python3','scripts/erasure_manifest.py','purge'],env,input=json.dumps(subject),text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertNotIn('synthetic-private-upload-failure',result.stderr)
        finally: self.transport_control.unlink()
        self.assertEqual(store.load_current()[1],[])
        self.assertEqual(sql(database,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'1')
        self.assertEqual(self.tenant_snapshot(database,survivor),before)

    def test_17_prepared_rollback_then_current_postbackup_hold_blocks_restore_signoff(self):
        database,env,store,subject,survivor,before = self.erasure_fixture()
        class CrashBeforeCommit(ERASURE.Session):
            def commit(self): raise ERASURE.ManifestError('Synthetic crash before commit')
        with self.assertRaises(ERASURE.ManifestError):
            ERASURE.purge_subject(subject,store,lambda:CrashBeforeCommit(env))
        self.assertEqual(sql(database,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'1')
        self.assertEqual(store.load_current()[1][0]['status'],'prepared')
        hold = {'tenant_uuid':subject['tenant_id'],'member_uuid':subject['member_id'],'categories':['ledger'],
                'basis':'Synthetic specific preservation','reason':"Synthetic holder's review; never an executable command",'custodian':'Synthetic recovery custodian',
                'review_at':ERASURE.iso(ERASURE.utc_now()+timedelta(days=1)),'release_condition':'Synthetic review completion'}
        file = self.directory/('holds-'+uuid.uuid4().hex+'.json')
        file.write_text(json.dumps({'schema_version':1,'generated_at':ERASURE.iso(ERASURE.utc_now()),'holds':[hold]}))
        file.chmod(0o600)
        target=self.database('restore')
        restored=self.restore(target,**{**env,'RESTORE_CURRENT_HOLDS_FILE':str(file)})
        self.assertNotEqual(restored.returncode,0)
        self.assertNotIn('Isolated restore PASS',restored.stdout)
        self.assertEqual(sql(target,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"'"),'1')
        self.assertEqual(sql(target,"SELECT count(*) FROM retention_holds WHERE released_at IS NULL"),'1')
        self.assertEqual(self.tenant_snapshot(target,survivor),before)

    def test_18_expired_records_in_an_old_snapshot_are_pruned_before_signoff(self):
        database=self.database('backup')
        sql('postgres','DROP DATABASE "'+database+'"')
        sql('postgres','CREATE DATABASE "'+database+'" TEMPLATE "'+self.source+'"')
        sql(database,"INSERT INTO rate_limits(key_hash,hits,reset_at) VALUES ('synthetic-expired-recovery',1,now()-interval '25 hours')")
        dumped=execute([REAL['pg_dump'],'--format=custom','--no-owner','--no-acl'],{**BASE,'PGDATABASE':database})
        self.assertEqual(dumped.returncode,0)
        encrypted=execute([REAL['age'],'-r',self.env['BACKUP_AGE_RECIPIENT']],input=dumped.stdout)
        self.assertEqual(encrypted.returncode,0)
        self.object.write_bytes(encrypted.stdout)
        self.addCleanup(self.object.write_bytes,self.ciphertext)
        target=self.database('restore')
        restored=self.restore(target)
        self.assertEqual(restored.returncode,0,restored.stderr)
        self.assertEqual(sql(target,"SELECT count(*) FROM rate_limits WHERE key_hash='synthetic-expired-recovery'"),'0')
        self.probe(target,'probe')

    def test_19_closure_only_archive_retires_restored_bearer_without_erasing_ledger(self):
        database,env,store,subject,survivor,before = self.erasure_fixture()
        self.assertEqual(store.load_current()[1],[])
        closures=ERASURE.Store(env,kind='closure').load_current()[1]
        self.assertEqual(len(closures),1)
        self.assertEqual(closures[0]['status'],'closure')
        original_token=sql(self.source,"SELECT card_token FROM memberships WHERE id='"+subject['member_id']+"'")
        original_ledger=sql(self.source,"SELECT md5(string_agg(row_to_json(l)::text,'|' ORDER BY row_to_json(l)::text)) FROM ledger_entries l WHERE membership_id='"+subject['member_id']+"'")
        target=self.database('restore')
        restored=self.restore(target,**env)
        self.assertEqual(restored.returncode,0,restored.stderr)
        self.assertEqual(sql(target,"SELECT count(*) FROM memberships WHERE id='"+subject['member_id']+"' AND closed_at IS NOT NULL AND card_token<>'"+original_token+"'"),'1')
        self.assertEqual(sql(target,"SELECT md5(string_agg(row_to_json(l)::text,'|' ORDER BY row_to_json(l)::text)) FROM ledger_entries l WHERE membership_id='"+subject['member_id']+"'"),original_ledger)
        self.assertEqual(sql(target,"SELECT count(*) FROM memberships"),'2')
        self.assertEqual(sql(target,"SELECT count(*) FROM ledger_entries"),'8')
        self.assertEqual(self.tenant_snapshot(target,survivor),before)
        self.probe(target,'probe-closed-first')

    def test_20_tenant_closure_archive_shuts_down_old_snapshot_without_erasing_ledger(self):
        database,env,store,subject,survivor,before = self.erasure_fixture()
        request={**subject,'scope':'tenant','member_id':None,'cutoff_at':ERASURE.iso(ERASURE.utc_now()),'intent_id':str(uuid.uuid4())}
        result=execute(['python3','scripts/erasure_manifest.py','record-closure'],env,input=json.dumps(request),text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(len(ERASURE.Store(env,kind='closure').load_current()[1]),2)
        target=self.database('restore')
        restored=self.restore(target,**env)
        self.assertEqual(restored.returncode,0,restored.stderr)
        self.assertEqual(sql(target,"SELECT count(*) FROM tenants WHERE id='"+subject['tenant_id']+"' AND closed_at IS NOT NULL"),'1')
        self.assertEqual(sql(target,"SELECT count(*) FROM memberships WHERE tenant_id='"+subject['tenant_id']+"' AND closed_at IS NULL"),'0')
        self.assertEqual(sql(target,"SELECT count(*) FROM ledger_entries"),'8')
        self.assertEqual(self.tenant_snapshot(target,survivor),before)
        self.probe(target,'probe-closed-first')

    @classmethod
    def cleanup_databases(cls):
        # Also runs if setup fails; unique disposable databases only, no FORCE.
        for database in cls.databases:
            assert sql("postgres", "SELECT count(*) FROM pg_stat_activity WHERE datname='" + database + "'") == "0"
            sql("postgres", 'DROP DATABASE "' + database + '"')

    @classmethod
    def tearDownClass(cls):
        evidence = {"result": "drill completed; unittest exit status is authoritative", "source_tables": len(cls.before),
                    "ciphertext_bytes": len(cls.ciphertext), "ciphertext_sha256": hashlib.sha256(cls.ciphertext).hexdigest(),
                    "elapsed_seconds": round(time.monotonic() - cls.started, 2), "migrations": int(sql(cls.source, "SELECT count(*) FROM drizzle.__drizzle_migrations")), "synthetic_only": True, "real_age_and_postgresql": True, "hosted_transport": False}
        print(json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
