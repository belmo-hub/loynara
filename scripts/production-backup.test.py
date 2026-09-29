"""Isolated transport checks for the production backup shell job."""

import os
import subprocess
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("production-backup.sh")
PING = "https://hc-ping.com/00000000-0000-4000-8000-000000000001"


def run_case(fail_upload=False):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        commands = root / "commands"
        for name, body in {
            "pg_dump": "printf 'synthetic-dump'",
            "age": "cat",
            "aws": "printf 'aws %s\\n' \"$*\" >> \"$TEST_COMMANDS\"; case \"$*\" in *' s3 cp '*) if [ \"${FAIL_UPLOAD:-0}\" = 1 ]; then exit 5; fi;; esac",
            "curl": "for arg in \"$@\"; do case \"$arg\" in https://hc-ping.com/*) printf 'ping %s\\n' \"$arg\" >> \"$TEST_COMMANDS\";; esac; done",
        }.items():
            target = bin_dir / name
            target.write_text("#!/bin/sh\n" + body + "\n")
            target.chmod(0o700)
        env = os.environ.copy()
        env.update({
            "PATH": str(bin_dir) + os.pathsep + env["PATH"],
            "TEST_COMMANDS": str(commands),
            "FAIL_UPLOAD": "1" if fail_upload else "0",
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
        result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
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
assert not any("s3api head-object" in action for action in actions), actions
assert "synthetic-secret-not-for-logs" not in failure.stdout + failure.stderr
print("production backup transport PASS: upload/HEAD then success; upload failure signals monitor without secret output")
