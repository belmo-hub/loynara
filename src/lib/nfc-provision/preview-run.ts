import { completeProvisioning, provisionPhysicalTag, ProvisionUncertain, type ProvisionRepository, type ProvisionTag } from "./flow";
import { analyseEvidence, type EvidenceEvent, type EvidenceJournal } from "./evidence";
import { assertProvisioningEnvironment } from "./operator-safety";
import { assertApprovedPlan, currentPlanKeys, planEvidence, planKeys, type PreparedPlan } from "./prepared";
import { dynamicNdef } from "../nfc-test-support";
import { ndefTemplate, type ApduTransport } from "./ntag";

export type PreviewRepository = ProvisionRepository & {
  assertReservationAvailable(plan: PreparedPlan): Promise<void>;
  findReservation(plan: PreparedPlan): Promise<{ id: string; publicRef: string }>;
};
export type PreviewJournal = Pick<EvidenceJournal, "withExclusive" | "read" | "record" | "verdict">;
type Input = {
  plan: PreparedPlan; approvedFingerprint: string; env: Record<string, string | undefined>;
  transport: ApduTransport; repository: PreviewRepository; journal: PreviewJournal;
  confirm(text: string): Promise<boolean>; resume?: boolean; tagFactory?(transport: ApduTransport): ProvisionTag;
};
function requireMapping(plan: PreparedPlan, mapping: Awaited<ReturnType<ProvisionRepository["checkTarget"]>>) {
  for (const k of ["tenantId", "locationId", "programId", "mode", "cooldownSeconds"] as const) if (mapping[k] !== plan.binding[k]) throw new Error("PLAN_BINDING_MISMATCH");
}

