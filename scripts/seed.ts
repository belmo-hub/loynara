import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { locations, memberships, programs, staffRoles } from "../src/db/schema";
import { award } from "../src/lib/loyalty";
import { createMerchant, enroll } from "../src/lib/product";
import { assertLocalTarget } from "./local-guard";
import { previewConfigIssues } from "./preview-config";

type DemoAccess = {
  ownerEmail: string;
  ownerPassword: string;
  cashierEmail: string;
  cashierPassword: string;
  programSlug?: string;
  cardToken?: string;
};

const previewSeed = process.env.LOOPLOCAL_PREVIEW_SEED === "true";
const accessPath = path.resolve(previewSeed ? "var/preview-access.json" : "var/demo-access.json");
const ownerEmail = "owner.demo@looplocal.test";
const cashierEmail = "cashier.demo@looplocal.test";

function saveAccess(access: DemoAccess) {
  mkdirSync(path.dirname(accessPath), { recursive: true });
  writeFileSync(accessPath, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 });
}

function getAccess(): DemoAccess {
  if (existsSync(accessPath)) {
    const saved = JSON.parse(readFileSync(accessPath, "utf8")) as DemoAccess;
    if (saved.ownerEmail !== ownerEmail || saved.cashierEmail !== cashierEmail || !saved.ownerPassword || !saved.cashierPassword) {
      throw new Error("Existing local demo access file has an unexpected shape; inspect it before seeding");
    }
    return saved;
  }
  const access = {
    ownerEmail,
    ownerPassword: randomBytes(24).toString("base64url"),
    cashierEmail,
    cashierPassword: randomBytes(24).toString("base64url"),
  };
  saveAccess(access);
  return access;
}

async function ensureUser(email: string, name: string, password: string) {
  const { pool } = await import("../src/db");
  const current = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (current.rows[0]) return current.rows[0].id;

  // This process is already restricted to localhost. The switch only applies to this
  // process and never changes the runtime registration gate of the web application.
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  const { auth } = await import("../src/lib/auth");
  const created = await auth.api.signUpEmail({ body: { email, name, password } });
  if (!created.user?.id) throw new Error(`Local demo account was not created for ${email}`);
  return created.user.id;
}

async function main() {
  if (previewSeed) {
    if (process.env.NODE_ENV === "production") throw new Error("Preview seeding refuses NODE_ENV=production");
    const issues = previewConfigIssues(process.env);
    if (issues.length) throw new Error(`Preview seeding rejected: ${issues.join("; ")}`);
  } else {
    assertLocalTarget({ databaseUrl: process.env.DATABASE_URL, authUrl: process.env.BETTER_AUTH_URL, baseUrl: process.env.PUBLIC_BASE_URL, nodeEnv: process.env.NODE_ENV });
  }
  const access = getAccess();
  const ownerId = await ensureUser(access.ownerEmail, "Demo Inhaber", access.ownerPassword);
  const cashierId = await ensureUser(access.cashierEmail, "Demo Kasse", access.cashierPassword);

  const [existingOwner] = await db.select().from(staffRoles).where(eq(staffRoles.userId, ownerId)).limit(1);
  let tenantId: string;
  let locationId: string;
  let programSlug: string;
  if (existingOwner) {
    tenantId = existingOwner.tenantId;
    const [location] = await db.select().from(locations).where(eq(locations.tenantId, tenantId)).limit(1);
    const [program] = location ? await db.select().from(programs).where(eq(programs.locationId, location.id)).limit(1) : [];
    if (!location || !program) throw new Error("Demo owner exists, but the merchant setup is incomplete");
    locationId = location.id;
    programSlug = program.slug;
  } else {
    const merchant = await createMerchant({
      userId: ownerId,
      businessName: "Demo Kaffeebar Kassel",
      locationName: "Kassel Mitte",
      city: "Kassel",
      country: "DE",
      timezone: "Europe/Berlin",
      locale: "de",
      currency: "EUR",
      programName: "Demo Kaffeekarte",
      programType: "stamp",
      rulesText: "Ein Stempel pro Kaffee. Acht Stempel ergeben einen Gratiskaffee.",
      rewardTitle: "Gratiskaffee",
      rewardCost: 8,
      brandColor: "#2F6B58",
    });
    tenantId = merchant.tenantId;
    locationId = merchant.locationId;
    programSlug = merchant.programSlug;
  }

  const [cashierRole] = await db.select().from(staffRoles).where(eq(staffRoles.userId, cashierId)).limit(1);
  if (!cashierRole) await db.insert(staffRoles).values({ tenantId, locationId, userId: cashierId, role: "cashier" });
  else if (cashierRole.tenantId !== tenantId) throw new Error("Demo cashier belongs to another merchant");

  access.programSlug = programSlug;
  let cardExists = false;
  if (access.cardToken) {
    const [existingCard] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.cardToken, access.cardToken)).limit(1);
    cardExists = Boolean(existingCard);
  }
  if (!cardExists) {
    const card = await enroll({ slug: programSlug, acceptedTerms: true, marketingOptIn: false });
    await award({ userId: ownerId, locationId, membershipId: card.id, quantity: 3, idempotencyKey: `demo-seed-award-${card.id}`, requestId: randomUUID(), reason: "Synthetic local demo data", source: "synthetic_seed" });
    access.cardToken = card.cardToken;
  }
  saveAccess(access);
  console.log(`Synthetic local demo is ready. Read ${accessPath} for passwords and card token.`);
  console.log(`Enrollment: ${process.env.PUBLIC_BASE_URL}/join/${programSlug}`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error instanceof Error ? error.message : "Local seed failed");
  process.exit(1);
});
