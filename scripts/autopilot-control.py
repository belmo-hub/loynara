#!/usr/bin/env python3
"""Local admission/accounting only; this is not an OS or MCP security sandbox."""
import argparse
import fcntl
import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path('/Users/youssefbelmokhtar/Desktop/Loynara')
FROZEN_SHA = '32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388'
FROZEN_BRANCH = 'codex/nfc-final-customer-policy-v1'
LAST_ADMISSION = datetime(2026, 10, 15, 16, 1, tzinfo=timezone.utc)
TRIAL_END = datetime(2026, 10, 15, 16, 45, tzinfo=timezone.utc)
OPERATIONS = {'read_issue', 'local_edit', 'local_test', 'local_commit', 'report'}

class Refusal(Exception):
    pass

def refuse(reason):
    raise Refusal(reason)

def now():
    return datetime.now(timezone.utc)

def release_preflight(repo):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.DEVNULL).strip()
    if git('rev-parse', 'refs/heads/' + FROZEN_BRANCH) != FROZEN_SHA:
        refuse('frozen_ref_drift')
    git('cat-file', '-e', FROZEN_SHA + '^{commit}')
    for block in git('worktree', 'list', '--porcelain').split('\n\n'):
        lines = block.splitlines()
        if 'branch refs/heads/' + FROZEN_BRANCH in lines:
            path = lines[0].removeprefix('worktree ')
            if subprocess.check_output(['git', '-C', path, 'status', '--porcelain'], text=True).strip():
                refuse('frozen_worktree_dirty')
    return {'frozen_sha': FROZEN_SHA, 'canonical_sha': git('rev-parse', 'HEAD'), 'canonical_branch': git('branch', '--show-current')}

def authorization(root):
    receipt = root / 'activation.json'
    if not receipt.exists():
        refuse('activation_missing')
    activation = json.loads(receipt.read_text())
    if activation.get('approval') != 'explicit-founder-autopilot-v1':
        refuse('activation_not_approved')
    expiry = min(datetime.fromisoformat(activation['expires_at']), TRIAL_END)
    if expiry <= now():
        refuse('trial_expired')
    if activation.get('sandbox_mode') != 'workspace-write' or activation.get('youtrack_identity') in (None, '', 'admin') or not activation.get('capability_restrictions_verified'):
        refuse('permissions_not_verified')
    return expiry