/** The executor and CPU simulator share this plan and flow; neither can generate credentials. */
export async function runPreparedPreview(input: Input) {
  assertApprovedPlan(input.plan, input.approvedFingerprint);
  const plan = input.plan;
  assertProvisioningEnvironment(input.env, plan.origin);
  if (input.env.PRODUCTION_ENVIRONMENT) throw new Error("PREVIEW_PRODUCTION_MARKER_FORBIDDEN");
  return input.journal.withExclusive(plan.uid, async () => {
    const events = await input.journal.read(plan.uid);
    const verdict = analyseEvidence(events);
    if ((!input.resume && verdict.state !== "none") || (input.resume && verdict.state !== "resumable")) throw new ProvisionUncertain(verdict.state);
    const note = planEvidence(plan);
    if (input.resume && events.some(e => Object.entries(note).some(([k, v]) => e.note?.[k] !== v))) throw new ProvisionUncertain("journal does not match approved prepared plan");
    const mapping = await input.repository.checkTarget({ actorUserId: plan.binding.actorUserId, programId: plan.binding.programId });
    requireMapping(plan, mapping);
    // Check reservation coherence before obtaining credentials or touching a physical transport.
    if (!input.resume) await input.repository.assertReservationAvailable(plan);
    const current = currentPlanKeys(plan);
    const keys = planKeys(plan);
    let tagId: string | undefined;
    const recheckPolicy = async () => requireMapping(plan, await input.repository.checkTarget({ actorUserId: plan.binding.actorUserId, programId: plan.binding.programId }));
    const onIntent = async (name: Parameters<Input["journal"]["record"]>[1]["name"]) => {
      await recheckPolicy();
      if (tagId) await input.repository.verifyMapping({ tagId, publicRef: plan.publicRef, uid: plan.uid, keyRef: plan.keyRef, ...plan.binding });
      await input.journal.record(plan.uid, { kind: "intent", name, note: { ...note, ...(tagId ? { tagId } : {}) } });
    };
    const onStage: Parameters<typeof provisionPhysicalTag>[0]["onStage"] = async (name, proof) => input.journal.record(plan.uid, { kind: "stage", name, note: { ...note, ...(tagId ? { tagId } : {}), ...(proof ? { firstCounter: String(proof.firstCounter), secondCounter: String(proof.secondCounter), sampleUrl: proof.sampleUrl } : {}) } });
    try {
      if (input.resume) {
        const reserved = await input.repository.findReservation(plan);
        tagId = reserved.id;
        if (reserved.publicRef !== plan.publicRef || events.some(e => e.note?.tagId && e.note.tagId !== tagId)) throw new ProvisionUncertain("reservation differs from original journal");
        await input.repository.verifyMapping({ tagId, publicRef: plan.publicRef, uid: plan.uid, keyRef: plan.keyRef, ...plan.binding });
        const done = await completeProvisioning({ transport: input.transport, origin: plan.origin, publicRef: plan.publicRef, keys, expectedUid: plan.uid, provenanceRef: plan.provenanceRef, currentKeys: current, key0State: verdict.state === "resumable" && verdict.lastStage === "settings_changed" ? "transport" : "personalized", tagFactory: input.tagFactory, confirm: () => input.confirm(`Resume ${plan.tag}; plan ${plan.fingerprint}; original custody only`), onIntent, onStage });
        await recheckPolicy();
        await input.repository.activate({ actorUserId: plan.binding.actorUserId, tagId, initialCounter: done.secondCounter });
        await onStage("active");
        return { ...done, tagId, publicRef: plan.publicRef, planFingerprint: plan.fingerprint };
      }
      const repository: ProvisionRepository = {
        ...input.repository,
        fail: async args => {
          // Acknowledged configured/key0 states retain their pending row for explicit
          // same-plan resume. Unknown mutations are revoked and quarantined.
          if ((await input.journal.verdict(plan.uid)).state !== "resumable") await input.repository.fail(args);
        },
        checkTarget: async () => mapping,
        activate: async args => { await recheckPolicy(); await input.repository.activate(args); },
        reserve: async args => {
          await recheckPolicy();
          const result = await input.repository.reserve({ ...args, publicRef: plan.publicRef });
          tagId = result.id;
          if (result.publicRef !== plan.publicRef) throw new Error("PLAN_RESERVATION_MISMATCH");
          await input.repository.verifyMapping({ tagId, publicRef: plan.publicRef, uid: plan.uid, keyRef: plan.keyRef, ...plan.binding });
          return result;
        },
      };
      const result = await provisionPhysicalTag({ transport: input.transport, repository, keyStore: { async save(ref, uid, saved) {
        if (ref !== plan.keyRef || uid !== plan.uid || Object.keys(keys).some(k => !saved[k as keyof typeof keys].equals(keys[k as keyof typeof keys]))) throw new Error("PLAN_KEYS_MISMATCH");
        // Existing age ciphertext was already persisted/recovery-tested; never write plaintext keys.
      } }, actorUserId: plan.binding.actorUserId, programId: plan.binding.programId, origin: plan.origin, keyRef: plan.keyRef, expectedUid: plan.uid, expectedPublicRef: plan.publicRef, requireEmptyNdef: true, provenanceRef: plan.provenanceRef, currentKeys: current, keyFactory: context => {
        if (context.uid !== plan.uid || context.keyRef !== plan.keyRef) throw new Error("PLAN_KEY_CONTEXT_MISMATCH");
        return keys;
      }, tagFactory: input.tagFactory, assertSafeToStart: async () => { if ((await input.journal.verdict(plan.uid)).state !== "none") throw new ProvisionUncertain("prior evidence"); }, confirm: async () => { const confirmed = await input.confirm(`${plan.tag}; preview only; immutable plan ${plan.fingerprint}`); await recheckPolicy(); return confirmed; }, onIntent, onStage });
      return { ...result, planFingerprint: plan.fingerprint };
    } catch (error) {
      await input.journal.record(plan.uid, { kind: "failure", name: "provisioning_stopped", note: { ...note, ...(tagId ? { tagId } : {}) } }).catch(() => undefined);
      throw error;
    } finally { for (const value of [...Object.values(keys), ...Object.values(current)]) value.fill(0); }
  });
}

