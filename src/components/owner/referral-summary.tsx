"use client";

type Props = { enabled: boolean; referrerBonus: number; referredBonus: number; programType: "stamp" | "points"; referrals: Array<{ status: string }>; truncated: boolean };

/** One-sentence rule plus the three funnel stages kept apart: signed up via link, waiting, and bonus credited. */
export function ReferralSummary({ enabled, referrerBonus, referredBonus, programType, referrals, truncated }: Props) {
  const unit = programType === "points" ? "Punkte" : "Stempel";
  const signedUp = referrals.length;
  const waiting = referrals.filter(item => item.status === "pending").length;
  const qualified = referrals.filter(item => item.status === "qualified").length;
  const rule = !enabled
    ? "Empfehlungen sind ausgeschaltet."
    : `Nach dem ersten bestätigten Kassenvorgang der neuen Karte erhält die empfehlende Karte ${referrerBonus} ${unit} und die neue Karte ${referredBonus} ${unit}.`;
  const stat = (label: string, value: number, note: string) => <div className="ow-metric"><dt>{label}</dt><dd><span className="ow-metric-value">{value}{truncated ? "+" : ""}</span></dd><dd className="ow-metric-note">{note}</dd></div>;
  return (
    <section className="ow-card ow-stack" aria-label="Empfehlungen im Überblick" style={{ marginBottom: 16 }}>
      <p><strong>Regel:</strong> {rule}</p>
      <dl className="ow-metrics" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {stat("Angemeldet über Link", signedUp, "Neue Karten, noch kein Bonus")}
        {stat("Wartet auf ersten Vorgang", waiting, "Noch kein bestätigter Kassenvorgang")}
        {stat("Bonus gutgeschrieben", qualified, "Erster Kassenvorgang bestätigt")}
      </dl>
      <p className="ow-hint">Grundlage sind die letzten 100 Empfehlungen. Einladungen, die niemand öffnet, werden nicht erfasst.</p>
    </section>
  );
}
