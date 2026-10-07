"use client";

import { Notice, nf, Skeleton } from "./owner-ui";
import { useLoad } from "./use-load";

/** Mirrors lib/wallet/readiness: product states only, never configuration detail. */
export type OwnerWalletReadiness = {
  apple: "ready" | "not_set_up";
  google: "ready" | "test_only" | "not_set_up";
  logo: "ready" | "needs_png" | "too_large" | "missing" | "needs_review";
  googleLogo: "merchant" | "fallback";
  ink: "light" | "dark";
  passes: { apple: number; google: number };
  delayedUpdates: number;
};

type Tone = "ok" | "warn" | "info";
function Chip({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`ow-chip ow-chip--${tone}`}><span className="ow-dot" aria-hidden="true" />{children}</span>;
}

const PROVIDER: Record<OwnerWalletReadiness["google"], { tone: Tone; label: string; hint: string }> = {
  ready: { tone: "ok", label: "Bereit", hint: "Kundinnen und Kunden sehen den Button auf ihrer Karte." },
  test_only: { tone: "warn", label: "Testphase", hint: "Nur freigegebene Testkonten können speichern. Loynara schaltet es frei." },
  not_set_up: { tone: "info", label: "Noch nicht aktiv", hint: "Loynara richtet das ein. Bis dahin funktioniert die Karte im Browser." },
};

const LOGO: Record<OwnerWalletReadiness["logo"], { tone: Tone; label: string; hint: string }> = {
  needs_review: { tone: "warn", label: "Design prüfen", hint: "Loynara prüft das Wallet-Design vor der Freigabe. Änderungen an Logo und Farben müssen dort gesondert übernommen werden." },
  ready: { tone: "ok", label: "Bereit", hint: "Dein Logo erscheint auf der Wallet-Karte." },
  needs_png: { tone: "warn", label: "PNG nötig", hint: "Wallet zeigt nur PNG-Logos. Lade dein Logo als PNG hoch, sonst steht dort dein Geschäftsname." },
  too_large: { tone: "warn", label: "Zu groß", hint: "Bitte ein PNG bis 500 KB und höchstens 2048 Pixel Kantenlänge hochladen. Bis dahin steht dort dein Geschäftsname." },
  missing: { tone: "info", label: "Ohne Logo", hint: "Ohne Logo steht dein Geschäftsname auf der Wallet-Karte. Das sieht ordentlich aus; ein PNG-Logo wirkt persönlicher." },
};

export function WalletReadiness({ programSlug, version }: { programSlug: string; version: number }) {
  const [data, reload] = useLoad<OwnerWalletReadiness>(`/api/merchant/program/wallet?programSlug=${encodeURIComponent(programSlug)}&v=${version}`);
  if (data.state === "error") return <Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={reload}>Erneut laden</button>}>Der Wallet-Status konnte nicht geladen werden.</Notice>;
  if (data.state !== "ok") return <Skeleton height={150} />;
  const wallet = data.data;
  const apple = PROVIDER[wallet.apple];
  const google = PROVIDER[wallet.google];
  const logo = LOGO[wallet.logo];
  const issued = wallet.passes.apple + wallet.passes.google;
  return (
    <div className="ow-stack ow-wallet-ready" aria-live="polite">
      <dl className="ow-wallet-ready-list">
        <div><dt>Apple Wallet</dt><dd><Chip tone={apple.tone}>{apple.label}</Chip><span className="ow-hint">{apple.hint}</span></dd></div>
        <div><dt>Google Wallet</dt><dd><Chip tone={google.tone}>{google.label}</Chip><span className="ow-hint">{google.hint}</span></dd></div>
        <div><dt>Logo</dt><dd><Chip tone={logo.tone}>{logo.label}</Chip><span className="ow-hint">{logo.hint}{wallet.logo === "ready" && wallet.googleLogo === "fallback" && wallet.google !== "not_set_up" ? " Google Wallet zeigt es, sobald Loynara die Bildfreigabe eingerichtet hat." : ""}</span></dd></div>
      </dl>
      {(wallet.apple !== "not_set_up" || wallet.google !== "not_set_up") && <p className="ow-hint">{issued === 0 ? "Noch wurden keine Wallet-Karten erstellt." : `${nf.format(issued)} ${issued === 1 ? "Wallet-Karte wurde" : "Wallet-Karten wurden"} erstellt (Apple ${nf.format(wallet.passes.apple)}, Google ${nf.format(wallet.passes.google)}). Ob sie auf dem Gerät gespeichert wurden, ist hier nicht bestätigt.`}</p>}
      {wallet.delayedUpdates > 0 && <Notice tone="warn">Bei {nf.format(wallet.delayedUpdates)} {wallet.delayedUpdates === 1 ? "Karte" : "Karten"} ist die Wallet-Anzeige gerade nicht aktuell. Stand und Prämien in Loynara stimmen; an der Kasse zählt immer Loynara. Bei anhaltenden Verzögerungen wende dich an Loynara: Eine festgefahrene Aktualisierung muss geprüft und erneut gestartet werden.</Notice>}
    </div>
  );
}
