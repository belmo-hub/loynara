import importlib.util
import pathlib
import os
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('runner', ROOT / 'snapshot-runner.py')

class GuardTests(unittest.TestCase):
    def test_expired_execution_window_is_refused(self):
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with self.assertRaises(module.Refused): module.execution_seconds('2000-01-01T00:00:00Z')

    def test_bootstrap_default_does_not_connect(self):
        env={'PATH':os.environ['PATH'],'PGHOST':'127.0.0.1','PGPORT':'1','PGDATABASE':'loynara_snapshot_test_fixture'}
        result=subprocess.run(['python3',str(ROOT/'snapshot-bootstrap.py'),'--synthetic'],env=env,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0)
        self.assertEqual(result.stdout.strip(),b'CHECK ONLY: execution disabled')

    def test_bootstrap_refuses_modified_payload_pin(self):
        source=(ROOT/'snapshot-bootstrap.py').read_text()
        import hashlib
        sha=hashlib.sha256((ROOT/'snapshot-runner.py').read_bytes()).hexdigest()
        source=source.replace(repr(sha),repr('0'*64))
        with tempfile.NamedTemporaryFile(suffix='.py') as f:
            f.write(source.encode());f.flush()
            result=subprocess.run(['python3',f.name],env={'PATH':os.environ['PATH']},capture_output=True,timeout=10)
        self.assertEqual(result.returncode,2)
        self.assertFalse(result.stdout)

    def test_connection_uri_cannot_override_guarded_host(self):
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with self.assertRaises(module.Refused):
            module.validate_target({'PGHOST':'127.0.0.1','PGDATABASE':'postgresql://elsewhere/unrelated'},True)

    def test_hostaddr_override_is_refused(self):
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with self.assertRaises(module.Refused):
            module.validate_target({'PGHOST':'127.0.0.1','PGDATABASE':'loynara_snapshot_test_fixture','PGHOSTADDR':'203.0.113.1'},True)

    def test_default_does_not_execute(self):
        self.assertTrue((ROOT / 'snapshot-runner.py').is_file(), 'snapshot-capable runner is missing')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertFalse(module.parse_args([]).execute_one_backup)

    def test_synthetic_mode_rejects_nonlocal_database(self):
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with self.assertRaises(module.Refused):
            module.validate_target({'PGHOST':'database.railway.internal','PGDATABASE':'loynara_snapshot_test_fixture'}, True)

    def test_synthetic_mode_rejects_unrelated_database(self):
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with self.assertRaises(module.Refused):
            module.validate_target({'PGHOST':'127.0.0.1','PGDATABASE':'unrelated'}, True)

    def test_production_rejects_other_service(self):
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with self.assertRaises(module.Refused):
            module.validate_target({'PGHOST':'database.railway.internal','PGDATABASE':'railway',
             'PRODUCTION_ENVIRONMENT':'loynara-production','RAILWAY_SERVICE_ID':'web'}, False)

if __name__ == '__main__': unittest.main()
