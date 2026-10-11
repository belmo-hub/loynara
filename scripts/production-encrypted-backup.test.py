"""Real age + PostgreSQL drill of the existing production scripts; no hosted transport.

Only AWS transport and the production-only dump hostname are adapted for this
explicit synthetic test. Production guards and scripts are unchanged. All database
operations are pinned to the previously owned loopback server and unique names.
Run: python3 scripts/production-encrypted-backup.test.py
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

if sys.flags.optimize:
    raise RuntimeError("This safety-guarded drill requires Python assertions enabled")

ROOT = Path(__file__).resolve().parent.parent
PORT = "55433"
DATA_DIR = "/private/tmp/loynara-goal-133-pg"
BASE = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG") if k in os.environ}
BASE.update(PGHOST="127.0.0.1", PGPORT=PORT, PGUSER="looplocal", PGPASSWORD="looplocal_local_only", PGDATABASE="postgres")
REAL = {tool: shutil.which(tool, path=BASE["PATH"]) for tool in ("psql", "pg_dump", "pg_restore", "age", "age-keygen")}
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
        if sql("postgres", "SHOW data_directory") != DATA_DIR:
            raise RuntimeError("Refusing an unowned PostgreSQL server")
        cls.temp = tempfile.TemporaryDirectory(prefix="loynara-encrypted-108-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.directory = Path(cls.temp.name)
        cls.directory.chmod(0o700)
        cls.databases = []
        cls.addClassCleanup(cls.cleanup_databases)
        cls.source = cls.database("backup")
        cls.bin = cls.directory / "bin"
        cls.bin.mkdir(mode=0o700)
        cls.store = cls.directory / "object-store"
        cls.store.mkdir(mode=0o700)
        cls.trace = cls.directory / "transport-trace"
        cls.identity = cls.directory / "identity"
        cls.wrong_identity = cls.directory / "wrong-identity"
        for target in (cls.identity, cls.wrong_identity):
            keygen = execute([REAL["age-keygen"], "-o", str(target)])
            assert keygen.returncode == 0, "Ephemeral local age identity generation failed"
            target.chmod(0o600)
        recipient = execute([REAL["age-keygen"], "-y", str(cls.identity)], text=True)
        assert recipient.returncode == 0
        # No real AWS executable is called. This adapter only copies ciphertext
        # inside a private test directory and checks the exact synthetic bucket.
        adapter = cls.bin / "aws"
        adapter.write_text("#!/usr/bin/env python3\n" + r"""
import os, pathlib, shutil, sys
args = sys.argv[1:]
assert args[:2] == ['--endpoint-url', os.environ['BACKUP_S3_ENDPOINT']]
args = args[2:]
root = pathlib.Path(os.environ['BACKUP_TEST_STORE']).resolve()
def object_path(uri):
    prefix = 's3://synthetic-108/'
    assert uri.startswith(prefix)
    path = (root / uri[len(prefix):]).resolve()
    assert path.is_relative_to(root)
    return path
with open(os.environ['BACKUP_TEST_TRACE'], 'a') as trace:
    trace.write(' '.join(args[:2]) + '\n')
if args[:2] == ['s3', 'cp']:
    source, target = args[2:4]
    if source.startswith('s3://'):
        shutil.copyfile(object_path(source), target)
    else:
        path = object_path(target)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, path)
        path.chmod(0o600)
elif args[:2] == ['s3api', 'head-object']:
    assert args[2:4] == ['--bucket', 'synthetic-108']
    assert args[4] == '--key'
    assert object_path('s3://synthetic-108/' + args[5]).is_file()
else:
    raise RuntimeError('Unsupported local transport operation')
""")
        adapter.chmod(0o700)
        dump = cls.bin / "pg_dump"
        dump.write_text("#!/usr/bin/env python3\n" + r"""
import os, subprocess, sys
assert sys.argv[1:] == ['--format=custom', '--no-owner', '--no-acl']
assert os.environ['PGHOST'] == 'synthetic.railway.internal'
assert os.environ['PGDATABASE'] == os.environ['BACKUP_TEST_SOURCE']
env = os.environ.copy()
env['PGHOST'] = '127.0.0.1'
env['PGPORT'] = '55433'
check = subprocess.run([os.environ['BACKUP_TEST_PSQL'], '-X', '-At', '-c', 'SHOW data_directory'], env=env, capture_output=True, text=True)
assert check.returncode == 0 and check.stdout.strip() == '/private/tmp/loynara-goal-133-pg'
os.execve(os.environ['BACKUP_TEST_PG_DUMP'], [os.environ['BACKUP_TEST_PG_DUMP'], *sys.argv[1:]], env)
""")
        dump.chmod(0o700)
        cls.env = {**BASE, "PATH": str(cls.bin) + os.pathsep + BASE["PATH"],
                   "PRODUCTION_ENVIRONMENT": "loynara-production", "PGHOST": "synthetic.railway.internal", "PGDATABASE": cls.source,
                   "BACKUP_S3_ENDPOINT": "https://" + "0" * 32 + ".eu.r2.cloudflarestorage.com", "BACKUP_S3_BUCKET": "synthetic-108",
                   "BACKUP_AGE_RECIPIENT": recipient.stdout.strip(), "AWS_ACCESS_KEY_ID": "synthetic-access-only",
                   "AWS_SECRET_ACCESS_KEY": "synthetic-local-secret-only", "AWS_DEFAULT_REGION": "auto",
                   "BACKUP_TEST_SOURCE": cls.source, "BACKUP_TEST_PSQL": REAL["psql"], "BACKUP_TEST_PG_DUMP": REAL["pg_dump"],
                   "BACKUP_TEST_STORE": str(cls.store), "BACKUP_TEST_TRACE": str(cls.trace), "TMPDIR": str(cls.directory)}
        cls.app_env = {**BASE, "NODE_ENV": "test", "BETTER_AUTH_SECRET": "synthetic-recovery-local-only-secret",
                       "BETTER_AUTH_URL": "http://localhost:3000", "PUBLIC_BASE_URL": "http://localhost:3000",
                       "EXTERNAL_EMAIL_ENABLED": "false", "PROMOTIONAL_EXTERNAL_EMAIL_ENABLED": "false",
                       "TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED": "false", "GOOGLE_WALLET_ENABLED": "false", "APPLE_WALLET_ENABLED": "false", "PASSFAST_ENABLED": "false", "DOTENV_CONFIG_PATH": str(cls.directory / "no-dotenv-file")}
        cls.probe(cls.source, "seed")
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
    def probe(cls, database, mode):
        env = {**cls.app_env, "DATABASE_URL": f"postgresql://looplocal:looplocal_local_only@127.0.0.1:{PORT}/{database}"}
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
        self.assertEqual(self.trace.read_text().splitlines()[:2], ["s3 cp", "s3api head-object"])
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
    def cleanup_databases(cls):
        # Also runs if setup fails; unique disposable databases only, no FORCE.
        for database in cls.databases:
            assert sql("postgres", "SELECT count(*) FROM pg_stat_activity WHERE datname='" + database + "'") == "0"
            sql("postgres", 'DROP DATABASE "' + database + '"')

    @classmethod
    def tearDownClass(cls):
        evidence = {"result": "drill completed; unittest exit status is authoritative", "source_tables": len(cls.before),
                    "ciphertext_bytes": len(cls.ciphertext), "ciphertext_sha256": hashlib.sha256(cls.ciphertext).hexdigest(),
                    "migrations": 25, "synthetic_only": True, "real_age_and_postgresql": True, "hosted_transport": False}
        print(json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
