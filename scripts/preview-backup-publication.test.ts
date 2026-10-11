import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

// Actual preview backup executable and PostgreSQL dump/list/restore. The Docker transport
// adapter redirects only the source database to a new isolated synthetic fixture database.
// No ordinary local database, preview volume, provider or production target is used.
const database = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/looplocal_test") throw new Error("Backup tests require disposable localhost looplocal_test");
const docker = execFileSync("which", ["docker"], { encoding: "utf8" }).trim();
const dockerArgs = process.env.TEST_PG_CONTAINER ? ["exec", "-i", process.env.TEST_PG_CONTAINER] : ["compose", "exec", "-T", "postgres"];
const root = path.resolve(__dirname, "..");
const source = `loynara_preview_backup_${randomUUID().replaceAll("-", "")}`;
beforeAll(() => {
  pg("createdb", "-U", "looplocal", source);
  pg("psql", "-U", "looplocal", "-d", source, "-v", "ON_ERROR_STOP=1", "-c", "CREATE TABLE backup_rehearsal_records (id text PRIMARY KEY, balance integer NOT NULL); INSERT INTO backup_rehearsal_records VALUES ('synthetic-one',7),('synthetic-two',3)");
});
afterAll(() => { pg("dropdb", "-U", "looplocal", "--if-exists", source); });

function fixture(mode = "ok") {
  const dir = mkdtempSync(path.join(tmpdir(), "loynara-preview-backup-publication-"));
  const bin = path.join(dir, "bin"); mkdirSync(bin);
  // Execute unchanged checked-in preview code in a minimal disposable fixture,
  // never source the checkout's ignored preview.env or access its Compose volume.
  mkdirSync(path.join(dir, "scripts")); mkdirSync(path.join(dir, "var"));
  for (const name of ["preview-backup.sh", "assert-preview.ts", "preview-config.ts", "publish-backup.ts"]) copyFileSync(path.join(root, "scripts", name), path.join(dir, "scripts", name));
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  writeFileSync(path.join(dir, "var", "preview.env"), [
    "DATABASE_URL=postgresql://looplocal_preview:looplocal_preview_local_only@127.0.0.1:54330/looplocal_preview",
    "BETTER_AUTH_URL=http://localhost:3001", "PUBLIC_BASE_URL=http://localhost:3001",
    "BETTER_AUTH_SECRET=synthetic-preview-backup-only-secret-over-32-characters",
    "PUBLIC_REGISTRATION_ENABLED=false", "EXTERNAL_EMAIL_ENABLED=false", "LIVE_BILLING_ENABLED=false",
    "APPLE_WALLET_ENABLED=false", "GOOGLE_WALLET_ENABLED=false", "TRUST_PROXY_CLIENT_IP=false", "SMTP_HOST=disabled",
  ].join("\n") + "\n", { mode: 0o600 });
  const output = path.join(dir, "backup.dump");
  const ready = path.join(dir, "ready"); const release = path.join(dir, "release");
  const wrapper = path.join(bin, "docker");
  writeFileSync(wrapper, `#!${process.execPath}\n
const fs = require('node:fs'); const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2); const prefix = ['compose','-p','looplocal-preview','-f','compose.preview.yaml','exec','-T','postgres'];
if (JSON.stringify(args.slice(0,8)) !== JSON.stringify(prefix)) process.exit(90);
const command = args.slice(8); const stage = command[0];
if (!['pg_dump','pg_restore'].includes(stage)) process.exit(91);
if (stage === 'pg_dump') {
  if (JSON.stringify(command) !== JSON.stringify(['pg_dump','-U','looplocal_preview','-d','looplocal_preview','--format=custom','--no-owner','--no-acl'])) process.exit(92);
  command[2] = 'looplocal'; command[4] = process.env.BACKUP_TEST_DATABASE;
} else if (JSON.stringify(command) !== JSON.stringify(['pg_restore','--list'])) process.exit(93);
fs.appendFileSync(process.env.BACKUP_TEST_TRACE, stage + '\\n');
if (process.env.BACKUP_TEST_MODE === stage) { if (stage === 'pg_dump') process.stdout.write('synthetic incomplete archive'); process.exit(5); }
const result = spawnSync(process.env.BACKUP_TEST_DOCKER, [...JSON.parse(process.env.BACKUP_TEST_DOCKER_ARGS), ...command], { stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(result.status ?? 94);
if (stage === 'pg_restore' && process.env.BACKUP_TEST_MODE === 'hold') {
  fs.writeFileSync(process.env.BACKUP_TEST_READY, 'validated'); const deadline = Date.now() + 10000;
  while (!fs.existsSync(process.env.BACKUP_TEST_RELEASE)) { if (Date.now() > deadline) process.exit(95); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
}
`, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    PATH: bin + path.delimiter + process.env.PATH, HOME: process.env.HOME,
    NODE_ENV: "test", DATABASE_URL: "postgresql://looplocal:synthetic-local-password@localhost:55433/looplocal",
    BETTER_AUTH_URL: "http://localhost:3000", PUBLIC_BASE_URL: "http://localhost:3000",
    BACKUP_TEST_DATABASE: source, BACKUP_TEST_DOCKER: docker, BACKUP_TEST_DOCKER_ARGS: JSON.stringify(dockerArgs),
    BACKUP_TEST_TRACE: path.join(dir, "trace"), BACKUP_TEST_MODE: mode,
    BACKUP_TEST_READY: ready, BACKUP_TEST_RELEASE: release,
  };
  return { dir, output, ready, release, env, trace: () => existsSync(env.BACKUP_TEST_TRACE!) ? readFileSync(env.BACKUP_TEST_TRACE!, "utf8") : "", clean: () => rmSync(dir, { recursive: true, force: true }) };
}
function run(f: ReturnType<typeof fixture>) { return spawnSync("sh", ["scripts/preview-backup.sh", f.output], { cwd: f.dir, env: f.env, encoding: "utf8", timeout: 15000 }); }
function pg(...args: string[]) { return execFileSync(docker, [...dockerArgs, ...args], { cwd: root, encoding: "utf8" }); }

