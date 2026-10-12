#!/usr/bin/env bash
# Runs one ticket in isolation:
#   1. a separate git worktree under $RUNS_DIR/<number> on a new branch ticket/LOY-<number>
#   2. its own throwaway Postgres container on a free port (so parallel runs never collide)
#   3. the command in $AGENT_CMD, non-interactively, with a turn cap and a hard time limit
#   4. cleanup: the container is always removed; the worktree is removed only if it is clean.
#      Branches that contain commits are never deleted. Nothing is ever pushed.
#
# Usage:   AGENT_CMD='<command that works on the ticket>' scripts/ticket-run.sh LOY-123
#
# Environment:
#   AGENT_CMD          (required) command run with `bash -c` inside the worktree
#   AGENT_MAX_TURNS    turn cap exported to the command for it to use (default 60)
#   AGENT_TIMEOUT_SEC  hard wall-clock limit for the command (default 3600)
#   BASE_REF           what the branch starts from (default origin/HEAD)
#   RUNS_DIR           where worktrees and logs live (default ~/Developer/Loynara-runs)
#   PG_IMAGE           database image (default postgres:15-alpine, same as compose.yaml)
#   TICKET_BASE_URL    used to build TICKET_URL (default https://loynara.youtrack.cloud/issue)
#   AGENT_PROMPT       replaces the default instructions handed to the command
#   SKIP_INSTALL=1     do not run npm ci (for quick tests of this script)
#   KEEP_WORKTREE=1    never remove the worktree
#
# The command sees: TICKET_ID, TICKET_NUMBER, TICKET_URL, TICKET_FILE (when set), AGENT_PROMPT, AGENT_MAX_TURNS, RUN_DIR,
# DATABASE_URL (a throwaway database named looplocal_test), PGPORT.
set -euo pipefail

die() { echo "ticket-run: $*" >&2; exit 2; }

arg="${1:-}"
[ -n "$arg" ] || die "usage: AGENT_CMD='...' scripts/ticket-run.sh LOY-123"
number="${arg#LOY-}"
[[ "$number" =~ ^[0-9]+$ ]] || die "ticket must look like LOY-123 or 123"
[ -n "${AGENT_CMD:-}" ] || die "AGENT_CMD is not set"
command -v docker >/dev/null || die "docker is required"
command -v git >/dev/null || die "git is required"
docker info >/dev/null 2>&1 || die "docker is not running"

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
RUNS_DIR="${RUNS_DIR:-$HOME/Developer/Loynara-runs}"
BASE_REF="${BASE_REF:-origin/HEAD}"
PG_IMAGE="${PG_IMAGE:-postgres:15-alpine}"
MAX_TURNS="${AGENT_MAX_TURNS:-60}"
TIMEOUT="${AGENT_TIMEOUT_SEC:-3600}"
ticket="LOY-$number"
branch="ticket/$ticket"
run_dir="$RUNS_DIR/$number"
log="$RUNS_DIR/logs/$ticket.log"
container="loynara-run-$number"

[[ "$MAX_TURNS" =~ ^[0-9]+$ ]] || die "AGENT_MAX_TURNS must be a number"
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || die "AGENT_TIMEOUT_SEC must be a number"
[ ! -e "$run_dir" ] || die "$run_dir already exists; remove it or finish that run first"
docker ps -a --format '{{.Names}}' | grep -qx "$container" && die "container $container already exists"
git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch" && die "branch $branch already exists; pick it up there or delete it first"

mkdir -p "$RUNS_DIR/logs"
: > "$log"
git -C "$REPO" fetch origin --quiet || echo "ticket-run: warning: fetch failed, using local refs" >&2
git -C "$REPO" rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null || die "BASE_REF $BASE_REF does not exist"

agent_pid=""
watchdog_pid=""
worktree_made=0
container_made=0

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  [ -n "$watchdog_pid" ] && kill_tree "$watchdog_pid" 2>/dev/null || true
  [ -n "$agent_pid" ] && kill_tree "$agent_pid"
  if [ "$container_made" = 1 ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  if [ "$worktree_made" = 1 ]; then
    local dirty commits
    dirty="$(git -C "$run_dir" status --porcelain 2>/dev/null || echo unknown)"
    commits="$(git -C "$REPO" rev-list --count "$BASE_REF..$branch" 2>/dev/null || echo 0)"
    if [ "${KEEP_WORKTREE:-0}" = 1 ] || [ -n "$dirty" ]; then
      echo "ticket-run: kept $run_dir (uncommitted changes or KEEP_WORKTREE=1). Branch: $branch ($commits commit(s))"
    else
      git -C "$REPO" worktree remove --force "$run_dir" >/dev/null 2>&1 || true
      if [ "$commits" = 0 ]; then
        git -C "$REPO" branch -D "$branch" >/dev/null 2>&1 || true
        echo "ticket-run: no changes were made; removed $run_dir and branch $branch"
      else
        echo "ticket-run: removed $run_dir; branch $branch kept with $commits commit(s), not pushed"
      fi
    fi
  fi
  echo "ticket-run: log: $log"
  exit "$rc"
}
trap cleanup EXIT INT TERM

