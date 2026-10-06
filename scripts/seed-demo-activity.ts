import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { ledgerEntries, memberships, programs, staffRoles } from "../src/db/schema";
import { enroll } from "../src/lib/product";
import { assertLocalTarget } from "./local-guard";

/**
 * Local review data only: adds synthetic cards with a spread of past checkout dates to the local demo merchant
 * created by `npm run db:seed`, so retention views (recently active, drifting, never active, near reward) have
 * something to show on a developer machine. Refuses anything but the localhost `looplocal` database.
 * Run once: `npx tsx scripts/seed-demo-activity.ts`.
 */
const DAY = 86_400_000;
type Pattern = { count: number; checkoutsAgo: (index: number) => number[] };
const patterns: Pattern[] = [
  // Regulars: several checkouts, the latest within the last two weeks.
  { count: 9, checkoutsAgo: i => [2 + i, 9 + i, 18 + i, 27 + i].slice(0, 2 + (i % 3)) },
  // Close to the reward (8 stamps): seven recent checkouts.
  { count: 3, checkoutsAgo: i => [1, 5, 9, 14, 20, 26, 31 + i].slice(0, 6 + (i % 2)) },
  // Drifting: used to come, nothing in the last 30+ days.
  { count: 7, checkoutsAgo: i => [38 + i * 4, 52 + i * 4, 66 + i * 4].slice(0, 1 + (i % 3)) },
  // Signed up, never recorded at the counter.
  { count: 4, checkoutsAgo: () => [] },
];

async function main() {
  assertLocalTarget({ databaseUrl: process.env.DATABASE_URL, authUrl: process.env.BETTER_AUTH_URL, baseUrl: process.env.PUBLIC_BASE_URL, nodeEnv: process.env.NODE_ENV });
  const access = JSON.parse(readFileSync(path.resolve("var/demo-access.json"), "utf8")) as { programSlug?: string };
  if (!access.programSlug) throw new Error("Run npm run db:seed first");
  const [program] = await db.select().from(programs).where(eq(programs.slug, access.programSlug)).limit(1);
  if (!program) throw new Error("Demo programme missing");
  const [owner] = await db.select().from(staffRoles).where(eq(staffRoles.tenantId, program.tenantId)).limit(1);
  const existing = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.programId, program.id));
  if (existing.length > 3) { console.log("Demo activity already present; nothing added."); return; }
  const now = Date.now();
  let cards = 0;
  for (const pattern of patterns) {
    for (let index = 0; index < pattern.count; index++) {
      const ago = pattern.checkoutsAgo(index);
      const card = await enroll({ slug: program.slug, acceptedTerms: true });
      const enrolledAt = new Date(now - ((ago.at(-1) ?? 3 + index) + 1) * DAY);
      await db.update(memberships).set({ createdAt: enrolledAt, balance: ago.length }).where(eq(memberships.id, card.id));
      for (const daysAgo of ago) {
        await db.insert(ledgerEntries).values({ tenantId: program.tenantId, locationId: program.locationId, membershipId: card.id, actorUserId: owner.userId,
          delta: 1, kind: "award", source: "staff_online", requestId: randomUUID(), idempotencyKey: `demo-activity-${randomUUID()}`,
          reason: "Synthetic local review data", createdAt: new Date(now - daysAgo * DAY - (index % 5) * 3_600_000) });
      }
      cards++;
    }
  }
  console.log(`Added ${cards} synthetic local cards with backdated checkouts.`);
}

main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