it("publishes a restricted valid archive that restores the synthetic database", () => {
  const f = fixture(); const target = `loynara_restore_${randomUUID().replaceAll("-", "")}`;
  try {
    const result = run(f); expect(result.status, result.stderr).toBe(0);
    expect(statSync(f.output).mode & 0o077).toBe(0);
    expect(result.stdout).toContain("Preview backup written"); expect(f.trace()).toBe("pg_dump\npg_restore\n");
    pg("createdb", "-U", "looplocal", target);
    const restore = spawnSync(docker, [...dockerArgs, "pg_restore", "-U", "looplocal", "-d", target, "--exit-on-error", "--no-owner", "--no-acl"], { cwd: root, input: readFileSync(f.output), encoding: "utf8" });
    expect(restore.status, restore.stderr).toBe(0);
    const sql = "SELECT id||','||balance FROM backup_rehearsal_records ORDER BY id";
    expect(pg("psql", "-U", "looplocal", "-d", target, "-Atc", sql)).toBe(pg("psql", "-U", "looplocal", "-d", source, "-Atc", sql));
    expect(readdirSync(f.dir).filter(name => name.includes(".tmp."))).toEqual([]);
  } finally { pg("dropdb", "-U", "looplocal", "--if-exists", target); f.clean(); }
});

it.each(["pg_dump", "pg_restore"])("does not publish incomplete backup after %s fails", mode => {
  const f = fixture(mode); try {
    const result = run(f); expect(result.status).not.toBe(0); expect(result.stdout).not.toContain("Preview backup written");
    expect(existsSync(f.output)).toBe(false); expect(readdirSync(f.dir).filter(name => name.includes(".tmp."))).toEqual([]);
    expect(result.stdout + result.stderr).not.toContain("synthetic-preview-backup-only-secret-over-32-characters");
    expect(f.trace()).toBe(mode === "pg_dump" ? "pg_dump\n" : "pg_dump\npg_restore\n");
  } finally { f.clean(); }
});

it.each(["file", "directory", "symlink"])("never overwrites a %s published while backup validation is pending", async kind => {
  const f = fixture("hold");
  const child = spawn("sh", ["scripts/preview-backup.sh", f.output], { cwd: f.dir, env: f.env });
  let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  const finished = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  try {
    await expect.poll(() => existsSync(f.ready), { timeout: 8000 }).toBe(true);
    const competitor = path.join(f.dir, "competing.dump"); writeFileSync(competitor, "synthetic concurrent backup preserved");
    if (kind === "file") copyFileSync(competitor, f.output);
    if (kind === "directory") mkdirSync(f.output);
    if (kind === "symlink") symlinkSync(competitor, f.output);
    writeFileSync(f.release, "continue");
    const status = await finished;
    expect(status).not.toBe(0); expect(output).not.toContain("Preview backup written");
    if (kind === "directory") expect(readdirSync(f.output)).toEqual([]);
    else expect(readFileSync(f.output, "utf8")).toBe("synthetic concurrent backup preserved");
    expect(readFileSync(competitor, "utf8")).toBe("synthetic concurrent backup preserved");
    expect(readdirSync(f.dir).filter(name => name.includes(".tmp."))).toEqual([]);
  } finally { child.kill(); await finished; f.clean(); }
});


it("allows exactly one owner when two validated preview backups publish the same destination", async () => {
  const first = fixture("hold"); const second = fixture("hold");
  second.output = first.output;
  const start = (f: ReturnType<typeof fixture>) => {
    const child = spawn("sh", ["scripts/preview-backup.sh", f.output], { cwd: f.dir, env: f.env });
    let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    const finished = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    return { child, finished, output: () => output };
  };
  const one = start(first); const two = start(second);
  try {
    await expect.poll(() => existsSync(first.ready) && existsSync(second.ready), { timeout: 8000 }).toBe(true);
    writeFileSync(first.release, "continue"); writeFileSync(second.release, "continue");
    const statuses = await Promise.all([one.finished, two.finished]);
    expect(statuses.filter(status => status === 0)).toHaveLength(1);
    expect([one.output(), two.output()].filter(output => output.includes("Preview backup written"))).toHaveLength(1);
    expect(statSync(first.output).mode & 0o077).toBe(0);
    const list = spawnSync(docker, [...dockerArgs, "pg_restore", "--list"], { input: readFileSync(first.output), encoding: "utf8" });
    expect(list.status, list.stderr).toBe(0); expect(list.stdout).toContain("backup_rehearsal_records");
    expect(readdirSync(first.dir).filter(name => name.includes(".tmp."))).toEqual([]);
    expect(readdirSync(second.dir).filter(name => name.includes(".tmp."))).toEqual([]);
  } finally {
    one.child.kill(); two.child.kill(); await Promise.all([one.finished, two.finished]); first.clean(); second.clean();
  }
});

it("refuses a non-preview configuration before any dump command", () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.dir, "var", "preview.env"), "DATABASE_URL=postgresql://private-user:synthetic-private-password@remote.invalid/private\n");
    const result = run(f); expect(result.status).not.toBe(0); expect(f.trace()).toBe("");
    expect(existsSync(f.output)).toBe(false); expect(result.stdout + result.stderr).not.toContain("synthetic-private-password");
  } finally { f.clean(); }
});
