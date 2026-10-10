# Real local recovery sender capture — 2026-10-10

Base e03dc685e9330cd2ce099c116b705232e1ff1006; isolated codex/recovery-mailpit-capture. Result is this evidence-only commit. No production/test/source/dependency change. Rotation03 acknowledged nonce/currentSHA/fullscope/originalbudget/Mailpitnexttask/boundaries before active coordinator reference switched; previous URL preserved.

## Bounded runtime and execution

Existing Docker29.5.2 and cached repository-pinned axllent/mailpit:v1.27 image sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68 available. No install/download/infrastructure repair. No existing capture listeners. Task-owned ephemeral container loynara-goal-mailpit03 used --pull=never --rm --read-only and temporary /tmp database. Both exposed ports bound only127.0.0.1 (1026→1025 and8026→8025), no SMTP relay/provider configuration. Existing local sender actually calls Mailpit HTTP /api/v1/send; this does not prove SMTP transport or external delivery.

```sh
docker run --detach --rm --pull=never --name loynara-goal-mailpit03 \
 --publish 127.0.0.1:1026:1025 --publish 127.0.0.1:8026:8025 \
 --read-only --tmpfs /tmp:rw,nosuid,noexec,size=32m \
 axllent/mailpit:v1.27 --database /tmp/mailpit.db
# Exact cached npm ci precedes the focused execution.
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin \
 DATABASE_URL=postgresql://looplocal:looplocal_local_only@localhost:55433/looplocal_test \
 TEST_PG_PORT=55433 PUBLIC_BASE_URL=http://localhost:3000 \
 BETTER_AUTH_URL=http://localhost:3000 \
 BETTER_AUTH_SECRET=loynara-synthetic-integration-only-no-live-credential \
 MAILPIT_SMOKE=true MAILPIT_HTTP_ORIGIN=http://127.0.0.1:8026 \
 EXTERNAL_EMAIL_ENABLED=false TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED=false \
 ./node_modules/.bin/vitest run src/lib/card-recovery.integration.test.ts
```

Unmodified existing test calls deliverRecoveryEmail without injected sender, using actual sendTransactional→sendLocalMailpit capture implementation. **10 tests PASS,0 failures,0 skips**, exit0,1.07seconds. Other recovery tests preserve expiry/replay/contact/closure/rotation/authorization checks. No new full-suite execution:152files/1414PASS/1conditionalSKIP at9552b37 remains historical full-run evidence, supplemented by the now-executed focused smoke case.

Because the existing smoke assertion only checks nonzero capture count, independent loopback inspection additionally asserted: exactly1 message, expected LOCAL TEST recovery subject, exactly1 synthetic holder@example.test recipient, localhost3000/recover/confirm URL with token exclusively in fragment, one-time20minute wording, explicit card-selection wording, no external delivery wording, and recovery job payload={} after completion. Only count/booleans persisted. No body, private recovery token/link, raw message or database payload dumped. This is local message/rendering evidence, not a real controlled-inbox acceptance.

Container stopped and auto-removed; no listeners1026/8026 remain (lsof exit1 means none). Image remains cached and unrelated existing PostgreSQL containers untouched. Targeted discovery initially had zsh unmatched file patterns; corrected explicit paths without runtime repair. No application failure or correction attempted. Evidence-only diff verified; source/build/lint/type results remain previous exact-source checkpoints rather than invented fresh runs.

## Requirements and limits

Local real-sender capture verification gap is addressed for unchanged current source. Customer-recovery external provider/physical/browser and independent acceptance remain OPEN; no tracker stage closed, no founder-sensitive authorization granted. No deployment/customer send/provider activation/secretDNSpermission change. NativeGoal measured2,028,806reportedtokens/12,103seconds, noreset; since report0191,943,012/11,290 +85,794/+813 including rotation03. Input/cache/outputsplit/browser inference unmeasured. Ceiling2.5M/deadline19:50:28Berlin unchanged; nativehardcap unavailable/checkpoint accounting enforced. Next review candidates: live privacy/export/deletion issue verification, suppression concurrency, all-lane highest unmet independent engineering gap.
