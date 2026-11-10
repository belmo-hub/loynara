/**
 * Operator machine, reader attached, no database. Step 1 of re-personalising a chip for another environment:
 * authenticates key 0 with the keys the old environment derived, takes the NDEF file settings back to the factory
 * state (keys unchanged), and writes the chip's current keys to a private custody file. Step 2 is the normal
 *   nfc-operator.ts provision --target production --execute --transport-keys-file <that file> --env-file <new environment> ...
 * Never prints a key. Needs a typed confirmation. A written intent without a done line blocks every rerun.
 */
import { constants } from "node:fs";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  if (!process.stdin.isTTY) throw new Error("Interactive operator terminal required");
  const reader = option("reader");
  const bundle = JSON.parse(await readFile(option("old-bundle"), "utf8")) as { uid: string; keyRef: string; origin: string };
  const oldEnv = parse(await readFile(option("old-env-file")));
  const custodyOut = path.resolve(option("custody-out"));
  if (!/^[a-f0-9]{14}$/.test(bundle.uid) || !/^[A-Za-z0-9_-]{1,80}$/.test(bundle.keyRef)) throw new Error("Old registration bundle is invalid");

  const log = path.resolve("var/nfc-rekey", `${bundle.uid}.log`);
  await mkdir(path.dirname(log), { recursive: true, mode: 0o700 });
  const previous = await readFile(log, "utf8").catch(() => "");
  if (previous.includes("intent") && !previous.includes("done")) throw new Error("An earlier reset of this chip did not finish; stop for review");
  if (previous.includes("done")) throw new Error("This chip was already reset; continue with provisioning");

  const { currentDerivedKeys, resetKeyedChipToFactorySettings } = await import("../src/lib/nfc-provision/rekey");
  const { PcscBridge } = await import("../src/lib/nfc-provision/pcsc");
  const { Ntag424 } = await import("../src/lib/nfc-provision/ntag");
  const currentKeys = currentDerivedKeys({ env: oldEnv, keyRef: bundle.keyRef, uid: bundle.uid });
  const bridge = new PcscBridge();
  try {
    const readers = await bridge.readers();
    if (!readers.includes(reader)) throw new Error("Selected reader is unavailable");
    await bridge.connect(reader);
    const stamp = () => new Date().toISOString();
    await resetKeyedChipToFactorySettings({
      tag: new Ntag424(bridge), expectedUid: bundle.uid, currentKeys,
      async confirm(summary) {
        console.log(`UID ${summary.uid}; file settings ${summary.settings}; currently personalised for ${bundle.origin}`);
        console.log("Will: authenticate key 0 with the keys derived for that environment; set the NDEF file settings back to the factory state (SDM off, free read and write). No key is changed and the NDEF URL is not touched.");
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        try { return (await terminal.question(`Type RESET ${summary.uid} to continue: `)).trim() === `RESET ${summary.uid}`; } finally { terminal.close(); }
      },
      onIntent: async () => appendFile(log, `${stamp()} intent\n`, { mode: 0o600 }),
      onDone: async () => appendFile(log, `${stamp()} done\n`, { mode: 0o600 }),
    });
    const file = await open(custodyOut, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(JSON.stringify({ uid: bundle.uid, key0: currentKeys.key0.toString("hex"), fileReadKey: currentKeys.fileReadKey.toString("hex"), metaReadKey: currentKeys.metaReadKey.toString("hex"), key3: currentKeys.key3.toString("hex"), key4: currentKeys.key4.toString("hex") }));
      await file.sync();
    } finally { await file.close(); }
    console.log(`PASS: chip ${bundle.uid} is back in the factory NDEF state. Its current keys are in ${custodyOut} (mode 600) for --transport-keys-file. No key was printed.`);
  } finally { await bridge.close(); }
}

main().catch(error => { console.error(`REKEY_STOPPED ${error instanceof Error ? error.message : "unknown"}`); process.exit(1); });
