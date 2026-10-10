import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('selector', Path(__file__).with_name('autopilot-select.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fixture(stage='Blocked', lane='Claude'):
    inventory = [{'id':'LOY-139','customFields':{'Launch requirement':'Must Launch','Stage':stage,'Execution responsibility':lane}},
                 {'id':'LOY-164','customFields':{'Launch requirement':'Must Launch','Stage':'Ready'}}]
    snapshot = {'inventory':inventory,'expected_count':2,'pagination_complete':True,
                'details':[{'id':'LOY-139','linkedIssueCounts':{'depends on':1}}, {'id':'LOY-164','linkedIssueCounts':{}}],
                'dependencies':{'LOY-139':['LOY-138']}}
    task = {'issue':'LOY-139','slice':'rate-limit-retry','category':'Missing engineering work','gap_verified':True,
            'source_refs':['base:src/lib/transactional-email.ts:87'],'independent_of_acceptance':True,
            'required_authorizations':[], 'engineering_predecessors':[], 'launch_importance':5,'merchant_value':5,
            'risk':2,'effort_minutes':45,'expected_uncached_tokens':15000}
    return snapshot, {'slices':[task]}, {'issues':{'LOY-164':{'outcome':'blocked'}}}

class SelectionTests(unittest.TestCase):
    def test_external_acceptance_blocker_does_not_hide_proven_independent_engineering(self):
        for stage in ['Backlog','Ready','In Progress','Blocked']:
            with self.subTest(stage=stage):
                result=module.discover(*fixture(stage))
                self.assertEqual([t['key'] for t in result['candidates']], ['LOY-139:rate-limit-retry'])
    def test_unassessed_launch_inventory_prevents_global_no_work_claim(self):
        snapshot,evidence,state=fixture();evidence['slices']=[]
        result=module.discover(snapshot,evidence,state)
        self.assertFalse(result['can_assert_no_engineering_work'])
        self.assertEqual(result['next_action'],'assess_next_unverified_slice')
    def test_missing_gap_or_authorization_is_not_invented_as_work(self):
        for field,value in [('gap_verified',False),('required_authorizations',['external-send']),('engineering_predecessors',['unbuilt-consent']),('independent_of_acceptance',False)]:
            snapshot,evidence,state=fixture();evidence['slices'][0][field]=value
            self.assertEqual(module.discover(snapshot,evidence,state)['candidates'],[])
    def test_incomplete_pagination_and_dependencies_fail_closed(self):
        for field,value in [('pagination_complete',False),('expected_count',3),('dependencies',{})]:
            snapshot,evidence,state=fixture();snapshot[field]=value
            with self.assertRaises(ValueError):module.discover(snapshot,evidence,state)
    def test_preserves_existing_blocked_slice_and_single_run_lock(self):
        snapshot,evidence,state=fixture();state['slices']={'LOY-139:rate-limit-retry':{'outcome':'blocked'}}
        self.assertEqual(module.discover(snapshot,evidence,state)['candidates'],[])
        state['slices']={};state['active']={'issue':'LOY-164'}
        self.assertEqual(module.discover(snapshot,evidence,state)['admission_blocker'],'another_run_owns_lock')
    def test_completed_record_is_not_reopened_without_distinct_evidence(self):
        snapshot,evidence,state=fixture();state['issues']['LOY-139']={'outcome':'review'}
        self.assertEqual(module.discover(snapshot,evidence,state)['candidates'],[])
    def test_fully_assessed_no_safe_slice_can_stop(self):
        snapshot,evidence,state=fixture();snapshot['inventory']=snapshot['inventory'][:1];snapshot['details']=snapshot['details'][:1];snapshot['expected_count']=1
        evidence['slices'][0]['required_authorizations']=['sender-activation']
        self.assertTrue(module.discover(snapshot,evidence,state)['can_assert_no_engineering_work'])

if __name__=='__main__':unittest.main()
