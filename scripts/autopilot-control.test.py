import json
import subprocess
import sys
import tempfile
import unittest
import importlib.util
from unittest.mock import patch
from datetime import datetime, timezone
from types import SimpleNamespace
from pathlib import Path

SCRIPT = Path(__file__).with_name('autopilot-control.py')
# Freeze only the external wall clock; real CLI/file locks/Git remain exercised.
LAUNCHER = """import importlib.util,sys
from datetime import datetime,timezone
spec=importlib.util.spec_from_file_location('gate',sys.argv[1]); gate=importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
gate.now=lambda:datetime(2026,10,10,1,0,tzinfo=timezone.utc)
sys.argv=sys.argv[1:]
raise SystemExit(gate.main())
"""

class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)

    def run_gate(self, *args):
        run = subprocess.run([sys.executable, "-c", LAUNCHER, str(SCRIPT), '--state-dir', str(self.state), *args], capture_output=True, text=True)
        try:
            data = json.loads(run.stdout)
        except ValueError:
            data = {'error': run.stderr}
        return run.returncode, data

    def claim(self, issue='LOY-164'):
        return self.run_gate('claim', '--issue', issue, '--rehearsal')

    def test_second_run_cannot_claim_even_a_different_issue(self):
        code, first = self.claim()
        self.assertEqual(code, 0, first)
        self.assertEqual(self.claim('LOY-189')[1]['reason'], 'another_run_owns_lock')
        self.assertEqual(self.run_gate('finish', '--run', 'wrong', '--outcome', 'blocked')[1]['reason'], 'wrong_owner')
        self.assertEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'blocked')[0], 0)
        self.assertEqual(self.claim('LOY-189')[0], 0)

    def test_unattended_claim_requires_founder_activation_receipt(self):
        code, data = self.run_gate('claim', '--issue', 'LOY-164')
        self.assertNotEqual(code, 0)
        self.assertEqual(data['reason'], 'activation_missing')

    def test_two_approaches_persist_across_runs(self):
        _, first = self.claim()
        for _ in range(2):
            self.assertEqual(self.run_gate('approach', '--run', first['run'])[0], 0)
        self.assertEqual(self.run_gate('approach', '--run', first['run'])[1]['reason'], 'two_approaches_exhausted')
        self.run_gate('finish', '--run', first['run'], '--outcome', 'blocked')
        self.assertEqual(self.claim()[1]['reason'], 'two_approaches_exhausted')

    def test_expired_owner_is_not_automatically_reclaimed(self):
        _, first = self.claim()
        path = self.state / 'state.json'
        state = json.loads(path.read_text())
        state['active']['deadline'] = '2000-01-01T00:00:00+00:00'
        path.write_text(json.dumps(state))
        self.assertEqual(self.run_gate('check', '--run', first['run'], '--operation', 'local_test')[1]['reason'], 'deadline_reached')
        self.assertEqual(self.claim('LOY-189')[1]['reason'], 'another_run_owns_lock')
        self.assertEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'review', '--sha', '32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388', '--evidence', 'missing.json')[1]['reason'], 'deadline_reached')
        self.assertEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'blocked')[0], 0)

    def test_prohibited_operations_and_unknown_operations_fail_closed(self):
        _, first = self.claim()
        for action in ['deploy', 'production_migrate', 'dns', 'secrets', 'enable_nfc', 'enable_wallet', 'provision_tag', 'billing', 'payment', 'send_email', 'submit_legal', 'change_policy', 'merge_release', 'purchase', 'shell']:
            code, data = self.run_gate('check', '--run', first['run'], '--operation', action)
            self.assertNotEqual(code, 0, action)
            self.assertEqual(data['reason'], 'operation_not_authorized', action)
        self.assertEqual(self.run_gate('check', '--run', first['run'], '--operation', 'local_test')[0], 0)

    def test_reviewed_issue_not_selected_again(self):
        _, first = self.claim()
        self.assertNotEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'review')[0], 0)
        self.assertNotEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'review', '--sha', 'a'*40, '--evidence', 'tests-passed.json')[0], 0)
        sha='32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388'
        evidence=self.state/'tests-passed.json'
        evidence.write_text(json.dumps({'issue':'LOY-164','sha':sha,'base_sha':sha}))
        self.assertEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'review', '--sha', sha, '--evidence', str(evidence))[0], 0)
        self.assertEqual(self.claim()[1]['reason'], 'already_ready_for_review')
        state = json.loads((self.state/'state.json').read_text())
        self.assertEqual(state['issues']['LOY-164']['sha'], sha)
        self.assertEqual(state['issues']['LOY-164']['evidence'], str(evidence))

    def test_no_non_loynara_ids_or_done_outcome(self):
        self.assertEqual(self.claim('OTHER-1')[1]['reason'], 'invalid_issue')
        _, first = self.claim()
        self.assertNotEqual(self.run_gate('finish', '--run', first['run'], '--outcome', 'done')[0], 0)

    def test_blocked_issue_is_not_reaudited_without_review(self):
        _, first = self.claim()
        self.run_gate('finish', '--run', first['run'], '--outcome', 'blocked')
        self.assertEqual(self.claim()[1]['reason'], 'recorded_blocker_requires_review')

    def test_invalid_expired_and_broad_permission_receipts_are_rejected(self):
        receipt = self.state / 'activation.json'
        receipt.write_text(json.dumps({'approval': 'no'}))
        self.assertEqual(self.run_gate('claim', '--issue', 'LOY-164')[1]['reason'], 'activation_not_approved')
        receipt.write_text(json.dumps({'approval': 'explicit-founder-autopilot-v1', 'expires_at': '2000-01-01T00:00:00+00:00'}))
        self.assertEqual(self.run_gate('claim', '--issue', 'LOY-164')[1]['reason'], 'trial_expired')
        receipt.write_text(json.dumps({'approval': 'explicit-founder-autopilot-v1', 'expires_at': '2030-01-01T00:00:00+00:00', 'sandbox_mode': 'danger-full-access', 'youtrack_identity': 'admin', 'capability_restrictions_verified': True}))
        self.assertEqual(self.run_gate('claim', '--issue', 'LOY-164')[1]['reason'], 'permissions_not_verified')

    def test_scheduled_run_budget_does_not_affect_manual_rehearsal(self):
        (self.state / 'activation.json').write_text(json.dumps({'approval': 'explicit-founder-autopilot-v1', 'expires_at': '2030-01-01T00:00:00+00:00', 'sandbox_mode': 'workspace-write', 'youtrack_identity': 'loynara-autopilot', 'capability_restrictions_verified': True}))
        (self.state / 'state.json').write_text(json.dumps({'scheduled_runs': 10}))
        self.assertEqual(self.run_gate('claim', '--issue', 'LOY-164')[1]['reason'], 'run_budget_exhausted')
        self.assertEqual(self.claim()[0], 0)

    def test_scheduled_check_rechecks_receipt_revocation_and_expiry(self):
        spec=importlib.util.spec_from_file_location('gate',SCRIPT)
        gate=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        receipt=self.state/'activation.json'
        activation={'approval':'explicit-founder-autopilot-v1','expires_at':'2026-10-15T16:10:00+00:00','sandbox_mode':'workspace-write','youtrack_identity':'loynara-autopilot','capability_restrictions_verified':True}
        receipt.write_text(json.dumps(activation))
        state={}
        args=SimpleNamespace(command='claim',issue='LOY-164',rehearsal=False,repo=gate.REPO)
        with patch.object(gate,'now',return_value=datetime(2026,10,15,16,0,tzinfo=timezone.utc)):
            first=gate.apply(state,args,self.state)
        self.assertEqual(first['deadline'],'2026-10-15T16:10:00+00:00')
        check=SimpleNamespace(command='check',run=first['run'],operation='local_edit')
        with patch.object(gate,'now',return_value=datetime(2026,10,15,16,10,tzinfo=timezone.utc)):
            with self.assertRaisesRegex(gate.Refusal,'trial_expired'): gate.apply(state,check,self.state)
        receipt.unlink()
        with patch.object(gate,'now',return_value=datetime(2026,10,15,16,1,tzinfo=timezone.utc)):
            with self.assertRaisesRegex(gate.Refusal,'activation_missing'): gate.apply(state,check,self.state)
        activation['expires_at']='2030-01-01T00:00:00+00:00'
        receipt.write_text(json.dumps(activation))
        state={}
        with patch.object(gate,'now',return_value=datetime(2026,10,15,16,0,tzinfo=timezone.utc)):
            first=gate.apply(state,args,self.state)
            self.assertEqual(first['deadline'],'2026-10-15T16:45:00+00:00')
        check.run=first['run']
        with patch.object(gate,'now',return_value=datetime(2026,10,15,16,46,tzinfo=timezone.utc)):
            with self.assertRaisesRegex(gate.Refusal,'trial_expired'): gate.apply(state,check,self.state)
        with patch.object(gate,'now',return_value=datetime(2026,10,15,16,2,tzinfo=timezone.utc)):
            with self.assertRaisesRegex(gate.Refusal,'last_admission_passed'): gate.apply({},args,self.state)

    def test_simultaneous_claims_have_one_winner(self):
        command = [sys.executable, "-c", LAUNCHER, str(SCRIPT), '--state-dir', str(self.state), 'claim', '--issue', 'LOY-164', '--rehearsal']
        runs = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(4)]
        outputs = [r.communicate() for r in runs]
        self.assertEqual(sum(r.returncode == 0 for r in runs), 1, outputs)

if __name__ == '__main__':
    unittest.main()