def apply(state, args, root):
    active = state.get('active')
    issues = state.setdefault('issues', {})
    if args.command == 'status':
        return state
    if args.command == 'claim':
        if not re.fullmatch(r'LOY-[1-9][0-9]*', args.issue):
            refuse('invalid_issue')
        if active:
            refuse('another_run_owns_lock')  # Never reclaim by time or PID.
        slug = getattr(args, 'slice', None)
        if slug:
            if not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', slug):
                refuse('invalid_slice')
            if not args.slice_evidence or not args.slice_evidence.is_file():
                refuse('slice_evidence_missing')
            proof = json.loads(args.slice_evidence.read_text())
            if (proof.get('issue') != args.issue or proof.get('slice') != slug or not proof.get('gap_verified')
                    or not proof.get('independent_of_acceptance') or not proof.get('source_refs')
                    or proof.get('required_authorizations') or proof.get('engineering_predecessors')):
                refuse('slice_not_independently_eligible')
            legacy = issues.get(args.issue, {})
            if legacy.get('outcome') and not legacy.get('slice'):
                refuse('recorded_blocker_requires_review')
            issue = state.setdefault('slices', {}).get(args.issue + ':' + slug, {})
        else:
            issue = issues.get(args.issue, {})
        if issue.get('outcome') == 'review':
            refuse('already_ready_for_review')
        if issue.get('approaches', 0) >= 2:
            refuse('two_approaches_exhausted')
        if issue.get('outcome') in ('blocked', 'no_change'):
            refuse('recorded_blocker_requires_review')
        expiry = None
        if not args.rehearsal:
            expiry = authorization(root)
            if now() >= LAST_ADMISSION:
                refuse('last_admission_passed')
            if state.get('scheduled_runs', 0) >= 10:
                refuse('run_budget_exhausted')
            state['scheduled_runs'] = state.get('scheduled_runs', 0) + 1
        preflight = release_preflight(args.repo)
        start = now()
        active = {'run': str(uuid.uuid4()), 'issue': args.issue, 'started_at': start.isoformat(), 'deadline': min(start + timedelta(minutes=45), expiry or start + timedelta(minutes=45)).isoformat(), 'mode': 'rehearsal' if args.rehearsal else 'scheduled', **preflight}
        if slug:
            active['slice'] = slug
            active['slice_evidence'] = str(args.slice_evidence)
        state['active'] = active
        return active
    if not active or active['run'] != args.run:
        refuse('wrong_owner')
    if args.command == 'finish':
        if args.outcome == 'review' and (not args.sha or not re.fullmatch('[0-9a-f]{40}', args.sha) or not args.evidence):
            refuse('review_evidence_missing')
        if args.outcome == 'review':
            if datetime.fromisoformat(active['deadline']) <= now():
                refuse('deadline_reached')
            if active['mode'] == 'scheduled':
                authorization(root)
            subprocess.check_call(['git', '-C', str(args.repo), 'cat-file', '-e', args.sha + '^{commit}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            evidence = Path(args.evidence)
            if not evidence.is_file():
                refuse('review_evidence_missing')
            report = json.loads(evidence.read_text())
            if report.get('issue') != active['issue'] or report.get('sha') != args.sha or report.get('base_sha') != FROZEN_SHA:
                refuse('review_evidence_mismatch')
        slug = active.get('slice') or getattr(args, 'slice', None)
        if slug:
            if not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', slug):
                refuse('invalid_slice')
            if not active.get('slice'):
                if args.outcome != 'review' or report.get('slice') != slug:
                    refuse('slice_evidence_mismatch')
            item = state.setdefault('slices', {}).setdefault(active['issue'] + ':' + slug, {})
            if not active.get('slice'):
                item['approaches'] = issues.get(active['issue'], {}).get('approaches', 0)
            item['slice'] = slug
        else:
            item = issues.setdefault(active['issue'], {})
        item.update({'outcome': args.outcome, 'run': args.run, 'finished_at': now().isoformat(), 'sha': args.sha, 'evidence': args.evidence})
        if slug:
            issues[active['issue']] = dict(item)
        state['active'] = None
        return {'issue': active['issue'], **item}
    if active['mode'] == 'scheduled':
        authorization(root)
    if datetime.fromisoformat(active['deadline']) <= now():
        refuse('deadline_reached')
    if args.command == 'check':
        if args.operation not in OPERATIONS:
            refuse('operation_not_authorized')
        return {'operation': args.operation, 'admitted': True}
    if args.command == 'approach':
        item = state.setdefault('slices', {}).setdefault(active['issue'] + ':' + active['slice'], {}) if active.get('slice') else issues.setdefault(active['issue'], {})
        if item.get('approaches', 0) >= 2:
            refuse('two_approaches_exhausted')
        item['approaches'] = item.get('approaches', 0) + 1
        return {'issue': active['issue'], 'approach': item['approaches']}
    refuse('unknown_command')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=REPO / 'var/autopilot-v1')
    parser.add_argument('--repo', type=Path, default=REPO)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status')
    commands.add_parser('preflight')
    claim = commands.add_parser('claim')
    claim.add_argument('--issue', required=True)
    claim.add_argument('--rehearsal', action='store_true')
    claim.add_argument('--slice')
    claim.add_argument('--slice-evidence', type=Path)
    for name in ('approach', 'check', 'finish'):
        cmd = commands.add_parser(name)
        cmd.add_argument('--run', required=True)
        if name == 'check':
            cmd.add_argument('--operation', required=True)
        if name == 'finish':
            cmd.add_argument('--outcome', choices=['review', 'blocked', 'no_change'], required=True)
            cmd.add_argument('--slice')
            cmd.add_argument('--sha')
            cmd.add_argument('--evidence')
    args = parser.parse_args()
    try:
        if args.command == 'preflight':
            result = release_preflight(args.repo)
        else:
            args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            path = args.state_dir / 'state.json'
            descriptor = os.open(args.state_dir / 'state.lock', os.O_RDWR | os.O_CREAT, 0o600)
            with os.fdopen(descriptor, 'r+') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                state = json.loads(path.read_text()) if path.exists() else {}
                result = apply(state, args, args.state_dir)
                temporary = args.state_dir / ('state-' + str(uuid.uuid4()) + '.tmp')
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w') as out:
                    json.dump(state, out, indent=2)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temporary, path)
        print(json.dumps({'ok': True, **result}))
        return 0
    except (Refusal, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        reason = str(error) if isinstance(error, Refusal) else 'invalid_or_unavailable_state'
        print(json.dumps({'ok': False, 'reason': reason}))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
