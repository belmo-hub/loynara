#!/usr/bin/env python3
"""Automated ticket loop.

One cycle takes the next tickets tagged `agent-ready` in the tracker, runs each through scripts/ticket-run.sh with the
implementation command, and turns the result into a pull request for a person to review. It never merges.

  ticket-cycle.py run          one scheduled cycle (respects the pause file, the night window and the daily cap)
  ticket-cycle.py once LOY-57  process one ticket now, ignoring the window and the tag
  ticket-cycle.py check        verify configuration and access, read-only
  ticket-cycle.py status       show pause state, today's count, lock and recent logs
  ticket-cycle.py pause|resume create / remove the pause file (stops all cycles)

Configuration comes from KEY=VALUE lines in $LOOP_CONFIG (default ~/.config/loynara-loop/config.env, keep it mode 0600)
and can be overridden by environment variables. See scripts/ticket-loop.config.example. The commands that do the work
are configuration (IMPLEMENT_CMD, REVIEW_CMD); this file names no tool.

Safety rules that are enforced here, not left to the commands:
  * only branches named ticket/LOY-<number> are ever pushed, with an explicit refspec; never main, never a force push
  * the loop has no merge, release or delete code at all
  * a diff that is too large, or that adds something that looks like a secret, is not pushed
  * a ticket the command could not change is returned to the founder with the command's last output
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

HOME = Path.home()
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO = Path(subprocess.run(["git", "-C", str(SCRIPT_DIR), "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or SCRIPT_DIR.parent)

DEFAULTS = {
    "YOUTRACK_URL": "https://loynara.youtrack.cloud",
    "YOUTRACK_TOKEN_FILE": str(HOME / ".config/loynara-loop/youtrack.token"),
    "YOUTRACK_PROJECT": "LOY",
    "REPO_DIR": str(DEFAULT_REPO),
    "GH_REPO": "",                      # owner/name; derived from the origin remote when empty
    "BASE_BRANCH": "",                  # required: the development branch pull requests target
    "BASE_REF": "",                     # defaults to origin/<BASE_BRANCH>
    "IMPLEMENT_CMD": "",                # required: runs inside the ticket worktree, reads $AGENT_PROMPT
    "REVIEW_CMD": "",                   # optional: read-only review, reads $AGENT_PROMPT and $REVIEW_DIFF_FILE, prints to stdout
    "MAX_PER_DAY": "3",
    "MAX_PER_CYCLE": "1",
    "WINDOW_START": "22",               # local hour the loop may start (inclusive)
    "WINDOW_END": "7",                  # local hour the loop must stop starting (exclusive)
    "IMPLEMENT_TIMEOUT_SEC": "3600",
    "IMPLEMENT_MAX_TURNS": "60",
    "IMPLEMENT_MAX_BUDGET": "8",        # passed to the command as AGENT_MAX_BUDGET (currency units, if the command supports it)
    "REVIEW_TIMEOUT_SEC": "900",
    "MAX_DIFF_LINES": "1200",           # above this the branch is kept locally and not pushed
    "WARN_DIFF_LINES": "300",
    "RUNS_DIR": str(HOME / "Developer/Loynara-runs"),
    "TAG_READY": "agent-ready",
    "TAG_WORKING": "agent-working",
    "TAG_PR": "agent-pr",
    "TAG_NEEDS": "needs-founder",
    "TAG_FAILED": "agent-failed",
    "SKIP_TAGS": "needs-founder,needs-hardware,needs-legal,needs-decision",
    "STATE_COMMAND": "Stage {In Review}",
    "DRY_RUN": "0",
}

SECRET_PATTERNS = [
    r"sk_live_[A-Za-z0-9_-]{16,}", r"-----BEGIN [A-Z ]*PRIVATE KEY-----", r"AKIA[0-9A-Z]{16}",
    r"(?i)\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*['\"][^'\"\s]{16,}['\"]", r"perm:[A-Za-z0-9._-]{20,}",
    r"gh[pousr]_[A-Za-z0-9]{30,}",
]


def log(msg):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def load_config():
    cfg = dict(DEFAULTS)
    path = Path(os.environ.get("LOOP_CONFIG", HOME / ".config/loynara-loop/config.env"))
    if path.exists():
        for line in path.read_text().splitlines():
            if line.lstrip().startswith("#"):
                continue
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if not m or m.group(1) not in DEFAULTS:
                continue
            value = m.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            cfg[m.group(1)] = value
    for key in DEFAULTS:
        if key in os.environ:
            cfg[key] = os.environ[key]
    if not cfg["BASE_REF"] and cfg["BASE_BRANCH"]:
        cfg["BASE_REF"] = "origin/" + cfg["BASE_BRANCH"]
    return cfg


def redact(text):
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{12,}", r"\1***", text)
    for pattern in SECRET_PATTERNS:
        text = re.sub(pattern, "***", text)
    return text


def run(cmd, cwd=None, check=False, env=None, timeout=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check, env=env, timeout=timeout)


class Tracker:
    """Small client for the tracker's REST API (YouTrack). Writes are skipped in dry-run mode."""

    def __init__(self, cfg):
        self.base = cfg["YOUTRACK_URL"].rstrip("/")
        self.dry = cfg["DRY_RUN"] == "1"
        self.token = ""
        token_file = Path(cfg["YOUTRACK_TOKEN_FILE"]).expanduser()
        if token_file.exists():
            self.token = token_file.read_text().strip()
        self._tags = {}

    def request(self, method, path, body=None):
        if not self.token:
            raise RuntimeError("no tracker token (YOUTRACK_TOKEN_FILE is missing or empty)")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token, "Accept": "application/json", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"tracker {method} {path.split('?')[0]} -> HTTP {e.code}: {e.read().decode()[:200]}") from None

    def me(self):
        return self.request("GET", "/api/users/me?fields=login")

    def find(self, query, top):
        q = urllib.parse.quote(query)
        return self.request("GET", f"/api/issues?query={q}&fields=idReadable,summary&$top={top}") or []

    def issue_text(self, issue, fallback):
        """The ticket title and description as plain text, so the command needs no tracker access of its own."""
        try:
            data = self.request("GET", f"/api/issues/{issue}?fields=idReadable,summary,description") or {}
            return f"# {data.get('idReadable', issue)}: {data.get('summary', fallback)}\n\n{data.get('description') or '(no description)'}\n"
        except RuntimeError as e:
            log(f"warning: could not read {issue}: {e}")
            return f"# {issue}: {fallback}\n\n(the description could not be read)\n"

    def tag_id(self, name):
        if name in self._tags:
            return self._tags[name]
        q = urllib.parse.quote(name)
        for tag in self.request("GET", f"/api/tags?query={q}&fields=id,name&$top=50") or []:
            if tag["name"] == name:
                self._tags[name] = tag["id"]
                return tag["id"]
        if self.dry:
            return "dry-run-tag"
        created = self.request("POST", "/api/tags?fields=id,name", {"name": name})
        self._tags[name] = created["id"]
        return created["id"]

    def add_tag(self, issue, name):
        if self.dry:
            return log(f"[dry-run] tag {issue} +{name}")
        try:
            self.request("POST", f"/api/issues/{issue}/tags?fields=id", {"id": self.tag_id(name)})
        except RuntimeError as e:
            log(f"warning: could not add tag {name} to {issue}: {e}")

    def remove_tag(self, issue, name):
        if self.dry:
            return log(f"[dry-run] tag {issue} -{name}")
        try:
            self.request("DELETE", f"/api/issues/{issue}/tags/{self.tag_id(name)}")
        except RuntimeError as e:
            log(f"note: tag {name} not removed from {issue}: {e}")

    def comment(self, issue, text):
        if self.dry:
            return log(f"[dry-run] comment on {issue}: {text[:90]!r}")
        try:
            self.request("POST", f"/api/issues/{issue}/comments?fields=id", {"text": text})
        except RuntimeError as e:
            log(f"warning: could not comment on {issue}: {e}")

    def command(self, issue, query):
        if self.dry:
            return log(f"[dry-run] command on {issue}: {query}")
        try:
            self.request("POST", "/api/commands", {"query": query, "issues": [{"idReadable": issue}]})
        except RuntimeError as e:
            log(f"warning: command {query!r} failed on {issue}: {e}")


