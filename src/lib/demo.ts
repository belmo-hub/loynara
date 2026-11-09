import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, memberships, plateLinkEvents, programs, secureTags, staffPushSubscriptions, staffRoles, tenants } from "@/db/schema";
import { draftRules } from "@/components/owner/program-helpers";
import { DEMO_HOURS, DEMO_SLUG_SQL, demoEnvironment } from "./demo-environment";
import { DomainError } from "./loyalty";
import { assertPlateOperator } from "./plates";
import { REWARD_COST_MAX } from "./points";
import { insertShop, merchantInput, startProgramme } from "./product";
import { eraseDemoShop } from "./shop-erasure";
import { SHOP_TEMPLATES, templateProgramme } from "./shop-templates";
import { checkedLogoUpload } from "./wallet/logo-process";
import { revokeCardWalletPasses } from "./wallet/enqueue";

/**
 * Demo-Modus in the separate demo environment (demo-mode design v3). Every shop in that database is a demo; the active
 * one is the newest shop younger than 24 hours with an active programme. Every function here refuses outside it.
 */
type Env = Record<string, string | undefined>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const HOUR = 60 * 60_000;
const INVALID = (text: string) => new DomainError("INVALID_INPUT", text);
/** Outside the demo environment the demo does not exist: the routes answer 404, like any non-operator. */
function requireDemo(env: Env) {
  if (!demoEnvironment(env)) throw new DomainError("FORBIDDEN", "Den Demo-Modus gibt es nur in der Demo-Umgebung.");
}

/** Only shops „Demo starten“ made (slug demo-<key>) are ever treated as demos, whatever else the database holds. */
const isDemo = sql`${tenants.slug} ~ ${DEMO_SLUG_SQL}`;
const hoursLeft = (createdAt: Date, now: Date) => Math.max(1, Math.ceil((createdAt.getTime() + DEMO_HOURS * HOUR - now.getTime()) / HOUR));

export async function activeDemo(reader: Reader = db, now = new Date()) {
  const [row] = await reader.select({ tenantId: tenants.id, name: tenants.name, createdAt: tenants.createdAt, programId: programs.id, locationId: programs.locationId })
    .from(tenants).innerJoin(programs, and(eq(programs.tenantId, tenants.id), eq(programs.status, "active")))
    .where(and(isDemo, gt(tenants.createdAt, new Date(now.getTime() - DEMO_HOURS * HOUR)))).orderBy(desc(tenants.createdAt)).limit(1);
  return row ?? null;
}

/** „Demo läuft: {Name}, noch {h} Std.“ on the operator screen; null while none runs. */
export async function demoStatus(env: Env = process.env, now = new Date()) {
  if (!demoEnvironment(env)) return null;
  const demo = await activeDemo(db, now);
  return demo && { name: demo.name, hoursLeft: hoursLeft(demo.createdAt, now) };
}

/** A plate opens the active demo only; any other plate (unlinked, or still on an ended demo) shows the sample card. */
export async function demoPlateLive(ref: string, now = new Date()) {
  const [tag] = await db.select({ programId: secureTags.programId }).from(secureTags).where(and(eq(secureTags.publicRef, ref), eq(secureTags.status, "active")));
  return Boolean(tag?.programId) && tag.programId === (await activeDemo(db, now))?.programId;
}

export type DemoInput = { actorUserId: string; env: Env; key: unknown; templateId: unknown; businessName: unknown; logoData?: unknown; brandColor?: unknown; rewardTitle?: unknown; rewardCost?: unknown };

/**
 * „Demo starten“ and „Neu starten“: a new shop through the setup's own code with the operator as its owner. The operator's
 * role and push subscriptions move to it, every plate is linked to its programme, and sample cards are booked, all in one
 * transaction. The client key is the shop's slug, so the same key returns the same demo and never makes a second one.
 */
