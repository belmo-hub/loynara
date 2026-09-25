"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson, ClientApiError, type MeResponse } from "@/components/client-api";
import { MerchantDashboardView, type DashboardActivity, type DashboardStats } from "@/components/loyalty-ui";

export default function MerchantPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await apiJson<MeResponse>("/api/me");
      if (result.role === "cashier") { router.replace("/cashier"); return; }
      if (!result.programSlug) { router.replace("/merchant/program"); return; }
      setMe(result);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 404) { router.replace("/merchant/program"); return; }
      setError(cause instanceof Error ? cause.message : "Die Übersicht konnte nicht geladen werden.");
    }
  }, [router]);
  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(result => {
      if (!active) return;
      if (result.role === "cashier") { router.replace("/cashier"); return; }
      if (!result.programSlug) { router.replace("/merchant/program"); return; }
      setMe(result);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 404) { router.replace("/merchant/program"); return; }
      setError(cause instanceof Error ? cause.message : "Die Übersicht konnte nicht geladen werden.");
    });
    return () => { active = false; };
  }, [router]);

  if (error) return <StatePage title="Übersicht nicht verfügbar" message={error} onRetry={load} />;
  if (!me) return <StatePage title="Übersicht wird geladen" message="Dein Standort und die aktuellen Vorgänge werden abgerufen." />;

  const stats: DashboardStats | undefined = me.stats ? { members: me.stats.members, awards: me.stats.awards, redemptions: me.stats.redemptions, periodLabel: me.stats.periodLabel || "Aktuelle Daten" } : undefined;
  const activity: DashboardActivity[] = (me.activity || []).map((entry, index) => ({ id: entry.id || String(index), kind: entry.kind === "redeem" ? "redemption" : entry.kind, occurredAt: entry.occurredAt || entry.createdAt || "", amount: Math.abs(entry.amount ?? entry.delta ?? 0), unit: me.programType === "points" ? "Punkte" : "Stempel", reference: entry.reference || "Kartenvorgang" }));
  if (!me.publicBaseUrl) return <StatePage title="Anmeldelink nicht verfügbar" message="Die öffentliche Adresse ist noch nicht konfiguriert." />;
  const joinUrl = new URL(`/join/${encodeURIComponent(me.programSlug)}`, me.publicBaseUrl).toString();

  async function downloadQr() {
    try {
      const response = await fetch(`/api/qr?value=${encodeURIComponent(joinUrl)}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("QR-Code konnte nicht geladen werden.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "looplocal-anmeldung.svg"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "QR-Code konnte nicht geladen werden."); }
  }

  return <MerchantDashboardView businessName={me.businessName} locationName={me.locationName} programType={me.programType === "stamp" ? "stamps" : "points"} rewardName={me.rewardTitle} rewardCost={me.rewardCost} stats={stats} activity={activity} joinUrl={joinUrl} onDownloadQr={downloadQr} canManageStaff={me.role === "owner"} exportUrl={me.role === "owner" ? "/api/merchant/export" : undefined} />;
}

function StatePage({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void | Promise<void> }) {
  return <main className="app-state-page"><div className="app-state-card"><span className="eyebrow"><span className="eyebrow-dot" /> LOOPLOCAL</span><h1>{title}</h1><p>{message}</p><div>{onRetry && <button type="button" className="button button--ink" onClick={() => void onRetry()}>Erneut versuchen</button>}<Link href="/">Zur Startseite</Link></div></div></main>;
}
