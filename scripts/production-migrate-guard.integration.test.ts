import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skippedMigrations } from "./production-migrate-config";

// Throwaway databases on the isolated test server, like migration-upgrade.test.ts.
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Migration guard test requires the isolated looplocal_test server");

const migrationsDir = path.resolve(__dirname, "..", "drizzle");
const adminUrl = new URL(process.env.DATABASE_URL); adminUrl.pathname = "/postgres";
const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
const workDir = mkdtempSync(path.join(tmpdir(), "loynara-mig-guard-"));
const created: string[] = [];
const clients: Client[] = [];
let admin: Pool;

async function scratchDatabase() {
  const name = `looplocal_mig_guard_${randomUUID().slice(0, 8)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  created.push(name);
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  clients.push(client);
  await client.query(readFileSync(path.join(migrationsDir, "auth.sql"), "utf8"));
  return client;
}

/** A migrations folder holding only the journal entries `keep` accepts. */
function folderWith(label: string, keep: (idx: number) => boolean) {
  const target = path.join(workDir, label);
  mkdirSync(path.join(target, "meta"), { recursive: true });
  const entries = journal.entries.filter(entry => keep(entry.idx));
  writeFileSync(path.join(target, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) cpSync(path.join(migrationsDir, `${entry.tag}.sql`), path.join(target, `${entry.tag}.sql`));
  return target;
}
const appliedCount = async (client: Client) => Number((await client.query<{ n: string }>("SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations")).rows[0].n);

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl.toString(), max: 2 }); });
afterAll(async () => {
  for (const client of clients) await client.end();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  rmSync(workDir, { recursive: true, force: true });
});

describe("production migration journal guard", () => {
  const last = journal.entries.at(-1)!.idx;

  it("passes a clean database with no migrations applied", async () => {
    expect(await skippedMigrations(await scratchDatabase(), migrationsDir)).toEqual([]);
  });

  it("passes a normal upgrade where every unapplied entry is newer than the newest applied one", async () => {
    const client = await scratchDatabase();
    await migrate(drizzle(client), { migrationsFolder: folderWith("normal", idx => idx < last - 1) });
    expect(await skippedMigrations(client, migrationsDir)).toEqual([]);
  });

  it("refuses an older entry that lands after a newer one was applied, which drizzle would skip", async () => {
    const client = await scratchDatabase();
    // A gap that no later migration builds on (0032 alters 0031's table, so the second newest no longer qualifies).
    const gap = journal.entries.find(entry => entry.tag === "0027_weekly_owner_report")!;
    await migrate(drizzle(client), { migrationsFolder: folderWith("gap", idx => idx !== gap.idx) });
    expect(await skippedMigrations(client, migrationsDir)).toEqual([gap.tag]);
    // The reason for the guard: drizzle itself reports success and leaves the filled gap unapplied.
    const before = await appliedCount(client);
    await migrate(drizzle(client), { migrationsFolder: migrationsDir });
    expect(await appliedCount(client)).toBe(before);
    expect(await skippedMigrations(client, migrationsDir)).toEqual([gap.tag]);
  });
});