/** Disposable in-memory execution of the SAME normalized plan. No PC/SC/DB modules are imported. */
export async function simulatePreparedPlan(plan: PreparedPlan, options: { interrupt?: string; loseAcknowledgement?: string; interruptAfter?: string; resume?: boolean; wrongUid?: boolean; wrongReservation?: boolean; wrongBinding?: boolean; policyDriftAfterConfirmation?: boolean } = {}) {
  const events: EvidenceEvent[] = [];
  const mutations: { name: string; simulatedOnly: true }[] = [];
  const journal: PreviewJournal = {
    async withExclusive(_uid, fn) { return fn(); }, async read() { return [...events]; }, async verdict() { return analyseEvidence(events); },
    async record(_uid, event) { events.push({ ...event, at: new Date().toISOString() }); if (event.name === options.interruptAfter) { options.interruptAfter = undefined; throw new Error("CPU_INTERRUPTION"); } },
  };
  const keys = planKeys(plan), current = currentPlanKeys(plan);
  const actual = { ...current };
  let configured = false, ndef: Buffer | undefined, authenticated = false, boundary = true, counter = 0;
  const counters: number[] = [];
  const mutate = (intent: string, name: string, apply: () => void) => { if (intent === options.interrupt) throw new Error("CPU_INTERRUPTION"); apply(); mutations.push({ name, simulatedOnly: true }); if (intent === options.loseAcknowledgement) throw new Error("CPU_LOST_ACK"); };
  const template = ndefTemplate(plan.origin, plan.publicRef);
  const tag: ProvisionTag = {
    async version() { authenticated = false; boundary = true; return { uid: options.wrongUid ? "04000000000002" : plan.uid, hardware: "04040230001105", software: "04040201021105", production: "CPU_ONLY" }; },
    async reconnect() { authenticated = false; boundary = true; },
    async readFileSettings() { if (authenticated) throw new Error("CPU_AUTH_STATE"); boundary = true; return Buffer.from(configured ? plan.expectedSettingsHex : plan.expectedOriginalSettingsHex, "hex"); },
    async authenticateFirst(slot, key) { const field = plan.slots[slot].field; if (!key.equals(actual[field])) throw new Error("CPU_AUTH_FAIL"); authenticated = true; boundary = true; },
    async writeNdef(data) { mutate("writing_ndef", "ndef", () => { ndef = Buffer.from(data); }); },
    async readNdef(length) { if (authenticated) throw new Error("CPU_AUTH_STATE"); if (!ndef) return Buffer.alloc(length); if (!configured) return Buffer.from(ndef.subarray(0, length)); if (boundary) counter++; boundary = false; counters.push(counter); return dynamicNdef(plan.origin, plan.publicRef, plan.uid, counter, keys); },
    async changeKey(slot, next, old) { const field = plan.slots[slot].field; if (!authenticated || !old.equals(actual[field])) throw new Error("CPU_CURRENT_KEY_FAIL"); mutate(`changing_key${slot}`, `key${slot}`, () => { actual[field] = Buffer.from(next); if (slot === 0) authenticated = false; }); },
    async changeFileSettings(settings) { if (!authenticated || !settings.equals(template.settings)) throw new Error("CPU_SETTINGS_FAIL"); mutate("changing_settings", "settings", () => { configured = true; }); },
  };
  let reserved = false, revoked = false, drifted = false;
  const repository: PreviewRepository = {
    async checkTarget() { return { ...plan.binding, mode: drifted ? "automatic_fixed" : plan.binding.mode, tenantId: options.wrongBinding ? "wrong" : plan.binding.tenantId }; },
    async assertReservationAvailable() { if (reserved) throw new Error("CPU_RESERVATION_EXISTS"); },
    async findReservation() { if (!reserved || revoked) throw new Error("CPU_NO_RESERVATION"); return { id: "CPU_ONLY", publicRef: plan.publicRef }; },
    async reserve() { reserved = true; return { id: "CPU_ONLY", publicRef: options.wrongReservation ? "zzzzzzzzzzzzzzzzzzzzzzzz" : plan.publicRef }; },
    async verifyMapping() { if (!reserved || revoked) throw new Error("CPU_NO_MAPPING"); }, async activate() {}, async fail() { revoked = true; },
  };
  const password = "1".repeat(64);
  const env = { DATABASE_URL: `postgresql://looplocal_device:${password}@127.0.0.1:54331/looplocal_device_test`, DEVICE_TEST_DB_PASSWORD: password, DEVICE_TEST_APPROVED_ORIGIN: plan.origin, PUBLIC_BASE_URL: plan.origin, BETTER_AUTH_URL: plan.origin, PUBLIC_REGISTRATION_ENABLED: "false", EXTERNAL_EMAIL_ENABLED: "false", LIVE_BILLING_ENABLED: "false", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false" };
  let failure = false, resumed = false;
  const input = { plan, approvedFingerprint: plan.fingerprint, env, transport: { async transmit(): Promise<Buffer> { throw new Error("PHYSICAL_TRANSPORT_FORBIDDEN"); } }, repository, journal, confirm: async () => { drifted = !!options.policyDriftAfterConfirmation; return true; }, tagFactory: () => tag };
  try { await runPreparedPreview(input); } catch { failure = true; }
  if (options.resume && analyseEvidence(events).state === "resumable") { await runPreparedPreview({ ...input, resume: true }); resumed = true; }
  for (const values of [keys, current, actual]) for (const value of Object.values(values)) value.fill(0);
  return { planFingerprint: plan.fingerprint, physicalApdus: 0, realRegistration: false, keyFingerprints: plan.slots.map(s => s.fingerprint), mutations, events: events.map(e => ({ kind: e.kind, name: e.name })), verdict: analyseEvidence(events), counters, failure, resumed };
}
