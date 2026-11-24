# Credential storage preparation — LOY-334

15 October 2026. Preparation is authorized; production mutations, revocations and deletion of original copies require a later explicit approval. Preserve the security-review and lifecycle branches.

## Outcome and boundaries

Use `~/Developer/Loynara-secrets` outside the synced Desktop, with owner-only directories and files. Prepare byte-verified copies; retain originals pending approval. Keep backup decryption identities distinct from API credentials. A copy does not eliminate the original exposure or revoke an already copied credential.

## Implementation

1. Reuse the clean, idle operations worktree on `security/credential-storage`, based on current `railway-rc`. Preserve its former branch. No new worktree or package installation is needed.
2. Inventory current local credential filenames and consumers, and read Railway service status and variable **names**. Do not retrieve production rows, raw logs or secret values from Railway.
3. Add `scripts/operator-secrets.py` with preparation and verification commands. A private explicit manifest supplies source paths and destination names. Validate ownership, private permissions, size, file type, symlinks, hard links, synced paths and repository boundaries. Refuse cloud-only placeholders. Publish complete copies without overwriting existing files; compare existing copies privately on retries. No network, provider mutation, source deletion or arbitrary command execution.
4. Exercise success and refusal behavior with synthetic credentials in `scripts/operator-secrets.test.py`, including unchanged sources, private permissions, existing-file conflicts and absence of secrets in diagnostics.
5. Prepare actual resident credential copies and a private source-to-destination manifest. Verify copies without printing values or digests. Verify backup-key usability with newly generated synthetic plaintext only; preserve historical identities.
6. Document the service dependency map, exact rotation order, verification and recovery gates. Record unresolved provider checks and cloud-only files explicitly. Do not run historical deployment scripts.
7. Commit tested tooling and sanitized runbooks, open a PR against `railway-rc`, update LOY-334, and present the production approval packet. Keep the issue open.

## Validation boundary

Only the standalone local credential utility changes executable behavior. Its full Python test suite and syntax checks are required. Application routes, schemas, dependency versions and hosted service configuration are unchanged; application/database tests do not prove credential rotation. Hosted success, revocation and original-copy cleanup must be verified after authorization.
