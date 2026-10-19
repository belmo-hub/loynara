import { and, eq } from "drizzle-orm";
import { verifySdm } from "../src/lib/secure-tap-crypto";
import type { TapKeyProvider } from "../src/lib/nfc-keys";
import { parseRegistrationBundle, type RegistrationBundle } from "../src/lib/nfc-provision/production";

export class RegistrationRefusal extends Error {
  constructor(public code: string) { super(code); this.name = "RegistrationRefusal"; }
}
const refuse = (code: string): never => { throw new RegistrationRefusal(code); };

export type RegistrationAudit = { at: string; status: "would_register" | "registered" | "already_registered"; executed: boolean; tagId?: string; tenantId: string; locationId: string; programId: string; publicRef: string; checks: string[] };

/**
 * Server-side registration of a physically provisioned tag. Default is a dry run that performs every check and writes nothing.
 * Every check is read from the real database or recomputed with the server's own verification keys; the bundle is only a claim.
 */
export async function registerTag(input: {
  bundleText: string | undefined;
  actorUserId: string;
  execute: boolean;
  env: Record<string, string | undefined>;
  provider: TapKeyProvider;
  /** Fails closed unless this is the intended deployment (the production operator guard in the CLI). */
  guard: () => void;
  now?: () => Date;
}): Promise<RegistrationAudit> {
  input.guard();
  const bundle: RegistrationBundle = parseRegistrationBundle(input.bundleText);
  const checks: string[] = [];
  const now = input.now ?? (() => new Date());

  const base = input.env.PUBLIC_BASE_URL ? new URL(input.env.PUBLIC_BASE_URL).origin : "";
  if (!base || bundle.origin !== base) refuse("BUNDLE_ORIGIN_IS_NOT_THIS_DEPLOYMENT");
  if (/^https:\/\/preview\./.test(bundle.origin)) refuse("PREVIEW_TAGS_CANNOT_BE_REGISTERED_HERE");
  checks.push("origin matches this deployment");

  // The chip answers correctly under THIS deployment's verification keys, for exactly this UID, reference and counter.
  let sample: URL;
  try { sample = new URL(bundle.sampleUrl); } catch { return refuse("SAMPLE_URL_INVALID"); }
  if (sample.origin !== bundle.origin || sample.pathname !== `/tap/${bundle.publicRef}`) refuse("SAMPLE_URL_DOES_NOT_MATCH_BUNDLE");
  let decoded: { uid: string; counter: number };
  try {
    const keys = await input.provider.getKeys(bundle.keyRef, { uid: bundle.uid });
    decoded = verifySdm({ encrypted: sample.searchParams.get("e") ?? "", mac: sample.searchParams.get("c") ?? "" }, keys);
  } catch { return refuse("SAMPLE_DOES_NOT_VERIFY_WITH_SERVER_KEYS"); }
  if (decoded.uid !== bundle.uid || decoded.counter !== bundle.secondCounter) refuse("SAMPLE_UID_OR_COUNTER_MISMATCH");
  checks.push("tag verifies with the server verification keys (UID and counter match)");

  const [{ db }, schema, tap] = await Promise.all([import("../src/db"), import("../src/db/schema"), import("../src/lib/secure-tap")]);
  const { programs, secureTags, staffRoles } = schema;
  const [program] = await db.select().from(programs).where(eq(programs.id, bundle.programId));
  if (!program || program.tenantId !== bundle.tenantId || program.locationId !== bundle.locationId) refuse("BINDING_DOES_NOT_MATCH_THE_DATABASE");
  if (program.status !== "active") refuse("PROGRAMME_NOT_ACTIVE");
  if (program.tapMode !== "staff_confirmed" || !program.tapCooldownSeconds) refuse("OWNER_MUST_SET_STAFF_CONFIRMED_FIRST");
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
  if (!role) refuse("ACTOR_IS_NOT_AN_ACTIVE_OWNER_OF_THIS_MERCHANT");
  checks.push("merchant, location and programme match; staff-confirmed policy set; actor is the active owner");

  const audit = (status: RegistrationAudit["status"], tagId?: string): RegistrationAudit => ({ at: now().toISOString(), status, executed: status !== "would_register", tagId, tenantId: bundle.tenantId, locationId: bundle.locationId, programId: bundle.programId, publicRef: bundle.publicRef, checks });

  const [byRef] = await db.select().from(secureTags).where(eq(secureTags.publicRef, bundle.publicRef));
  if (byRef) {
    if (byRef.uid !== bundle.uid || byRef.programId !== bundle.programId || byRef.keyRef !== bundle.keyRef) refuse("REFERENCE_ALREADY_USED_BY_ANOTHER_TAG");
    if (byRef.status === "active") return audit("already_registered", byRef.id);
    if (byRef.status !== "provisioned") refuse("TAG_WAS_REVOKED_OR_REPLACED");
  }
  const [live] = await db.select({ id: secureTags.id, publicRef: secureTags.publicRef }).from(secureTags).where(and(eq(secureTags.uid, bundle.uid), eq(secureTags.status, "active")));
  if (live && live.publicRef !== bundle.publicRef) refuse("CHIP_ALREADY_ACTIVE_UNDER_ANOTHER_REFERENCE");
  if (!input.execute) return audit("would_register", byRef?.id);

  const tag = byRef ?? await tap.provisionSecureTag({ actorUserId: input.actorUserId, programId: bundle.programId, uid: bundle.uid, keyRef: bundle.keyRef, configVersion: bundle.configVersion, publicRef: bundle.publicRef }) as { id: string };
  await tap.activateSecureTag({ actorUserId: input.actorUserId, tagId: tag.id, initialCounter: bundle.secondCounter });
  return audit("registered", tag.id);
}
