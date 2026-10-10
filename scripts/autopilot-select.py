#!/usr/bin/env python3
"""Deterministic discovery; this reports candidates, never starts an executor."""
import argparse
import json
from pathlib import Path

LAUNCH = {'Must Launch', 'Scope Decision Required'}
CATEGORIES = {'Missing engineering work', 'Implemented but untested', 'Physical acceptance needed', 'External provider dependency', 'Founder decision needed', 'Legally/commercially gated', 'Completed with evidence'}

def discover(snapshot, evidence, state):
    issues = snapshot['inventory']
    ids = [item['id'] for item in issues]
    if len(ids) != len(set(ids)) or len(ids) != snapshot['expected_count'] or not snapshot['pagination_complete']:
        raise ValueError('Incomplete or duplicate inventory: cannot conclude no work exists')
    by_id = {item['id']: item for item in issues}
    details = {item['id']: item for item in snapshot['details']}
    dependencies = snapshot['dependencies']
    relevant = [item for item in issues if item.get('customFields', {}).get('Launch requirement') in LAUNCH]
    for issue in relevant:
        detail = details.get(issue['id'])
        if detail is None:
            raise ValueError('Missing issue details: ' + issue['id'])
        count = detail.get('linkedIssueCounts', {}).get('depends on', 0)
        if len(dependencies.get(issue['id'], [])) != count:
            raise ValueError('Incomplete hard dependencies: ' + issue['id'])
    candidates, excluded = [], []
    for task in evidence['slices']:
        issue = by_id.get(task['issue'])
        reasons = []
        if issue is None or issue not in relevant:
            reasons.append('Not a recorded full-launch requirement')
        if not task.get('source_refs') or not task.get('gap_verified'):
            reasons.append('No demonstrated source/test gap')
        if task.get('category') not in {'Missing engineering work', 'Implemented but untested'}:
            reasons.append('No local engineering deliverable')
        if task.get('required_authorizations'):
            reasons.append('Action-specific human authorization required')
        if task.get('engineering_predecessors'):
            reasons.append('Engineering predecessor incomplete')
        if dependencies.get(task['issue']) and not task.get('independent_of_acceptance'):
            reasons.append('Issue prerequisites not separated from slice dependencies')
        key = task['issue'] + ':' + task['slice']
        history = state.get('slices', {}).get(key, {})
        if history.get('outcome') in {'review', 'blocked', 'no_change'} or history.get('approaches', 0) >= 2:
            reasons.append('Existing slice history requires review/new evidence')
        # Preserve legacy issue outcomes. A different engineering slice must carry
        # evidence distinguishing it from the recorded attempt before selection.
        legacy = state.get('issues', {}).get(task['issue'], {})
        if legacy.get('outcome') and (not legacy.get('slice') or legacy.get('slice') == task['slice']):
            reasons.append('Recorded issue outcome has not been reconciled')
        if reasons:
            excluded.append({'key': key, 'reasons': reasons})
            continue
        candidates.append({**task, 'key': key, 'stage': issue['customFields'].get('Stage'),
                           'lane': issue['customFields'].get('Execution responsibility'),
                           'issue_predecessors': dependencies.get(task['issue'], [])})
    candidates.sort(key=lambda t: (-t['launch_importance'], -t['merchant_value'], t['risk'], t['effort_minutes'], t['expected_uncached_tokens'], t['key']))
    assessed = {task['issue'] for task in evidence['slices']}
    pending = [item['id'] for item in relevant if item['id'] not in assessed and item['customFields'].get('Stage') != 'Done']
    # A stop is global only after full launch discovery and gap assessment. An
    # unresolved assessment never becomes an invented implementation task.
    return {'inventory_count': len(issues), 'launch_count': len(relevant), 'candidates': candidates,
            'excluded': excluded, 'unassessed_issue_ids': pending,
            'discovery_complete': not pending, 'can_assert_no_engineering_work': not candidates and not pending,
            'admission_blocker': 'another_run_owns_lock' if state.get('active') else None,
            'next_action': 'review_one_candidate' if candidates else 'assess_next_unverified_slice' if pending else 'report_no_eligible_work'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = discover(json.loads(args.snapshot.read_text()), json.loads(args.evidence.read_text()), json.loads(args.state.read_text()))
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'ok': False, 'reason': str(error)}))
        return 2
    print(json.dumps({'ok': True, **result}, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