class Loop:
    def __init__(self, cfg):
        self.cfg = cfg
        self.repo = Path(cfg["REPO_DIR"])
        self.runs = Path(cfg["RUNS_DIR"]).expanduser()
        self.state = self.runs / "state"
        self.state.mkdir(parents=True, exist_ok=True)
        (self.runs / "logs").mkdir(parents=True, exist_ok=True)
        self.dry = cfg["DRY_RUN"] == "1"
        self.tracker = Tracker(cfg)

    # ---- helpers
    def git(self, *args, check=False):
        return run(["git", "-C", str(self.repo), *args], check=check)

    def gh_repo(self):
        if self.cfg["GH_REPO"]:
            return self.cfg["GH_REPO"]
        url = self.git("remote", "get-url", "origin").stdout.strip()
        m = re.search(r"github\.com[:/]([^/]+/[^/.]+?)(?:\.git)?$", url)
        if not m:
            raise RuntimeError("could not work out the GitHub repository; set GH_REPO")
        return m.group(1)

    def pause_file(self):
        return self.runs / "PAUSE"

    def today_file(self):
        return self.state / f"count-{datetime.now().strftime('%Y-%m-%d')}"

    def done_today(self):
        f = self.today_file()
        return int(f.read_text() or 0) if f.exists() else 0

    def bump(self):
        self.today_file().write_text(str(self.done_today() + 1))

    def in_window(self):
        start, end, hour = int(self.cfg["WINDOW_START"]), int(self.cfg["WINDOW_END"]), datetime.now().hour
        return (hour >= start or hour < end) if start > end else (start <= hour < end)

    def candidate_query(self):
        parts = [f"project: {self.cfg['YOUTRACK_PROJECT']}", "#Unresolved", f"tag: {{{self.cfg['TAG_READY']}}}"]
        skip = [self.cfg["TAG_WORKING"], self.cfg["TAG_PR"], self.cfg["TAG_FAILED"]] + [t for t in self.cfg["SKIP_TAGS"].split(",") if t]
        parts += [f"-tag: {{{t}}}" for t in skip]
        return " ".join(parts)

    # ---- lock
    def acquire(self):
        lock = self.state / "cycle.lock"
        if lock.exists():
            try:
                pid = int(lock.read_text())
                os.kill(pid, 0)
                return False
            except (ValueError, ProcessLookupError, PermissionError):
                pass
        lock.write_text(str(os.getpid()))
        return True

    def release(self):
        (self.state / "cycle.lock").unlink(missing_ok=True)

    # ---- one ticket
    def process(self, issue, summary):
        cfg, t = self.cfg, self.tracker
        branch = f"ticket/{issue}"
        if not re.fullmatch(r"ticket/LOY-\d+", branch):
            raise RuntimeError(f"refusing odd ticket id {issue!r}")
        log(f"{issue}: starting ({summary[:70]})")
        t.add_tag(issue, cfg["TAG_WORKING"])
        t.remove_tag(issue, cfg["TAG_READY"])
        t.comment(issue, "Automated run started. It works on a separate branch and opens a pull request for review. Nothing is merged without a person.")

        ticket_file = self.runs / "tickets" / f"{issue}.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text(redact(t.issue_text(issue, summary)))
        env = dict(os.environ, TICKET_FILE=str(ticket_file), AGENT_CMD=cfg["IMPLEMENT_CMD"], AGENT_TIMEOUT_SEC=cfg["IMPLEMENT_TIMEOUT_SEC"],
                   AGENT_MAX_TURNS=cfg["IMPLEMENT_MAX_TURNS"], AGENT_MAX_BUDGET=cfg["IMPLEMENT_MAX_BUDGET"],
                   BASE_REF=cfg["BASE_REF"], RUNS_DIR=str(self.runs))
        if self.dry:
            log(f"[dry-run] would run ticket-run.sh {issue}")
            return
        self.git("fetch", "origin", "--quiet")
        rc = subprocess.run([str(SCRIPT_DIR / "ticket-run.sh"), issue], env=env, cwd=self.repo).returncode
        log_tail = self.log_tail(issue)

        have_branch = self.git("show-ref", "--verify", "--quiet", f"refs/heads/{branch}").returncode == 0
        commits = int(self.git("rev-list", "--count", f"{cfg['BASE_REF']}..{branch}").stdout.strip() or 0) if have_branch else 0

        if commits == 0:
            reason = "The run did not change anything." if rc == 0 else f"The run ended with exit code {rc} and no change."
            t.comment(issue, f"{reason} Last output:\n\n```\n{log_tail}\n```\n\nA decision, a real device or more detail is probably needed. Tagged for the founder.")
            t.add_tag(issue, cfg["TAG_NEEDS"])
            t.remove_tag(issue, cfg["TAG_WORKING"])
            return log(f"{issue}: no change; returned to founder")

        stat = self.git("diff", "--shortstat", f"{cfg['BASE_REF']}...{branch}").stdout.strip()
        numstat = self.git("diff", "--numstat", f"{cfg['BASE_REF']}...{branch}").stdout.splitlines()
        lines = sum(int(a) + int(b) for a, b, _ in (l.split("\t") for l in numstat) if a.isdigit() and b.isdigit())
        added = self.git("diff", "-U0", f"{cfg['BASE_REF']}...{branch}").stdout
        secret = next((p for p in SECRET_PATTERNS if re.search(p, "\n".join(l for l in added.splitlines() if l.startswith("+")))), None)
        problem = None
        if secret:
            problem = "the diff adds something that looks like a secret"
        elif lines > int(cfg["MAX_DIFF_LINES"]):
            problem = f"the change is too large ({lines} lines changed); split the ticket"
        elif rc != 0:
            problem = f"the run ended with exit code {rc} (time limit or error)"
        if problem:
            t.comment(issue, f"Not pushed: {problem}. {commits} commit(s) are kept locally on branch {branch} for a person to inspect.")
            t.add_tag(issue, cfg["TAG_FAILED"])
            t.remove_tag(issue, cfg["TAG_WORKING"])
            return log(f"{issue}: not pushed ({problem})")

        # The only push the loop ever makes: one explicit ticket branch, no force.
        push = self.git("push", "origin", f"refs/heads/{branch}:refs/heads/{branch}")
        if push.returncode != 0:
            t.comment(issue, "The branch could not be pushed: " + redact(push.stderr[-300:]))
            t.add_tag(issue, cfg["TAG_FAILED"])
            t.remove_tag(issue, cfg["TAG_WORKING"])
            return log(f"{issue}: push failed")
        pr_url = self.open_pr(issue, summary, branch, commits, stat, lines)
        self.review(issue, branch, pr_url)
        t.comment(issue, f"Pull request ready for review: {pr_url}\n\n{commits} commit(s), {stat or 'no stat'}.")
        t.add_tag(issue, cfg["TAG_PR"])
        t.remove_tag(issue, cfg["TAG_WORKING"])
        t.command(issue, cfg["STATE_COMMAND"])
        log(f"{issue}: pull request {pr_url}")

    def log_tail(self, issue, n=25):
        p = self.runs / "logs" / f"{issue}.log"
        if not p.exists():
            return "(no log)"
        lines = [l for l in p.read_text(errors="replace").splitlines() if l.strip()]
        return redact("\n".join(lines[-n:]))[-3000:]

    def open_pr(self, issue, summary, branch, commits, stat, lines):
        cfg = self.cfg
        subjects = self.git("log", "--format=- %s", f"{cfg['BASE_REF']}..{branch}").stdout.strip()
        size_note = "" if lines <= int(cfg["WARN_DIFF_LINES"]) else f"\n\n**Larger than the usual size** ({lines} lines changed). Consider splitting it.\n"
        touched = self.git("diff", "--name-only", f"{cfg['BASE_REF']}...{branch}").stdout.splitlines()
        careful = [f for f in touched if f.startswith(".github/") or f.startswith("drizzle/") or f.startswith("scripts/ticket-")]
        careful_note = ("\n\n**Needs a careful look** (CI, migration or loop files changed):\n" + "\n".join(f"- {f}" for f in careful)) if careful else ""
        body = (f"Ticket: {cfg['YOUTRACK_URL'].rstrip('/')}/issue/{issue}\n\n## Changes\n{subjects}\n\n{stat}{size_note}{careful_note}\n\n"
                "## Review\nOpened automatically by the ticket loop. CI must be green. A person reviews and merges; "
                "anything touching screens or devices needs a look on a real phone.\n")
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(body)
        out = run(["gh", "pr", "create", "--repo", self.gh_repo(), "--base", cfg["BASE_BRANCH"], "--head", branch,
                   "--title", f"{issue}: {summary}"[:240], "--body-file", f.name])
        os.unlink(f.name)
        if out.returncode != 0:
            raise RuntimeError("could not open the pull request: " + redact(out.stderr[-300:]))
        return out.stdout.strip().splitlines()[-1]

    def review(self, issue, branch, pr_url):
        cfg = self.cfg
        if not cfg["REVIEW_CMD"]:
            return
        tmp = Path(tempfile.mkdtemp(prefix=f"review-{issue}-"))
        wt = tmp / "tree"
        try:
            diff = self.git("diff", f"{cfg['BASE_REF']}...{branch}").stdout[:400000]
            (tmp / "change.diff").write_text(diff)
            self.git("worktree", "add", "--detach", "-q", str(wt), branch, check=True)
            prompt = (f"Review the change in {pr_url} for ticket {issue}. The full diff is in the file named by $REVIEW_DIFF_FILE and the "
                      "checked-out tree is the current directory. Do not modify any file. Report only real problems: correctness bugs, "
                      "missing or weak tests, security or tenant-isolation issues, migration risks, and anything that breaks CONTRIBUTING.md. "
                      "Give file and line for each. If you find nothing material, say so in one sentence.")
            env = dict(os.environ, AGENT_PROMPT=prompt, REVIEW_DIFF_FILE=str(tmp / "change.diff"), TICKET_ID=issue)
            res = run(["bash", "-c", cfg["REVIEW_CMD"]], cwd=wt, env=env, timeout=int(cfg["REVIEW_TIMEOUT_SEC"]))
            text = redact(res.stdout.strip())[:20000] or "(the review produced no output)"
            body = "Automated review (read-only, advisory):\n\n" + text
            with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
                f.write(body)
            run(["gh", "pr", "comment", pr_url, "--body-file", f.name])
            os.unlink(f.name)
        except Exception as e:  # a failed review must never block the pull request
            log(f"{issue}: review step skipped ({e})")
        finally:
            self.git("worktree", "remove", "--force", str(wt))
            shutil.rmtree(tmp, ignore_errors=True)

    # ---- commands
    def cmd_run(self, forced=None):
        cfg = self.cfg
        if self.pause_file().exists():
            return log("paused (PAUSE file exists); nothing to do")
        if not forced and not self.in_window():
            return log(f"outside the run window ({cfg['WINDOW_START']}:00 to {cfg['WINDOW_END']}:00); nothing to do")
        if not cfg["IMPLEMENT_CMD"] or not cfg["BASE_BRANCH"]:
            raise SystemExit("IMPLEMENT_CMD and BASE_BRANCH must be configured (see scripts/ticket-loop.config.example)")
        if not self.acquire():
            return log("another cycle is still running; skipping")
        try:
            if forced:
                found = self.tracker.find(f"issue id: {forced}", 1) if self.tracker.token else [{"idReadable": forced, "summary": forced}]
                todo = [(forced, (found[0]["summary"] if found else forced))]
            else:
                room = min(int(cfg["MAX_PER_CYCLE"]), int(cfg["MAX_PER_DAY"]) - self.done_today())
                if room <= 0:
                    return log(f"daily limit reached ({cfg['MAX_PER_DAY']})")
                todo = [(i["idReadable"], i["summary"]) for i in self.tracker.find(self.candidate_query(), room * 3)][:room]
                if not todo:
                    return log("no tickets are ready")
            for issue, summary in todo:
                try:
                    self.process(issue, summary)
                except Exception as e:
                    log(f"{issue}: stopped by an error: {redact(str(e))}")
                    self.tracker.comment(issue, "The automated run stopped by an error: " + redact(str(e))[:400])
                    self.tracker.add_tag(issue, cfg["TAG_FAILED"])
                    self.tracker.remove_tag(issue, cfg["TAG_WORKING"])
                self.bump()
        finally:
            self.release()

    def cmd_check(self):
        cfg, ok = self.cfg, True

        def line(label, good, detail=""):
            nonlocal ok
            ok = ok and good
            print(f"{'PASS' if good else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
        line("IMPLEMENT_CMD configured", bool(cfg["IMPLEMENT_CMD"]))
        line("REVIEW_CMD configured (optional)", True, "yes" if cfg["REVIEW_CMD"] else "no review step")
        line("BASE_BRANCH configured", bool(cfg["BASE_BRANCH"]), cfg["BASE_BRANCH"])
        tok = Path(cfg["YOUTRACK_TOKEN_FILE"]).expanduser()
        line("tracker token file exists", tok.exists(), str(tok))
        if tok.exists():
            line("token file is private (0600)", (tok.stat().st_mode & 0o077) == 0)
            try:
                line("tracker login works", True, str(self.tracker.me().get("login")))
                for name in ("TAG_READY", "TAG_WORKING", "TAG_PR", "TAG_NEEDS", "TAG_FAILED"):
                    self.tracker.tag_id(cfg[name])
                line("tracker tags exist", True)
                found = self.tracker.find(self.candidate_query(), 20)
                line("ready-ticket query works", True, f"{len(found)} ticket(s): " + ", ".join(i["idReadable"] for i in found[:8]))
            except Exception as e:
                line("tracker access", False, str(e)[:160])
        gh = run(["gh", "auth", "status"])
        line("GitHub login works", gh.returncode == 0)
        line("docker is running", run(["docker", "info"]).returncode == 0)
        if cfg["BASE_REF"]:
            line("base ref exists", self.git("rev-parse", "--verify", "--quiet", cfg["BASE_REF"] + "^{commit}").returncode == 0, cfg["BASE_REF"])
        print("\nRESULT:", "ready" if ok else "fix the FAIL lines above")
        return 0 if ok else 1

    def cmd_status(self):
        print("paused:", "YES" if self.pause_file().exists() else "no")
        print(f"started today: {self.done_today()} of {self.cfg['MAX_PER_DAY']}")
        lock = self.state / "cycle.lock"
        print("cycle running:", f"yes (pid {lock.read_text()})" if lock.exists() else "no")
        logs = sorted((self.runs / "logs").glob("LOY-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)[:5]
        print("recent run logs:", ", ".join(p.name for p in logs) or "none")


def main():
    cfg = load_config()
    loop = Loop(cfg)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "run":
        loop.cmd_run()
    elif cmd == "once":
        if len(sys.argv) < 3 or not re.fullmatch(r"LOY-\d+", sys.argv[2]):
            raise SystemExit("usage: ticket-cycle.py once LOY-123")
        loop.cmd_run(forced=sys.argv[2])
    elif cmd == "check":
        sys.exit(loop.cmd_check())
    elif cmd == "status":
        loop.cmd_status()
    elif cmd == "pause":
        loop.pause_file().write_text(datetime.now().isoformat())
        print("paused:", loop.pause_file())
    elif cmd == "resume":
        loop.pause_file().unlink(missing_ok=True)
        print("resumed")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
