import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { POST as transitionRoute } from "@/app/api/merchant/booking/appointments/[id]/transition/route";
import { activateSecureTag, processSecureTap, provisionSecureTag, setTapPolicy, type TapKeyProvider } from "@/lib/secure-tap";
import { book } from "./appointments";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

// ENG-201 (Reviewer, a0b330e2): an automatic plate tap after „Fertig“ is that same visit. It must use up its counter and
// leave a row, so the link cannot book a stamp once the window has passed.
withBookingDatabase();
const zero = Buffer.alloc(16);
const keys: TapKeyProvider = { async getKeys(ref) { if (ref !== "synthetic-vector") throw Error("missing key"); return { metaReadKey: zero, fileReadKey: zero }; } };
// The NXP application-note vector (counter 61), as in secure-tap.integration.test.ts.
const vector = { encrypted: "EF963FF7828658A599F3041510671E88", mac: "94EED9EE65337086" };

it("„Fertig“, then an automatic tap: cooldown, the counter used up, a row written, one credit; the same link again is still cooldown", async () => {
  const shop = await bookingShop();
  const quarter = new Date(Math.floor(Date.now() / 900_000) * 900_000);
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: quarter, customerName: "Mia", idempotencyKey: randomUUID() }, new Date(quarter.getTime() - 86_400_000));
  const done = await transitionRoute(request(`/api/merchant/booking/appointments/${appointment.id}/transition`, { body: { to: "done", expected: "confirmed" }, cookie: shop.ownerCookie }), { params: Promise.resolve({ id: appointment.id }) });
  expect(done.status).toBe(200);

  const { rows: [program] } = await pool.query("SELECT id FROM programs WHERE tenant_id = $1", [shop.scope.tenantId]);
  await setTapPolicy({ actorUserId: shop.owner.userId, programId: program.id, mode: "automatic_fixed", cooldownSeconds: 60 });
  const tag = await provisionSecureTag({ actorUserId: shop.owner.userId, programId: program.id, uid: "04de5f1eacc040", keyRef: "synthetic-vector", configVersion: 1 });
  await activateSecureTag({ actorUserId: shop.owner.userId, tagId: tag.id });
  const tap = () => processSecureTap({ tagRef: tag.publicRef, fields: vector, cardToken: shop.card.cardToken, keyProvider: keys });

  expect(await tap()).toMatchObject({ state: "cooldown" });
  expect((await pool.query("SELECT last_counter FROM secure_tags WHERE id = $1", [tag.id])).rows[0].last_counter).toBe(61);
  expect((await pool.query("SELECT status, ledger_entry_id FROM tap_requests WHERE tag_id = $1", [tag.id])).rows).toEqual([{ status: "cooldown", ledger_entry_id: null }]);
  expect(await tap()).toMatchObject({ state: "cooldown" });
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id = $1 AND kind = 'award' AND source IN ('staff_online','nfc_tap')", [shop.card.id])).rows[0].n).toBe(1);
});
