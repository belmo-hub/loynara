"""Isolated transport checks for the production backup shell job."""

import os
import subprocess
import tempfile
import time
import shlex
from pathlib import Path


SCRIPT = Path(__file__).with_name("production-backup.sh")
PING = "https://hc-ping.com/00000000-0000-4000-8000-000000000001"


def run_case(fail_upload=False, fail_dump=False, hang_upload=False, timeout_seconds="1", namespace_missing=False, schema="t"):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        commands = root / "commands"
        for name, body in {
            "pg_dump": "printf 'pg_dump\\n' >> \"$TEST_COMMANDS\"; if [ \"${FAIL_DUMP:-0}\" = 1 ]; then printf 'synthetic-secret-not-for-logs synthetic-customer@example.test' >&2; exit 9; fi; printf 'synthetic-dump'",
            "psql": "printf '%s\\n' \"$TEST_SCHEMA\"",
            "age": "cat",
            "aws": r'''printf 'aws %s\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  *'--bucket synthetic-closure'*) printf '%s' '{"Metadata":{"namespace":"44444444-4444-4444-8444-444444444444","policy":"2026-10-15","purpose":"closure"}}';;
  *'--bucket synthetic-erasure'*)
    if [ "${NAMESPACE_MISSING:-0}" = 1 ]; then exit 8; fi
    printf '%s' '{"Metadata":{"namespace":"33333333-3333-4333-8333-333333333333","policy":"2026-10-15","purpose":"purge"}}';;
  *' s3 cp '*)
    if [ "${HANG_UPLOAD:-0}" = 1 ]; then sleep 5; fi
    if [ "${FAIL_UPLOAD:-0}" = 1 ]; then printf 'synthetic-secret-not-for-logs' >&2; exit 5; fi;;
esac''',
            "curl": "for arg in \"$@\"; do case \"$arg\" in https://hc-ping.com/*) printf 'ping %s\\n' \"$arg\" >> \"$TEST_COMMANDS\";; esac; done",
        }.items():
            target = bin_dir / name
            target.write_text("#!/bin/sh\nTEST_COMMANDS=" + shlex.quote(str(commands)) + "\nNAMESPACE_MISSING=" + ("1" if namespace_missing else "0") + "\n" + body + "\n")
            target.chmod(0o700)
        env = os.environ.copy()
        env.update({
            "PATH": str(bin_dir) + os.pathsep + env["PATH"],
            "TEST_COMMANDS": str(commands),
            "NAMESPACE_MISSING": "1" if namespace_missing else "0",
            "ERASURE_S3_ENDPOINT": "https://" + "a" * 32 + ".eu.r2.cloudflarestorage.com",
            "ERASURE_CLOSURE_S3_ENDPOINT": "https://" + "a" * 32 + ".eu.r2.cloudflarestorage.com",
            "ERASURE_CLOSURE_S3_BUCKET": "synthetic-closure", "ERASURE_CLOSURE_S3_PREFIX": "closure-v1",
            "ERASURE_CLOSURE_NAMESPACE_ID": "44444444-4444-4444-8444-444444444444",
            "ERASURE_CLOSURE_AWS_ACCESS_KEY_ID": "synthetic-closure-access", "ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY": "synthetic-closure-secret",
            "ERASURE_S3_BUCKET": "synthetic-erasure", "ERASURE_S3_PREFIX": "erasure-v1",
            "ERASURE_NAMESPACE_ID": "33333333-3333-4333-8333-333333333333",
            "ERASURE_AWS_ACCESS_KEY_ID": "synthetic-erasure-access", "ERASURE_AWS_SECRET_ACCESS_KEY": "synthetic-erasure-secret",
            "FAIL_UPLOAD": "1" if fail_upload else "0",
            "FAIL_DUMP": "1" if fail_dump else "0",
            "HANG_UPLOAD": "1" if hang_upload else "0",
            "BACKUP_TOOL_TIMEOUT_SECONDS": timeout_seconds,
            "TEST_SCHEMA": schema,
            "PRODUCTION_ENVIRONMENT": "loynara-production",
            "PGHOST": "postgres.railway.internal",
            "PGDATABASE": "loynara_test",
            "PGUSER": "test",
            "PGPASSWORD": "synthetic-secret-not-for-logs",
            "BACKUP_S3_ENDPOINT": "https://" + "a" * 32 + ".eu.r2.cloudflarestorage.com",
            "BACKUP_S3_BUCKET": "loynara-test",
            "BACKUP_AGE_RECIPIENT": "age1synthetic-recipient",
            "AWS_ACCESS_KEY_ID": "synthetic-access-id",
            "AWS_SECRET_ACCESS_KEY": "synthetic-secret-not-for-logs",
            "AWS_DEFAULT_REGION": "auto",
            "BACKUP_HEARTBEAT_URL": PING,
        })
        result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=15)
        return result, commands.read_text().splitlines() if commands.exists() else []


success, actions = run_case()
assert success.returncode == 0, success.stderr
assert actions[0] == "ping " + PING + "/start", actions
assert any(" s3 cp " in action for action in actions), actions
assert any("s3api head-object" in action for action in actions), actions
assert actions[-1] == "ping " + PING, actions
assert "synthetic-secret-not-for-logs" not in success.stdout + success.stderr

failure, actions = run_case(fail_upload=True)
assert failure.returncode != 0
assert actions[0] == "ping " + PING + "/start", actions
assert actions[-1] == "ping " + PING + "/fail", actions
assert not any("s3api head-object" in action and "--bucket loynara-test" in action for action in actions), actions
assert "synthetic-secret-not-for-logs" not in failure.stdout + failure.stderr
print("production backup transport PASS: upload/HEAD then success; upload failure signals monitor without secret output")

failed_dump, actions = run_case(fail_dump=True)
assert failed_dump.returncode != 0
assert "synthetic-secret-not-for-logs" not in failed_dump.stdout + failed_dump.stderr
assert "synthetic-customer" not in failed_dump.stdout + failed_dump.stderr
assert not any(" s3 cp " in action for action in actions)
started = time.monotonic()
hung, actions = run_case(hang_upload=True)
assert hung.returncode != 0
assert time.monotonic() - started < 4
assert "timed out" in hung.stderr
print("production backup failure privacy/timeouts PASS")

for seconds in ('0', '1801', '08', 'invalid', '9' * 40):
    rejected, actions = run_case(timeout_seconds=seconds)
    assert rejected.returncode != 0
    assert "Backup refused: tool timeout" in rejected.stderr
    assert not any(" s3 cp " in action for action in actions)
print("production backup invalid timeout guard PASS")

missing, actions = run_case(namespace_missing=True)
assert missing.returncode != 0
assert not any(" s3 cp " in action for action in actions)
assert actions[-1] == "ping " + PING + "/fail"
print("production backup independent erasure namespace gate PASS")

# A valid login to a database without Loynara's schema (PGDATABASE=postgres, say) must not dump, upload or report success.
wrong, actions = run_case(schema="f")
assert wrong.returncode != 0
assert "pg_dump" not in actions, actions
assert not any(" s3 cp " in action for action in actions), actions
assert actions[-1] == "ping " + PING + "/fail", actions
assert "synthetic-secret-not-for-logs" not in wrong.stdout + wrong.stderr

print("production backup source schema gate PASS: a database without the Loynara schema signals the monitor without dump or upload")