echo "ticket-run: $ticket from $BASE_REF in $run_dir"
# Creating branches and worktrees writes shared repository metadata, so parallel runs take a short lock.
lock="$RUNS_DIR/.worktree-lock"
for _ in $(seq 1 60); do mkdir "$lock" 2>/dev/null && break; sleep 1; done
[ -d "$lock" ] || die "could not take the worktree lock ($lock)"
if git -C "$REPO" worktree add -q --no-track -b "$branch" "$run_dir" "$BASE_REF" >>"$log" 2>&1; then
  worktree_made=1
  rmdir "$lock"
else
  rmdir "$lock"
  git -C "$REPO" worktree prune
  git -C "$REPO" branch -D "$branch" >/dev/null 2>&1 || true
  die "could not create the worktree; see $log"
fi

# Throwaway database on a free port. Integration tests insist on the name looplocal_test.
port=""
for _ in 1 2 3 4 5 6 7 8; do
  candidate=$((RANDOM % 5000 + 55000))
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$candidate") 2>/dev/null; then
    if docker run -d --rm --name "$container" \
        -e POSTGRES_DB=looplocal_test -e POSTGRES_USER=looplocal -e POSTGRES_PASSWORD=looplocal_local_only \
        -p "127.0.0.1:$candidate:5432" --tmpfs /var/lib/postgresql/data "$PG_IMAGE" >/dev/null 2>&1; then
      port="$candidate"; container_made=1; break
    fi
  fi
done
[ -n "$port" ] || die "could not start a database container on a free port"

# pg_isready can answer during the image's own first-start phase, so wait for a real query on the target database.
ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" psql -U looplocal -d looplocal_test -Atc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || die "database did not become ready"

export DATABASE_URL="postgresql://looplocal:looplocal_local_only@127.0.0.1:$port/looplocal_test"
export PGPORT="$port"
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -q -U looplocal -d looplocal_test < "$run_dir/drizzle/auth.sql" >/dev/null

(
  cd "$run_dir"
  if [ "${SKIP_INSTALL:-0}" != 1 ]; then
    npm ci --no-audit --no-fund
    npm ci --prefix marketing-site --no-audit --no-fund
  fi
  npx drizzle-kit migrate
) >>"$log" 2>&1
echo "ticket-run: database ready on port $port"

export TICKET_ID="$ticket" TICKET_NUMBER="$number" RUN_DIR="$run_dir" AGENT_MAX_TURNS="$MAX_TURNS"
export TICKET_URL="${TICKET_BASE_URL:-https://loynara.youtrack.cloud/issue}/$ticket"
ticket_text=""
if [ -n "${TICKET_FILE:-}" ] && [ -r "$TICKET_FILE" ]; then ticket_text=" The ticket text follows.

$(cat "$TICKET_FILE")

End of ticket text."; fi
export AGENT_PROMPT="${AGENT_PROMPT:-Work on ticket $ticket ($TICKET_URL). Read CONTRIBUTING.md first and follow it.$ticket_text Use the acceptance checklist in the ticket. Write a failing test for the behaviour, then implement the smallest change that makes it pass. Run npm run typecheck, npm run lint and npx vitest run before you finish (DATABASE_URL already points at a throwaway database). Keep it to one pull request of about 300 lines or fewer. Commit with a plain developer-style message. Do not push. Do not touch production credentials. If a decision, real device or external account is needed, stop and state the exact question instead of guessing.}"

echo "ticket-run: starting command (turn cap $MAX_TURNS, time limit ${TIMEOUT}s)"
set +e
( cd "$run_dir" && exec bash -c "$AGENT_CMD" ) >>"$log" 2>&1 &
agent_pid=$!
( sleep "$TIMEOUT"; echo "ticket-run: time limit reached, stopping command" >>"$log"; kill_tree "$agent_pid" ) >/dev/null 2>&1 &
watchdog_pid=$!
wait "$agent_pid"
rc=$?
set -e
{ kill_tree "$watchdog_pid"; wait "$watchdog_pid"; } 2>/dev/null || true
watchdog_pid=""
agent_pid=""
echo "ticket-run: command finished with exit code $rc"
exit "$rc"
