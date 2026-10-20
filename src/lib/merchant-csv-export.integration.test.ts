import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, locations, memberships, programs } from "@/db/schema";
import { csvText, getMerchantCsv, ledgerVorgang } from "./export";
import { award, reverseEntry } from "./loyalty";
import { formatCardLocator } from "./card-locator";
import { addStaff, nfcFixture } from "./nfc-test-db";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

const lines = (body: string) => body.replace(/^﻿/, "").trimEnd().split("\r\n");
const key = () => ({ idempotencyKey: randomUUID(), requestId: randomUUID() });

it("neutralises formulas in text cells only and quotes separators", () => {
  for (const evil of ["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(A1)", "\t=1+1", "\r=1+1"]) expect(csvText(evil).replace(/^"/, "").startsWith("'")).toBe(true);
  expect(csvText("\t=1+1")).toBe("'\t=1+1"); expect(csvText("\r=1+1")).toBe("\"'\r=1+1\"");
  expect(csvText("=1;2")).toBe("\"'=1;2\"");
  expect(csvText("Sagt \"Hallo\"")).toBe("\"Sagt \"\"Hallo\"\"\"");
  expect(csvText("a\nb")).toBe("\"a\nb\"");
  expect(csvText("Köln")).toBe("Köln");
  expect(csvText(null)).toBe("");
  expect([ledgerVorgang("award", "staff_online", "stamp"), ledgerVorgang("award", "staff_offline", "points"), ledgerVorgang("award", "nfc_tap", "stamp"), ledgerVorgang("award", "referral_bonus", "stamp"), ledgerVorgang("redeem", "staff_online", "stamp"), ledgerVorgang("reversal", "staff_correction", "stamp"), ledgerVorgang("award", "synthetic_seed", "stamp"), ledgerVorgang("award", "legacy_unclassified", "points")])
    .toEqual(["Stempel", "Punkte (offline)", "Stempel (NFC automatisch)", "Empfehlungsbonus", "Prämie eingelöst", "Korrektur", "Sonstige Buchung", "Sonstige Buchung"]);
});

it("exports Karten and Buchungen for the owner's tenant only, Excel-ready, without credentials", async () => {
  const f = await nfcFixture(); const foreign = await nfcFixture();
  await db.update(programs).set({ name: "=HYPERLINK(\"http://evil\")" }).where(eq(programs.id, f.program.id));
  await db.update(locations).set({ name: "Köln Süd; Straße" }).where(eq(locations.id, f.location.id));
  const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
  await pool.query('UPDATE "user" SET name = $1 WHERE id = $2', ["Jürgen", cashier]);
  const gone = await addStaff(f.tenant.id, f.location.id, "cashier");
  const stamped = await award({ userId: cashier, locationId: f.location.id, membershipId: f.member.id, quantity: 3, ...key() });
  await award({ userId: gone, locationId: f.location.id, membershipId: f.member.id, quantity: 1, ...key() });
  await reverseEntry({ userId: f.userId, locationId: f.location.id, entryId: stamped.entryId, reason: "@Kasse vertippt", ...key() });
  await db.insert(ledgerEntries).values({ tenantId: f.tenant.id, locationId: f.location.id, membershipId: f.member.id, delta: 1, kind: "award", source: "nfc_tap", actorUserId: null, ...key() });
  await award({ userId: foreign.userId, locationId: foreign.location.id, membershipId: foreign.member.id, quantity: 7, ...key() });
  await pool.query('UPDATE "user" SET name = $1 WHERE id = $2', [" ", gone]); // blank name: never falls back to email

  const karten = await getMerchantCsv(f.userId, "karten");
  expect(karten.filename).toMatch(/^loynara-karten-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(karten.body.startsWith("﻿")).toBe(true);
  const [kartenHead, ...kartenRows] = lines(karten.body);
  expect(kartenHead).toBe("Kartennummer;Programm;Aktueller Stand;Ausgestellt am;Geschlossen am");
  const [member] = await db.select().from(memberships).where(eq(memberships.id, f.member.id));
  expect(kartenRows).toEqual([`${formatCardLocator(member.cardLocator)};"'=HYPERLINK(""http://evil"")";${member.balance};${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(member.createdAt)};`]);

  const buchungen = await getMerchantCsv(f.userId, "buchungen");
  expect(Buffer.from(buchungen.body, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const [head, ...rows] = lines(buchungen.body);
  expect(head).toBe("Datum;Uhrzeit;Kartennummer;Standort;Vorgang;Menge;Grund;Bestätigt von");
  const cells = rows.map(row => row.split(";").slice(5).join(";"));
  expect(cells).toEqual(expect.arrayContaining(["Stempel;3;;Jürgen", "Stempel;1;;unbekannt", "Korrektur;-3;'@Kasse vertippt;Synthetic owner", "Stempel (NFC automatisch);1;;NFC automatisch"]));
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row).toMatch(/^\d{2}\.\d{2}\.\d{4};\d{2}:\d{2};K-[A-Z2-9]{6};"Köln Süd; Straße";/);
  }

  for (const body of [karten.body, buchungen.body]) {
    for (const secret of [f.member.cardToken, f.member.scanCode, foreign.member.cardToken, formatCardLocator(foreign.member.cardLocator), `${f.userId}@example.test`, `${cashier}@example.test`, f.userId, cashier]) expect(body).not.toContain(secret);
  }
  expect(lines((await getMerchantCsv(foreign.userId, "karten")).body)).toHaveLength(2);
  expect(lines((await getMerchantCsv(foreign.userId, "buchungen")).body).slice(1).map(row => row.split(";")[5])).toEqual(["7"]);
  await expect(getMerchantCsv(cashier, "buchungen")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(getMerchantCsv(cashier, "karten")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(getMerchantCsv(randomUUID(), "karten")).rejects.toMatchObject({ code: "FORBIDDEN" });
});