export async function createDemo(raw: DemoInput) {
  requireDemo(raw.env);
  // Before the input: a non-operator learns nothing from a refusal of what was sent.
  await db.transaction(tx => assertPlateOperator(tx, raw.actorUserId, raw.env));
  if (typeof raw.key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.key)) throw INVALID("Bitte lade die Seite neu.");
  const template = SHOP_TEMPLATES.find(t => t.id === raw.templateId);
  if (!template) throw INVALID("Bitte wähle die Art des Geschäfts.");
  const businessName = typeof raw.businessName === "string" ? raw.businessName.trim() : "";
  if (businessName.length < 2 || businessName.length > 180) throw INVALID("Bitte gib den Namen des Geschäfts ein.");
  const brandColor = raw.brandColor ?? template.colours[0];
  if (typeof brandColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(brandColor)) throw INVALID("Bitte wähle eine Farbe.");
  const rewardTitle = typeof raw.rewardTitle === "string" ? raw.rewardTitle.trim() : template.rewardTitle;
  if (rewardTitle.length < 2 || rewardTitle.length > 180) throw INVALID("Bitte gib die Prämie ein.");
  const rewardCost = raw.rewardCost ?? template.cost;
  if (!Number.isInteger(rewardCost) || (rewardCost as number) < 1 || (rewardCost as number) > REWARD_COST_MAX) throw INVALID(`${template.programType === "points" ? "Punkte" : "Stempel"} bis zur Prämie: Gib eine ganze Zahl von 1 bis ${REWARD_COST_MAX.toLocaleString("de-DE")} ein.`);
  if (raw.logoData !== undefined && typeof raw.logoData !== "string") throw INVALID("Dieses Logo können wir nicht verwenden.");
  const programme = templateProgramme(template);
  const input = merchantInput.parse({
    userId: raw.actorUserId, businessName, city: "Demo", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: template.headline, rulesText: draftRules(programme.programType, programme.earningMode), ...programme, rewardTitle, rewardCost, brandColor,
  });
  const logoData = raw.logoData ? await checkedLogoUpload(raw.logoData) : null;
  const slug = `demo-${raw.key.toLowerCase()}`;
  return db.transaction(async tx => {
    await assertPlateOperator(tx, raw.actorUserId, raw.env);
    // Serializes this operator's starts, so a retry waits for the first try and then finds its shop.
    await tx.execute(sql`SELECT id FROM "user" WHERE id = ${raw.actorUserId} FOR UPDATE`);
    // shortcut: the same key with other form values returns the first demo as it is (the form sends a new key after any edit).
    const [existing] = await tx.select({ name: tenants.name, createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.slug, slug));
    if (existing) return { name: existing.name, hoursLeft: hoursLeft(existing.createdAt, new Date()) };
    const { tenant, location } = await insertShop(tx, input, logoData, slug);
    // One role per login (staff_roles_user_id_uq): the operator's role leaves the previous demo for this one.
    await tx.insert(staffRoles).values({ tenantId: tenant.id, userId: raw.actorUserId, role: "owner" })
      .onConflictDoUpdate({ target: staffRoles.userId, set: { tenantId: tenant.id, role: "owner", locationId: null, active: true } });
    await tx.update(staffPushSubscriptions).set({ tenantId: tenant.id, locationId: location.id }).where(eq(staffPushSubscriptions.userId, raw.actorUserId));
    const shop = await startProgramme(tx, tenant.id, location, input, input.earningMode ?? "manual");
    // The plate asks the cashier, as on a real shop with NFC „Mit Bestätigung“.
    await tx.update(programs).set({ tapMode: "staff_confirmed", tapCooldownSeconds: 60 }).where(eq(programs.id, shop.programId));
    await linkPlates(tx, { tenantId: tenant.id, locationId: location.id, programId: shop.programId }, raw.actorUserId);
    await seedDemoCards(tx, { tenantId: tenant.id, locationId: location.id, programId: shop.programId, stamp: input.programType === "stamp", cost: input.rewardCost, actorUserId: raw.actorUserId });
    return { name: tenant.name, hoursLeft: DEMO_HOURS };
  });
}

/** The plates in stock and those on an earlier demo move to the new demo, each with its audit row. A plate on any other shop stays. */
async function linkPlates(tx: Transaction, target: { tenantId: string; locationId: string; programId: string }, actorUserId: string) {
  const tags = await tx.select().from(secureTags).where(and(isNotNull(secureTags.plateLabel), or(eq(secureTags.status, "unlinked"),
    and(eq(secureTags.status, "active"), sql`${secureTags.tenantId} IN (SELECT id FROM tenants WHERE slug ~ ${DEMO_SLUG_SQL})`)))).for("update");
  for (const tag of tags) {
    await tx.update(secureTags).set({ ...target, status: "active", activatedAt: new Date() }).where(eq(secureTags.id, tag.id));
    await tx.insert(plateLinkEvents).values({ tagId: tag.id, plateLabel: tag.plateLabel!, action: tag.programId ? "relink" : "link", actorUserId,
      oldTenantId: tag.tenantId, oldLocationId: tag.locationId, oldProgramId: tag.programId, newTenantId: target.tenantId, newLocationId: target.locationId, newProgramId: target.programId });
  }
}

