import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RegistrationBundle } from "../src/lib/nfc-provision/production";
import { deliverRegistrationBundle } from "./nfc-operator-bundle";

let folder: string;
beforeAll(async () => { await mkdir(path.resolve("var"), { recursive: true }); folder = await mkdtemp(path.resolve("var/nfc-bundle-test-")); });
afterAll(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });
const bundle: RegistrationBundle = {
  version: 1, target: "production", origin: "https://app.example-pilot.test", tenantId: "10000000-0000-4000-8000-000000000001", locationId: "20000000-0000-4000-8000-000000000002", programId: "30000000-0000-4000-8000-000000000003", uid: "04de5f1eacc040", publicRef: "abcdefghijklmnopqrstuvwx", keyRef: "dv1_synthetic_delivery", configVersion: 1, sampleUrl: "https://app.example-pilot.test/tap/abcdefghijklmnopqrstuvwx?e=synthetic&c=synthetic", firstCounter: 2, secondCounter: 3, createdAt: "2026-10-05T10:00:00.000Z",
};
let serial = 0;
const root = () => path.join(folder, `${serial++}`, "nested");
const fileAt = (directory: string) => path.join(directory, `${bundle.publicRef}.registration.json`);

describe("atomic local registration-bundle delivery", () => {
  it("delivers complete JSON mode0600 into newly created ignored directories", async () => {
    const directory = root();
    const filename = await deliverRegistrationBundle(bundle, directory);
    expect(filename).toBe(fileAt(directory));
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(bundle);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).toEqual([path.basename(filename)]);
  });
  it("can deliver the same recorded identity again", async () => {
    const directory = root();
    await deliverRegistrationBundle(bundle, directory);
    const incoming = { ...bundle, createdAt: "2026-10-05T11:00:00.000Z" };
    await deliverRegistrationBundle(incoming, directory);
    expect(JSON.parse(await readFile(fileAt(directory), "utf8"))).toEqual(incoming);
  });
  it.each(["{", "", '{"version":1}'])("replaces an interrupted invalid bundle %j with the validated original proof", async partial => {
    const directory = root(); await mkdir(directory, { recursive: true });
    await writeFile(fileAt(directory), partial, { mode: 0o600 });
    await deliverRegistrationBundle(bundle, directory);
    expect(JSON.parse(await readFile(fileAt(directory), "utf8"))).toEqual(bundle);
    expect(await readdir(directory)).toEqual([path.basename(fileAt(directory))]);
  });
  it.each([
    { uid: "04de5f1eacc041" }, { keyRef: "dv1_other_attempt" }, { origin: "https://other.example-pilot.test" }, { tenantId: "40000000-0000-4000-8000-000000000004" }, { locationId: "50000000-0000-4000-8000-000000000005" }, { programId: "60000000-0000-4000-8000-000000000006" }, { configVersion: 2 }, { publicRef: "ZYXWVUTSRQPONMLKJIHGFEDC" },
  ])("preserves an existing valid bundle with a different identity or binding %j", async difference => {
    const directory = root(); await mkdir(directory, { recursive: true });
    const existing = JSON.stringify({ ...bundle, ...difference });
    await writeFile(fileAt(directory), existing, { mode: 0o600 });
    await expect(deliverRegistrationBundle(bundle, directory)).rejects.toThrow(/BUNDLE_DELIVERY_CONFLICT/);
    expect(await readFile(fileAt(directory), "utf8")).toBe(existing);
    expect(await readdir(directory)).toEqual([path.basename(fileAt(directory))]);
  });
  it("refuses malformed incoming bundles before creating delivery files", async () => {
    const directory = root();
    await expect(deliverRegistrationBundle({ ...bundle, uid: "invalid" }, directory)).rejects.toThrow(/BUNDLE_DELIVERY_INVALID/);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses a symlink destination and preserves its target", async () => {
    const directory = root(); await mkdir(directory, { recursive: true });
    const other = path.join(folder, "untouched.json"); await writeFile(other, "untouched");
    await symlink(other, fileAt(directory));
    await expect(deliverRegistrationBundle(bundle, directory)).rejects.toThrow(/BUNDLE_DELIVERY_UNSAFE/);
    expect(await readFile(other, "utf8")).toBe("untouched");
  });
  it("refuses delivery outside ignored var", async () => {
    await expect(deliverRegistrationBundle(bundle, path.resolve("scripts"))).rejects.toThrow(/BUNDLE_DELIVERY_UNSAFE/);
  });
  it("refuses and preserves a stale delivery lock for explicit review", async () => {
    const directory = root(); await mkdir(directory, { recursive: true });
    const lock = path.join(directory, `${bundle.publicRef}.delivery.lock`);
    await writeFile(lock, "previous interrupted delivery", { mode: 0o600 });
    await expect(deliverRegistrationBundle(bundle, directory)).rejects.toThrow(/BUNDLE_DELIVERY_LOCKED/);
    expect(await readFile(lock, "utf8")).toBe("previous interrupted delivery");
    await expect(stat(fileAt(directory))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves the prior complete bundle if a temporary write fails halfway", async () => {
    const directory = root(); await mkdir(directory, { recursive: true });
    const original = JSON.stringify(bundle); await writeFile(fileAt(directory), original, { mode: 0o600 });
    const realOpen = fs.promises.open;
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (String(args[0]).endsWith(".registration.tmp")) {
        const realWrite = handle.writeFile.bind(handle);
        handle.writeFile = async () => { await realWrite('{"version":'); throw new Error("synthetic interrupted write"); };
      }
      return handle;
    });
    syncBuiltinESMExports();
    await expect(deliverRegistrationBundle({ ...bundle, createdAt: "2026-10-05T11:00:00.000Z" }, directory)).rejects.toThrow(/synthetic interrupted write/);
    expect(await readFile(fileAt(directory), "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual([path.basename(fileAt(directory))]);
  });
  it("syncs the written temporary file before rename and its directory after rename", async () => {
    const directory = root(); await mkdir(directory, { recursive: true });
    const operations: string[] = [];
    const realOpen = fs.promises.open;
    const realRename = fs.promises.rename;
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const filename = String(args[0]);
      const realSync = handle.sync.bind(handle);
      handle.sync = async () => {
        await realSync();
        if (filename.endsWith(".registration.tmp")) operations.push("temporary file synced");
        else if (filename === directory) operations.push("directory synced");
      };
      return handle;
    });
    vi.spyOn(fs.promises, "rename").mockImplementation(async (...args) => { await realRename(...args); operations.push("renamed"); });
    syncBuiltinESMExports();
    await deliverRegistrationBundle(bundle, directory);
    const index = operations.indexOf("temporary file synced");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(operations.slice(index, index + 3)).toEqual(["temporary file synced", "renamed", "directory synced"]);
    expect(JSON.parse(await readFile(fileAt(directory), "utf8"))).toEqual(bundle);
  });
});
