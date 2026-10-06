/**
 * Proves that THIS runtime (a built image, not a developer Mac) can produce a signed Apple Wallet pass: OpenSSL and zip
 * are present, the archive is built by the application code, its manifest matches every file, and the detached CMS
 * signature verifies. It uses a throwaway root, intermediate and signing certificate in a deleted temporary directory;
 * it never reads configured credentials, contacts Apple or Google, or touches a database.
 *
 *   docker run --rm --entrypoint npx <image> tsx scripts/wallet-runtime-check.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { applePassArchive, applePassJson } from "../src/lib/wallet/apple";
import type { WalletPassData } from "../src/lib/wallet/types";

const dir = mkdtempSync(join(tmpdir(), "loynara-wallet-check-"));
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  console.log(`openssl: ${run("openssl", ["version"]).trim()}`);
  console.log(`zip: ${run("zip", ["-v"]).match(/Zip \d[^\n]*/)?.[0] ?? "unknown"}`);
  // Same trust shape as production, with completely synthetic identities: root -> WWDR stand-in -> pass leaf.
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "root-key.pem", "-out", "root.pem", "-days", "1", "-subj", "/CN=Loynara runtime check root (not Apple)", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:1", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  writeFileSync(join(dir, "extensions.cnf"), "[intermediate]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n");
  run("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca-key.pem", "-out", "ca.csr", "-subj", "/CN=Loynara runtime check intermediate (not Apple WWDR)"]);
  run("openssl", ["x509", "-req", "-in", "ca.csr", "-CA", "root.pem", "-CAkey", "root-key.pem", "-CAcreateserial", "-out", "ca.pem", "-days", "1", "-extfile", "extensions.cnf", "-extensions", "intermediate"]);
  run("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.csr", "-subj", "/CN=Loynara runtime check pass (not an Apple certificate)"]);
  run("openssl", ["x509", "-req", "-in", "cert.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-out", "cert.pem", "-days", "1", "-extfile", "extensions.cnf", "-extensions", "leaf"]);
  run("openssl", ["verify", "-CAfile", "root.pem", "-untrusted", "ca.pem", "cert.pem"]);
  const config = { passTypeId: "pass.check.runtime", teamId: "ABCDE12345", webServiceUrl: "https://runtime-check.invalid/api/apple", authSecret: "r".repeat(40), certPath: join(dir, "cert.pem"), keyPath: join(dir, "key.pem"), wwdrPath: join(dir, "ca.pem") };
  const pass: WalletPassData = {
    tenantId: "00000000-0000-4000-8000-000000000001", programId: "00000000-0000-4000-8000-000000000002", membershipId: "00000000-0000-4000-8000-000000000003",
    merchantName: "Runtime Check", programName: "Prüfkarte", locationName: "Image", brandColor: "#1F4A3A", country: "DE", locale: "de",
    programType: "stamp", balance: 7, scanCode: "sc_runtime_check", cardLocator: "K-AAAAAA", reward: { title: "Kaffee", cost: 10 },
  };
  const serial = "00000000-0000-4000-8000-000000000004";
  const archive = await applePassArchive(applePassJson(pass, serial, config), pass, config);
  writeFileSync(join(dir, "check.pkpass"), archive);
  const listing = run("zip", ["-sf", "check.pkpass"]);
  for (const name of ["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png"]) if (!listing.includes(name)) throw new Error(`Archive lacks ${name}`);
  // The image has no unzip; read the entries back with a minimal reader instead.
  const entries = readZipEntries(archive);
  const manifest = checkManifest(entries);
  writeFileSync(join(dir, "manifest.json"), entries.get("manifest.json")!);
  writeFileSync(join(dir, "signature"), entries.get("signature")!);
  // Trust only the synthetic root; CMS must contain and validate the separate intermediate.
  const verifyCms = (content: string) => run("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", "signature", "-content", content, "-CAfile", "root.pem", "-purpose", "any", "-out", "/dev/null"]);
  verifyCms("manifest.json");
  const tampered = new Map(entries);
  tampered.set("pass.json", Buffer.from("tampered"));
  mustReject(() => checkManifest(tampered), "tampered archive data");
  const omitted = new Map(entries);
  omitted.set("unexpected.png", Buffer.from("uncovered"));
  mustReject(() => checkManifest(omitted), "uncovered archive entry");
  const traversal = Buffer.from(archive);
  traversal.write("../x.json", 30, "utf8"); // Same length as pass.json: no unrelated structural corruption.
  mustReject(() => readZipEntries(traversal), "archive path traversal");
  writeFileSync(join(dir, "tampered-manifest.json"), Buffer.concat([entries.get("manifest.json")!, Buffer.from(" ")]));
  mustReject(() => verifyCms("tampered-manifest.json"), "tampered CMS content");
  const json = JSON.parse(entries.get("pass.json")!.toString("utf8"));
  if (json.serialNumber !== serial || json.barcodes?.[0]?.message !== pass.scanCode || json.sharingProhibited !== true) throw new Error("Unexpected pass.json");
  console.log(`Wallet runtime check passed: ${archive.length} byte pass, ${Object.keys(manifest).length} files, root/intermediate chain and signature verified; traversal, uncovered entries and tampering rejected.`);
}

function mustReject(check: () => unknown, name: string) {
  try { check(); } catch { return; }
  throw new Error(`Negative check accepted ${name}`);
}

function checkManifest(entries: Map<string, Buffer>): Record<string, string> {
  const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as Record<string, string>;
  const actual = [...entries.keys()].filter(name => name !== "manifest.json" && name !== "signature").sort();
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(actual)) throw new Error("Manifest does not cover exactly the archive data");
  for (const [name, hash] of Object.entries(manifest)) {
    if (!/^[a-f0-9]{40}$/.test(hash) || createHash("sha1").update(entries.get(name)!).digest("hex") !== hash) throw new Error(`Manifest hash mismatch for ${name}`);
  }
  return manifest;
}

/** Minimal reader for the stored/deflated entries `zip` writes; enough to check this archive without unzip. */
function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const localOffsets = new Map<string, number>();
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const flags = zip.readUInt16LE(offset + 6);
    if (flags & 0x09 || ![0, 8].includes(method)) throw new Error("Encrypted, streaming or unsupported zip entry");
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (!(name === "signature" || /^[A-Za-z0-9@_-]+\.[A-Za-z0-9]+$/.test(name)) || entries.has(name)) throw new Error("Unsafe or duplicate archive name");
    if (start + compressed > zip.length) throw new Error("Truncated zip entry");
    const data = zip.subarray(start, start + compressed);
    const unpacked = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: 2_000_000 });
    if (unpacked.length !== zip.readUInt32LE(offset + 22)) throw new Error("Zip entry length mismatch");
    entries.set(name, unpacked);
    localOffsets.set(name, offset);
    offset = start + compressed;
  }
  if (!entries.size || offset + 4 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Missing zip directory");
  const directoryOffset = offset, names = new Set<string>();
  while (offset + 46 <= zip.length && zip.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > zip.length) throw new Error("Truncated zip directory");
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const local = localOffsets.get(name);
    if (local === undefined || names.has(name) || zip.readUInt32LE(offset + 42) !== local
      || zip.readUInt16LE(offset + 10) !== zip.readUInt16LE(local + 8)
      || zip.readUInt32LE(offset + 16) !== zip.readUInt32LE(local + 14)
      || zip.readUInt32LE(offset + 20) !== zip.readUInt32LE(local + 18)
      || zip.readUInt32LE(offset + 24) !== zip.readUInt32LE(local + 22)) throw new Error("Zip directory disagrees with local entries");
    names.add(name); offset = end;
  }
  if (offset + 22 > zip.length || zip.readUInt32LE(offset) !== 0x06054b50 || zip.readUInt16LE(offset + 4) !== 0 || zip.readUInt16LE(offset + 6) !== 0
    || zip.readUInt16LE(offset + 8) !== entries.size || zip.readUInt16LE(offset + 10) !== entries.size || names.size !== entries.size
    || zip.readUInt32LE(offset + 12) !== offset - directoryOffset || zip.readUInt32LE(offset + 16) !== directoryOffset
    || offset + 22 + zip.readUInt16LE(offset + 20) !== zip.length) throw new Error("Invalid zip end directory");
  return entries;
}

main().then(() => rmSync(dir, { recursive: true, force: true }), (error) => {
  rmSync(dir, { recursive: true, force: true });
  console.error(`Wallet runtime check FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
