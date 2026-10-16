# LOY-334 preparation evidence

15 October 2026, preparation verified at 13:49 UTC. **The ticket remains open.** Subsequent approved execution replaced the main Railway project token; original copies remain preserved. See the dated [execution evidence](CREDENTIAL_ROTATION_EXECUTION.md) for the later state.

## Local preparation

- Reused the clean, idle `~/Developer/Loynara-release-ops` worktree on branch `security/credential-storage`, based on `railway-rc` at `a822f833f657e440f202b2a5f1c28ab768d41fbe`. Preserved its previous branch. Security-review and lifecycle worktrees were not changed.
- Disk check: 49 GiB available. No worktree creation or dependency installation was needed.
- Verified that the Desktop checkout remains under iCloud sync. The chosen store, `~/Developer/Loynara-secrets`, is outside the observed synced roots and any Git repository. Its private manifest contains filenames and destinations only.
- Prepared **15 resident files** from the inventory in [the rotation packet](CREDENTIAL_ROTATION.md). The helper privately compared every copy with its source; a separate verification command succeeded for all 15. Owner-only directories are mode 0700; files are mode 0600. The helper also verified ownership, no symlinks/hard links and no extended ACLs on copied files/private destination directories.
- At the preparation checkpoint, original files remained present, no credentials had been revoked, no source had been rewritten and no production service configuration had been changed. Later execution is recorded separately. No secret values or fingerprints are written into this evidence.
- The copied historical backup identity successfully decrypted a newly encrypted synthetic message using the copied recipient. Byte comparison passed; temporary synthetic files were removed. No production backup was downloaded or decrypted, and no customer database was queried.
- A separate future backup identity/recipient pair was generated directly in the private recovery directory and passed its own synthetic round trip. Both new files are mode 0600 with no extended ACLs. The new recipient is **not activated** in Railway; the historical identity remains intact.
- `.env`, `var/preview.env` and `var/preview-access.json` were cloud-only placeholders. They remain unclassified and uncopied. The helper refuses placeholders before opening them. One earlier bounded inventory attempt stalled on `.env`; only that inventory process was stopped, with no source deletion.
- Backup identity custody, Google Wallet demo credentials and NFC custody remain distinct. Existing operator handoff files outside sync were preserved.

## Live service observations

Read-only Railway inspection around 13:25 UTC reported seven services, zero reported issues/failures and no pending changes. Variable **names**, not values, were inspected. Direct read-only checks using the copied Railway files did not establish their current validity/scope; this remains an execution prerequisite, not evidence that either token was revoked. Independent connector access to Railway was working.

| Service | Observation | Observed deployment ID |
| --- | --- | --- |
| web | Online, one replica | `c581e349-4869-40d4-8cdf-33854867e2e6` |
| worker | Online, one replica | `8580dd00-390a-4c5e-89a9-fa383f8a9471` |
| cloudflared | Online, one replica | `8c0405db-f840-4f95-b7be-60a41234e8bc` |
| backup | Scheduled run succeeded at 03:02:07 UTC | `be445944-e1e5-4f3b-beb6-5b66cfb4db87` |
| opscheck | Scheduled run succeeded at 13:25:28 UTC | `9920c43b-ad5e-40d3-beae-d5366eabd2ce` |
| Postgres | Online | Not needed for this preparation |
| migrate | Successful one-shot job, exited | No migration run in this task |

The inspected web, connector and backup services had no public Railway domains or TCP proxies. Backup cron remained `0 3 * * *`. The exact connector image and service IDs are in the packet. Re-read these observations before executing any change; this is a dated checkpoint, not a standing health guarantee.

A later unauthenticated request to the public `/api/health` endpoint returned HTTP 200. No customer data or response body was recorded.

## Tool verification

`python3 -B scripts/operator-secrets.test.py`: **24 tests passed locally on macOS**. Tests use synthetic files only. Coverage includes complete private copies, unchanged source inode/mtime, idempotent retry, verification without writes, conflicting destination refusal, synced/repository destinations, nested repositories, traversal/duplicates, source/destination symlinks and hard links, broad permissions, inherited macOS ACLs, destination-parent replacement, FIFO/size refusal, placeholder files/directories rejected before opening, failed-publication cleanup, and secret-free malformed-input diagnostics. Python syntax checks and `git diff --check` passed.

Independent review found unsafe ACL handling, a destination-parent race, nested repository acceptance and placeholder-open ordering. Fixes include descriptor-relative operations, ACL checks and pre-open metadata validation; regression tests demonstrated failure before the corresponding fixes. Final review reported no remaining concrete copy-path finding. CI now includes this suite on Linux and macOS; hosted results are recorded on the PR. Application behavior and database schema are unchanged.

## Remaining acceptance work

- The owner approved the phases 1–4 production packet, including the tunnel handover risk, temporary connector and future backup recipient change. Complete its remaining phases and acceptance checks.
- Establish actual token/provider scopes, Cloudflare connector ownership and monitor account access; preserve independent administrator access.
- Execute and verify replacements, including next natural backup/heartbeat activity and rejection of replaced credentials.
- Resolve preview/provider scope before broader rotations. Reconcile cloud-only files and check archived files for embedded copies without exposing matches.
- Confirm operator credential handoff, an independent recovery custodian/copy, and the exact deletion list. Verify local, iCloud and other-device cleanup after approval. Preserve the historical backup identity until no retained backup requires it.
- Update this evidence and LOY-334 with actual results. **Do not mark Done based on private copies, a PR, a successful synthetic key test or an approved plan alone.**
