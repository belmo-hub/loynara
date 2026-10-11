"""Real PostgreSQL target-emptiness guards; synthetic transport only.

Run: python3 scripts/production-restore-target.test.py
Creates and removes its own loopback-only cluster. No existing database, key,
R2 credentials, encrypted object or decrypted production records are accessed.
"""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
import uuid

SCRIPT = Path(__file__).with_name('production-restore-check.sh')
BASE = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
REAL = {tool: shutil.which(tool, path=BASE['PATH']) for tool in ('initdb', 'pg_ctl', 'psql')}
if sys.flags.optimize or not all(REAL.values()):
    raise RuntimeError('Requires assertions and existing PostgreSQL tools; installs nothing')


def run(args, env=BASE, **kwargs):
    return subprocess.run(args, env=env, capture_output=True, text=True, timeout=30, **kwargs)


class RestoreTarget(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='loynara-restore-target-127-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.root.chmod(0o700)
        cls.data = cls.root / 'data'
        result = run([REAL['initdb'], '-D', str(cls.data), '-U', 'synthetic_restore', '--auth=trust', '--no-locale'])
        if result.returncode:
            raise RuntimeError('Owned synthetic cluster initialization failed')
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            cls.port = str(reserve.getsockname()[1])
        # Explicit listen address and unique private socket directory; no hosted target.
        result = run([REAL['pg_ctl'], '-D', str(cls.data), '-l', str(cls.root / 'server.log'),
                      '-o', f'-h 127.0.0.1 -p {cls.port} -k {cls.root}', '-w', 'start'])
        if result.returncode:
            raise RuntimeError('Owned synthetic cluster startup failed')
        cls.addClassCleanup(cls.stop_cluster)
        cls.db_env = {**BASE, 'PGHOST': '127.0.0.1', 'PGPORT': cls.port,
                      'PGUSER': 'synthetic_restore', 'PGDATABASE': 'postgres'}
        if cls.sql('postgres', 'SHOW data_directory') != str(cls.data):
            raise RuntimeError('Local target ownership mismatch')
        cls.bin = cls.root / 'bin'
        cls.bin.mkdir(mode=0o700)
        cls.identity = cls.root / 'placeholder-identity'
        cls.identity.write_text('NOT AN AGE IDENTITY; synthetic guard fixture only\n')
        cls.identity.chmod(0o600)
        cls.trace = cls.root / 'effects'
        # Only the initial emptiness query uses real PostgreSQL. Downstream schema
        # responses model a successful restore; no restore writes actually occur.
        bodies = {
            'psql': r'''case "${TEST_METADATA:-real}" in
  error) exit 7;; missing) exit 0;; ambiguous) printf '0\n1\n'; exit 0;;
esac
case "$*" in
  *to_regclass*) printf 'ok\n';;
  *"SELECT 'tenants='"*) printf 'tenants=0, locations=0, memberships=0, ledger_entries=0, migrations=0\n';;
  *) exec "$REAL_PSQL" "$@";;
esac''',
            'aws': 'printf "transport\\n" >> "$TEST_TRACE"; printf "synthetic ciphertext" > "$6"',
            'age': 'printf "decrypt\\n" >> "$TEST_TRACE"; printf "synthetic dump"',
            'pg_restore': 'printf "restore\\n" >> "$TEST_TRACE"',
        }
        for tool, body in bodies.items():
            path = cls.bin / tool
            path.write_text('#!/bin/sh\nset -eu\n' + body + '\n')
            path.chmod(0o700)
        cls.env = {**BASE, 'PATH': str(cls.bin) + os.pathsep + BASE['PATH'],
                   'TMPDIR': str(cls.root), 'REAL_PSQL': REAL['psql'], 'TEST_TRACE': str(cls.trace),
                   'RESTORE_TARGET_CONFIRMED': 'isolated', 'RESTORE_PGHOST': '127.0.0.1',
                   'RESTORE_PGPORT': cls.port, 'RESTORE_ALLOW_LOCAL_ISOLATED': 'true',
                   'RESTORE_PGUSER': 'synthetic_restore', 'RESTORE_PGPASSWORD': 'synthetic-only',
                   'PRODUCTION_PGHOST': 'synthetic.railway.internal',
                   'BACKUP_S3_ENDPOINT': 'https://' + '0' * 32 + '.eu.r2.cloudflarestorage.com',
                   'BACKUP_S3_BUCKET': 'synthetic-only', 'BACKUP_OBJECT_KEY': 'synthetic-only.dump.age',
                   'AWS_ACCESS_KEY_ID': 'synthetic-only', 'AWS_SECRET_ACCESS_KEY': 'synthetic-only',
                   'AWS_DEFAULT_REGION': 'auto', 'BACKUP_AGE_IDENTITY_FILE': str(cls.identity)}

    @classmethod
    def stop_cluster(cls):
        result = run([REAL['pg_ctl'], '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'])
        if result.returncode:
            raise RuntimeError('Owned synthetic cluster cleanup failed')

    @classmethod
    def sql(cls, database, statement):
        result = run([REAL['psql'], '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement],
                     {**cls.db_env, 'PGDATABASE': database})
        if result.returncode:
            raise RuntimeError('Synthetic PostgreSQL fixture query failed: ' + result.stderr)
        return result.stdout.strip()

    def setUp(self):
        self.database = 'loynara_restore_127_' + uuid.uuid4().hex
        self.sql('postgres', 'CREATE DATABASE "' + self.database + '" TEMPLATE template0')
        self.addCleanup(self.sql, 'postgres', 'DROP DATABASE "' + self.database + '" WITH (FORCE)')
        self.trace.unlink(missing_ok=True)

    def invoke(self, **overrides):
        result = run(['bash', str(SCRIPT)], {**self.env, 'RESTORE_PGDATABASE': self.database, **overrides})
        self.assertNotIn('synthetic-only', result.stdout + result.stderr, 'No synthetic credentials in logs')
        self.assertFalse(list(self.root.glob('tmp.*')), 'Restore temporary files must be cleaned')
        return result

    def reject_fixture(self, ddl):
        self.sql(self.database, ddl)
        before = self.sql(self.database, "SELECT count(*) FROM pg_class")
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, 'Occupied target must refuse restoration')
        self.assertFalse(self.trace.exists(), 'Refusal must precede transport, decryption and restore')
        self.assertEqual(self.sql(self.database, "SELECT count(*) FROM pg_class"), before)

    def test_fresh_empty_target_passes_with_system_catalogs(self):
        self.assertGreater(int(self.sql(self.database, 'SELECT count(*) FROM pg_class')), 0)
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Isolated restore PASS', result.stdout)
        self.assertEqual(self.trace.read_text().splitlines(), ['transport', 'decrypt', 'restore', 'restore'])

    def test_public_populated_table_rejected(self):
        self.reject_fixture('CREATE TABLE public.occupied(id integer); INSERT INTO public.occupied VALUES (1)')

    def test_nonpublic_populated_table_rejected(self):
        self.reject_fixture('CREATE SCHEMA occupied; CREATE TABLE occupied.data(id integer); INSERT INTO occupied.data VALUES (1)')

    def test_user_objects_rejected(self):
        fixtures = {
            'empty nonpublic table': 'CREATE SCHEMA occupied; CREATE TABLE occupied.data(id integer)',
            'nonpublic sequence': 'CREATE SCHEMA occupied; CREATE SEQUENCE occupied.counter',
            'public sequence': 'CREATE SEQUENCE public.counter',
            'public view': 'CREATE VIEW public.occupied AS SELECT 1 AS id',
            'nonpublic view': 'CREATE SCHEMA occupied; CREATE VIEW occupied.view AS SELECT 1 AS id',
            'public materialized view': 'CREATE MATERIALIZED VIEW public.occupied AS SELECT 1 AS id',
            'nonpublic partition': 'CREATE SCHEMA occupied; CREATE TABLE occupied.parent(id integer) PARTITION BY RANGE(id); CREATE TABLE occupied.child PARTITION OF occupied.parent FOR VALUES FROM (0) TO (10)',
            'public enum': "CREATE TYPE public.occupied AS ENUM ('synthetic')",
            'public function': "CREATE FUNCTION public.occupied() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
            'empty custom schema': 'CREATE SCHEMA occupied',
            'public domain': 'CREATE DOMAIN public.occupied AS integer CHECK(VALUE > 0)',
            'public collation': 'CREATE COLLATION public.occupied FROM "C"',
            'public extension': 'CREATE EXTENSION hstore WITH SCHEMA public',
            'large object': 'SELECT lo_create(0)',
            'system-schema extension': 'CREATE EXTENSION hstore WITH SCHEMA pg_catalog',
            'foreign wrapper only': 'CREATE EXTENSION postgres_fdw WITH SCHEMA pg_catalog',
            'foreign table': "CREATE EXTENSION postgres_fdw WITH SCHEMA pg_catalog; CREATE SERVER synthetic FOREIGN DATA WRAPPER postgres_fdw OPTIONS(host '127.0.0.1'); CREATE FOREIGN TABLE public.occupied(id integer) SERVER synthetic",
        }
        for name, ddl in fixtures.items():
            with self.subTest(name=name):
                try:
                    self.reject_fixture(ddl)
                finally:
                    # Reset only this owned synthetic database, including on RED.
                    self.sql('postgres', 'DROP DATABASE "' + self.database + '" WITH (FORCE)')
                    self.sql('postgres', 'CREATE DATABASE "' + self.database + '" TEMPLATE template0')
                    self.trace.unlink(missing_ok=True)

    def test_unprivileged_caller_cannot_hide_existing_public_table(self):
        self.sql(self.database, 'CREATE TABLE public.occupied(id integer)')
        role = 'synthetic_reader_' + uuid.uuid4().hex
        self.sql('postgres', 'CREATE ROLE "' + role + '" LOGIN NOSUPERUSER')
        result = self.invoke(RESTORE_PGUSER=role)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.trace.exists())

    def test_missing_ambiguous_or_failed_metadata_refuses(self):
        for metadata in ('missing', 'ambiguous', 'error'):
            with self.subTest(metadata=metadata):
                result = self.invoke(TEST_METADATA=metadata)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.trace.exists())

    def test_unsafe_target_identity_refuses_before_query(self):
        for overrides in (
            {'RESTORE_PGHOST': 'synthetic.railway.internal'},
            {'RESTORE_PGPORT': '5432'},
            {'RESTORE_TARGET_CONFIRMED': ''},
            {'RESTORE_PGDATABASE': 'unrelated'},
            {'RESTORE_ALLOW_LOCAL_ISOLATED': ''},
        ):
            with self.subTest(overrides=overrides):
                result = self.invoke(**overrides, TEST_METADATA='error')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Restore refused:', result.stderr)
                self.assertFalse(self.trace.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
