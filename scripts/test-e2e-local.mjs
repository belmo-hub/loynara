import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

// The browser suite intentionally uses the synthetic local app. Several
// independent sign-ups, enrollments, card reads and exports would otherwise exhaust shared peer
// limits. Reset only this runner's auth/enrollment peer counters between bounded
// shards; never change the application's limiter or a nonlocal database.
const base = dotenv.parse(readFileSync(".env"));
const next = dotenv.parse(readFileSync(".env.local"));
for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "PUBLIC_BASE_URL", "PUBLIC_REGISTRATION_ENABLED", "TRUST_PROXY_CLIENT_IP"]) {
  if (base[name] !== next[name]) throw new Error(`Local .env and .env.local disagree on ${name}`);
}
const database = new URL(next.DATABASE_URL);
if (process.env.NODE_ENV === "production" || database.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "54329" ||
    database.pathname !== "/looplocal" || database.username !== "looplocal" ||
    next.BETTER_AUTH_URL !== "http://localhost:3000" || next.PUBLIC_BASE_URL !== "http://localhost:3000" ||
    next.PUBLIC_REGISTRATION_ENABLED !== "true" || next.TRUST_PROXY_CLIENT_IP === "true" ||
    (next.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
  throw new Error("Browser suite requires the guarded synthetic loopback configuration");
}

const client = new pg.Client({ connectionString: next.DATABASE_URL });
await client.connect();
try {
  const scopes = ["auth_signup_peer", "auth_signin_peer", "enroll_peer", "card_read_peer", "card_export_peer"];
  const hashes = scopes.map(scope => createHmac("sha256", next.BETTER_AUTH_SECRET)
    .update(scope).update("\0").update("untrusted-peer").digest("hex"));
  for (let shard = 1; shard <= 3; shard++) {
    await client.query("DELETE FROM rate_limits WHERE key_hash = ANY($1::text[])", [hashes]);
    const result = spawnSync("./node_modules/.bin/playwright", ["test", `--shard=${shard}/3`], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: next.DATABASE_URL },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  await client.end();
}
