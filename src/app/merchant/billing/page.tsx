"use client";

import { CreditCard, Euro, FileText, FlaskConical, MapPin } from "lucide-react";
import { useState, type ReactNode } from "react";
import { postJson } from "@/components/client-api";
import { billingStatus, liveStatusSub, money, perMonth, type BillingOverview as Overview } from "@/components/owner/billing-copy";
import { CancellationNotice } from "@/components/owner/cancellation-notice";
import { MORE_HREF } from "@/components/owner/nav";
import { useOwner } from "@/components/owner/owner-context";
import { Band, MoreLabel, NumberCard, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import { germanDate as date } from "@/lib/german-date";

const count = (value: number) => value.toLocaleString("de-DE");

/**
 * Abrechnung (ENG-122c, screen 17; D-021): the monthly price card, the status, each location with its stored price, the
 * receipts. Only what the billing read returns: no price, plan name or VAT wording of its own (the tax line is the read's,
 * empty while BILLING_VAT_MODE is unset).
 */
export default function MerchantBillingPage() {
  const { me } = useOwner();
  const [data, reload] = useLoad<Overview>(me?.role === "owner" ? "/api/merchant/billing" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!me) return null;
  const head = <PageTitle back={{ href: MORE_HREF, label: <MoreLabel /> }} title="Abrechnung" lead="Preise und Nutzung pro Standort." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice>Nur die Inhaberin oder der Inhaber kann Abrechnungsdaten sehen.</Notice></div>;
  if (data.state === "error") return <div className="ow-page">{head}<ErrorNotice message={data.message} onRetry={reload} /></div>;
  if (data.state !== "ok") return <div className="ow-page">{head}<LoadingBlock rows={3} height={64} /></div>;
  const o = data.data;
  if (o.liveBilling) return <LiveBilling o={o} head={<>{head}<CancellationNotice me={me} /></>} />;

  async function startFixture() {
    setBusy(true); setError("");
    try {
      const handoff = await postJson<{ url: string }>("/api/merchant/billing/handoff", {});
      const target = new URL(handoff.url);
      if (target.origin !== window.location.origin || !target.pathname.startsWith("/merchant/billing/fixture/")) throw new Error("Lokaler Testlink ist ungültig.");
      window.location.assign(target.pathname);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Testvorgang konnte nicht gestartet werden."); setBusy(false); }
  }
  async function cancelFixture() {
    setBusy(true); setError("");
    try { await postJson("/api/merchant/billing/cancel", {}); setConfirmCancel(false); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kündigung konnte nicht vorgemerkt werden."); }
    finally { setBusy(false); }
  }
  const canStart = o.fixtureAvailable && ["manual_pending", "pending_checkout", "cancelled", "suspended_fixture"].includes(o.status);
  const canEnd = o.fixtureAvailable && ["active_fixture", "grace_fixture"].includes(o.status) && !o.cancelAtPeriodEnd;

  return (
    <div className="ow-page">
      {head}
      <CancellationNotice me={me} />
      {error && <ErrorNotice message={error} />}
      {/* Kicker and note: Marketing FINAL for screen 17 (28 Oct), replacing the draft wording. */}
      <NumberCard label="Dein Preis im Monat" value={money(o.monthlySubtotalMinor, o.currency)}>
        <p className="ow-board-sub">{perMonth(o.locationCount, o.monthlySubtotalMinor, o.currency)}</p>
        <p className="ow-numcard-note">Noch keine Zahlung. Alle Bedingungen bekommst du schriftlich, bevor du etwas zahlst.</p>
      </NumberCard>
      <div className="ow-prog">
        <Rows title="Status">
          <Row key="status" icon={Euro} title={billingStatus(o)} sub={o.cancelAtPeriodEnd && o.currentPeriodEnd ? `Beendigung zum ${date(o.currentPeriodEnd)} vorgemerkt.` : o.graceUntil ? `Test-Nachfrist bis ${date(o.graceUntil)}.` : undefined} />
        </Rows>
        <Rows title="Standorte" help={<><p>{o.countingRule} Es gibt keine geprüfte Steuer- oder Zahlungsintegration.</p><p>Geschlossene Karten zählen nicht zum Kartenlimit. Der Preis ist je Standort gespeichert; ein neuer Standort löst keine automatische Zahlung aus.</p></>}>
          {o.locations.map(location => <Row key={location.locationId} icon={MapPin} title={location.locationName} sub={`${count(location.activeMembers)} von ${count(location.memberLimit)} aktiven Karten`} value={<Price minor={location.priceMinor} currency={o.currency} />} big />)}
        </Rows>
        <Rows title="Belege">
          {o.invoices.length
            ? o.invoices.map(invoice => <Row key={invoice.id} icon={FileText} title={`${money(invoice.amountMinor, invoice.currency)} · Testbuchung`} sub={<>Erfasst {date(invoice.createdAt)} · Testperiode bis {date(invoice.periodEnd)}<br />Fixture-Beleg {invoice.providerInvoiceId}. Steuer nicht berechnet; keine gültige Steuerrechnung.</>} />)
            : <Row key="none" icon={FileText} title="Keine Belege vorhanden." sub="Es wurde keine Zahlung erfasst." />}
        </Rows>
        {/* The local payment test exists on development and preview only (fixtureAvailable). */}
        {(canStart || canEnd) && <Rows title="Nächste Schritte" note="Ein echter gehosteter Checkout, Portalzugang, Steuerberechnung und Rechnungsversand sind nicht eingerichtet.">
          {canStart && <Row key="start" icon={FlaskConical} title="Lokalen Zahlungstest öffnen" onClick={() => { if (!busy) void startFixture(); }} />}
          {canEnd && (!confirmCancel
            ? <Row key="end" icon={FlaskConical} title="Testperiode zum Ende beenden" onClick={() => setConfirmCancel(true)} />
            : <div key="confirm" className="ow-qpanel ow-stack"><p>Die Testperiode endet zum angezeigten Periodenende. Bestehende Karten und Buchungen bleiben erhalten.</p><div className="ow-row"><button type="button" className="ow-btn ow-btn--danger" disabled={busy} onClick={() => void cancelFixture()}>Beendigung bestätigen</button><button type="button" className="ow-btn ow-btn--ghost" onClick={() => setConfirmCancel(false)}>Zurück</button></div></div>)}
        </Rows>}
      </div>
    </div>
  );
}

/** A location's stored price with „im Monat“ under it, so the value stays beside the name (Marketing: „{Preis} im Monat“). */
function Price({ minor, currency }: { minor: number; currency: "EUR" | "MAD" }) {
  return <span className="ow-price">{money(minor, currency)}<small> im Monat</small></span>;
}

/** Live billing through Stripe: checkout and the customer portal are Stripe-hosted pages; only their exact hosts are followed. */
function LiveBilling({ o, head }: { o: Overview; head: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go(path: string, host: string) {
    setBusy(true); setError("");
    try {
      const { url } = await postJson<{ url: string }>(path, {});
      if (new URL(url).origin !== host) throw new Error("Der Zahlungslink ist ungültig.");
      window.location.assign(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt."); setBusy(false); }
  }
  const canCheckout = o.planCode !== null && ["manual_pending", "pending_checkout", "cancelled"].includes(o.status);
  const checkout = () => { if (!busy) void go("/api/merchant/billing/handoff", "https://checkout.stripe.com"); };
  return (
    <div className="ow-page">
      {head}
      {error && <ErrorNotice message={error} />}
      {o.status === "past_due" && <Notice tone="warn" role="alert">Die letzte Zahlung ist fehlgeschlagen. Bitte prüfe deine Zahlungsdaten.</Notice>}
      {/* No amount before the operator has set the plan: a list total would be untrue for a price not yet agreed (Product, L10). */}
      {o.charge
        ? <NumberCard label="Monatlich" value={money(o.charge.totalMinor, o.currency)}>
          <p className="ow-board-sub">{perMonth(o.charge.quantity, o.charge.totalMinor, o.currency)}</p>
          {o.taxNote && <p className="ow-board-sub">{o.taxNote}</p>}
        </NumberCard>
        : <NumberCard label="Monatlich" value="Tarif offen"><p className="ow-board-sub">Dein Preis wird mit dir vereinbart.</p></NumberCard>}
      {canCheckout && <Band icon={CreditCard} title="Abo abschließen" sub="Zahlung, Rechnungen und Kündigung laufen über unseren Zahlungsanbieter Stripe." onClick={checkout} />}
      <div className="ow-prog">
        <Rows title="Status">
          <Row key="status" icon={Euro} title={billingStatus(o)} sub={liveStatusSub(o, date)} />
          {o.paymentAccount && <Row key="portal" icon={CreditCard} title="Zahlungsdaten, Rechnungen und Kündigung" onClick={() => { if (!busy) void go("/api/merchant/billing/portal", "https://billing.stripe.com"); }} />}
        </Rows>
        <Rows title="Standorte" help={<p>{o.countingRule}</p>} note={o.planCode === null ? "Dein Tarif wird noch festgelegt. Danach kannst du das Abo hier abschließen." : undefined}>
          {o.locations.map(location => <Row key={location.locationId} icon={MapPin} title={location.locationName} sub={`${count(location.activeMembers)} von ${count(location.memberLimit)} aktiven Karten`} value={o.charge ? <Price minor={o.charge.unitMinor} currency={o.currency} /> : undefined} big />)}
        </Rows>
      </div>
    </div>
  );
}
