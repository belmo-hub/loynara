import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('autopilot-runner.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class RunnerTests(unittest.TestCase):
    def test_cached_input_is_not_double_counted(self):
        self.assertEqual(r.usage({'input_tokens':100,'cached_input_tokens':70,'output_tokens':9}),
                         {'input_tokens':100,'cached_input_tokens':70,'uncached_input_tokens':30,'output_tokens':9,'total_tokens':109})
    def test_unknown_usage_is_not_zero(self):
        with self.assertRaises(r.Refusal): r.usage({})
    def test_founder_queue_deduplicates_without_stopping_independent_tasks(self):
        s={}
        r.founder_action(s,'LOY-138','sender approval','Provider approval required','Approve synthetic receipt session')
        r.founder_action(s,'LOY-138','sender approval','Provider approval required','Approve synthetic receipt session')
        self.assertEqual(len(s['founder_actions']),1)
        self.assertTrue(r.eligible({'key':'LOY-133:reward','gap_verified':True,'safe_local':True},s))
    def test_completed_slice_and_legacy_blocker_are_preserved(self):
        self.assertFalse(r.eligible({'key':'LOY-164:fixture','gap_verified':True,'safe_local':True},{'issues':{'LOY-164':{'outcome':'blocked'}}}))
        self.assertFalse(r.eligible({'key':'LOY-139:retry','gap_verified':True,'safe_local':True},{'slices':{'LOY-139:retry':{'outcome':'review'}}}))
    def test_worker_profile_denies_host_credentials_and_git_mutations(self):
        c=r.worker_config(Path('/private/tmp/task'))
        fs=c['permissions.autopilot.filesystem']
        self.assertEqual(fs[':root'],'deny')
        self.assertEqual(fs['/private/tmp/task/.git'],'read')
        self.assertEqual(fs['/private/tmp/task/.codex'],'deny')
        self.assertFalse(c['permissions.autopilot.network.enabled'])
        self.assertEqual(c['approval_policy'],'never')
    def test_budget_all_dimensions(self):
        for s in [{'tasks_completed':4},{'usage':{'total_tokens':2500000}}, {'usage':{'uncached_input_tokens':250000}}, {'usage':{'output_tokens':60000}}]:
            self.assertTrue(r.budget_reason(s))
    def test_atomic_state_preserves_history(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'state.json'; r.atomic(p,{'issues':{'LOY-164':{'outcome':'blocked'}}})
            self.assertEqual(json.loads(p.read_text())['issues']['LOY-164']['outcome'],'blocked')
            self.assertEqual(p.stat().st_mode & 0o777,0o600)
    def test_resume_never_blindly_reclaims_interrupted_task(self):
        with self.assertRaises(r.Refusal): r.recovery_check({'active':{'run':'old'}})
    def test_missing_transport_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(r.Refusal): r.tracker_token(Path(d)/'missing')
    def test_timeout_kills_process_group(self):
        with tempfile.TemporaryDirectory() as d:
            result=r.run_process(['/bin/sleep','30'],'',Path(d),0.1,{})
            self.assertEqual(result['exit_code'],124)
            self.assertLess(result['duration_seconds'],7)
    def test_second_process_cannot_claim_lock(self):
        with tempfile.TemporaryDirectory() as d:
            with r.locked_state(Path(d)):
                with self.assertRaises(r.Refusal):r.locked_state(Path(d))
    def test_stop_request_interrupts_worker(self):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d);r.atomic(parent/'stop.json',{'requested':True})
            result=r.run_process(['/bin/sleep','30'],'',parent/'run',10,{})
            self.assertEqual(result['exit_code'],130)
            self.assertLess(result['duration_seconds'],7)
    def test_pid_persistence_failure_does_not_orphan_worker(self):
        with tempfile.TemporaryDirectory() as d:
            real=r.atomic;started=[]
            def fail(path,value):
                if path.name=='process.json':started.append(value['pid']);raise OSError('simulated disk failure')
                return real(path,value)
            r.atomic=fail
            try:
                with self.assertRaises(OSError):r.run_process(['/bin/sleep','30'],'',Path(d),10,{})
            finally:r.atomic=real
            self.assertEqual(len(started),1)
            with self.assertRaises(ProcessLookupError):os.kill(started[0],0)

if __name__=='__main__':unittest.main()
