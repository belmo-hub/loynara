import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Pilot wording check: merchants must not see internal test language on the pages a real merchant can reach.
// Fixture-only controls (billing test period, Mailpit channel) stay labelled as tests because they exist only in non-production.
const forbidden: Array<[string, RegExp[]]> = [
  ["src/lib/billing.ts", [/Fixture-Belege sind keine Steuerrechnungen\.",/]],
  ["src/app/merchant/billing/page.tsx", [/synthetischen Daten/, /Belege aus lokalen Tests/, /Test und nächste Schritte/, /Keine Testbelege/]],
  ["src/app/merchant/billing/fixture/[id]/page.tsx", [/Lokale Fixture/, /synthetische Monatsperiode/, /Teil dieser Fixture/]],
  ["src/components/auth-frame.tsx", [/Produktvorschau/]],
  ["src/app/merchant/adviser/page.tsx", [/Modellanbindung/, /Aktionen · Beratung/, /· UTC/]],
  ["src/app/merchant/analytics/page.tsx", [/Zustellversuche/, /Mailpit/, /noch nicht/, /Verfügbare Zeiträume/]],
  ["src/components/owner/period-bar.tsx", [/noch nicht/]],
  ["src/app/merchant/staff/page.tsx", [/noch nicht festgelegt/]],
  ["src/components/owner/program-setup.tsx", [/noch nicht aktiv/]],
  ["src/lib/adviser.ts", [/synthetischen Karte/, /Lokale Zustellversuche/, /lokaler Annahmestatus/]],
  ["src/app/merchant/customers/import/page.tsx", [/Synthetische/, /Nur lokal/, /Testadresse vorhanden/, /Testdatei/, /Test-E-Mail/, /lokalen Loynara-Instanz/]],
  ["src/components/owner/customers-view.tsx", [/Synthetische CSV/]],
  ["src/app/merchant/analytics/page.tsx", [/Mailpit/, /lokalen Testkanal/, /lokale Zustellversuche/]],
];

describe("merchant-facing copy", () => {
  for (const [file, patterns] of forbidden) {
    it(`${file} has no internal test wording`, () => {
      const source = readFileSync(file, "utf8");
      for (const pattern of patterns) expect(source, String(pattern)).not.toMatch(pattern);
    });
  }
});