const SAMPLE_VISITS = [2, 4, 1, 5, 3, 6];

/** Six sample cards with visits over the last four weeks, booked as „Demo-Daten“ (synthetic_seed). No purchase amounts. */
async function seedDemoCards(tx: Transaction, shop: { tenantId: string; locationId: string; programId: string; stamp: boolean; cost: number; actorUserId: string }) {
  const perVisit = shop.stamp ? 1 : Math.max(1, Math.round(shop.cost / 10));
  const now = Date.now();
  for (const [card, wanted] of SAMPLE_VISITS.entries()) {
    // Below the reward, so no sample card waits for a redemption.
    const visits = Math.min(wanted, Math.floor((shop.cost - 1) / perVisit));
    const [member] = await tx.insert(memberships).values({ tenantId: shop.tenantId, programId: shop.programId, scanCode: `sc_${randomBytes(18).toString("base64url")}`, cardToken: `card_${randomBytes(24).toString("base64url")}`, balance: visits * perVisit }).returning({ id: memberships.id });
    for (let visit = 0; visit < visits; visit++) {
      const daysAgo = ((card * 5 + visit * 6) % 27) + 1;
      await tx.insert(ledgerEntries).values({ tenantId: shop.tenantId, locationId: shop.locationId, membershipId: member.id, delta: perVisit, kind: "award", source: "synthetic_seed",
        actorUserId: shop.actorUserId, requestId: randomUUID(), idempotencyKey: `demo-seed:${card}:${visit}`, reason: "Demo-Daten", createdAt: new Date(now - daysAgo * 24 * HOUR - (card + 1) * HOUR) });
    }
  }
}

/**
 * Worker, hourly, demo environment only. A demo older than 24 hours: its Wallet passes are voided and the update pushed
 * through the card-closure path (the worker sends the queued refresh, Apple then serves the pass voided). Older than 25
 * hours: the shop is erased, nothing kept.
 */
export async function endDemos(env: Env = process.env, now = new Date()) {
  if (!demoEnvironment(env)) return { voided: 0, erased: 0 };
  const ended = new Date(now.getTime() - DEMO_HOURS * HOUR), gone = new Date(now.getTime() - (DEMO_HOURS + 1) * HOUR);
  const cards = await db.execute(sql`SELECT DISTINCT p.tenant_id AS "tenantId", p.membership_id AS "membershipId" FROM wallet_passes p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.revoked_at IS NULL AND t.slug ~ ${DEMO_SLUG_SQL} AND t.created_at <= ${ended.toISOString()}::timestamptz`);
  for (const card of cards.rows as Array<{ tenantId: string; membershipId: string }>) await db.transaction(tx => revokeCardWalletPasses(tx, card.tenantId, card.membershipId, "closed"));
  // Not before the voided pass reached the phones (a pass still waiting for its push would freeze instead); a day later anyway.
  const shops = (await db.execute(sql`SELECT t.id FROM tenants t WHERE t.slug ~ ${DEMO_SLUG_SQL} AND t.created_at <= ${gone.toISOString()}::timestamptz
    AND (t.created_at <= ${new Date(now.getTime() - 2 * DEMO_HOURS * HOUR).toISOString()}::timestamptz OR NOT EXISTS (SELECT 1 FROM wallet_passes p WHERE p.tenant_id = t.id AND p.status <> 'revoked'))`)).rows as Array<{ id: string }>;
  let erased = 0;
  for (const shop of shops) {
    // One shop that cannot be erased must not hold up the others; it is tried again next hour.
    try { await eraseDemoShop(shop.id, env); erased++; }
    catch (error) { console.error(`Demo erase failed for ${shop.id} (${error instanceof Error ? error.name : "error"})`); }
  }
  return { voided: cards.rows.length, erased };
}
