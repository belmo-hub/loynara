import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { MixCard } from "@/components/customer/mix-card";

export const metadata: Metadata = { title: "Mix – Vorschau", robots: { index: false, follow: false } };

// The demo shop of the approved mix pictures: navy, white ink, coral stamps.
const navy = { "--merchant": "#1F3A5F", "--merchant-deep": "#16293F", "--merchant-ink": "#FFFFFF" } as CSSProperties;
const shop = { businessName: "Demo Kaffeebar Kassel", locationName: "Kassel Mitte", programType: "stamps" as const, balance: 5, reward: { id: "r", title: "Gratiskaffee", cost: 8 } };
const breakfast = { id: "p", title: "Frühstück für zwei", cost: 250 };

function Spec({ name, children }: { name: string; children: ReactNode }) {
  return <section data-spec={name} style={{ display: "grid", gap: 16 }}><p style={{ margin: 0, font: "12px/16px var(--font-mono)", color: "var(--color-ink-faint)" }}>{name}</p>{children}</section>;
}

/** Development-only specimen of the mix card at every size (mock: mix/system.html). Not reachable in production. */
export default function MixPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main style={{ ...navy, maxWidth: 440, margin: "0 auto", padding: "16px 16px 40px", display: "grid", gap: 16, background: "var(--color-bg)" }}>
    <Spec name="full 5 von 8 (guest)"><MixCard {...shop} /></Spec>
    <Spec name="full 0 · 8"><MixCard {...shop} balance={0} /><MixCard {...shop} balance={8} /></Spec>
    <Spec name="full, owner voice"><MixCard {...shop} voice="owner" /></Spec>
    <Spec name="Programm example"><MixCard {...shop} voice="example" /></Spec>
    <Spec name="thumb 0 … 8"><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{Array.from({ length: 9 }, (_, n) => <MixCard key={n} {...shop} balance={n} size="thumb" />)}</div></Spec>
    <Spec name="10 and 12 stamps"><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 10 }} /><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 12 }} />
      <div style={{ display: "flex", gap: 12 }}><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 10 }} size="thumb" /><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 12 }} size="thumb" /></div></Spec>
    <Spec name="points (house ladder)"><MixCard {...shop} programType="points" balance={186} reward={breakfast} rewards={[{ id: "a", title: "Kaffee", cost: 60 }, breakfast]} /></Spec>
    <div className="ly-theme-dark" style={{ margin: "16px -16px -40px", padding: "16px 16px 40px", background: "var(--color-bg)", display: "grid", gap: 16 }}>
      <Spec name="kasse"><MixCard {...shop} size="kasse" title="K-C7YPM6" sub="Geprüfte Karte" label="Aktueller Kontostand"
        foot={<><span style={{ height: 56, padding: "0 20px 0 16px", borderRadius: 999, background: "rgba(255,255,255,.16)", display: "inline-flex", alignItems: "center", fontWeight: 720 }}>Andere Karte</span><span style={{ fontWeight: 720 }}>Karte offen</span></>} /></Spec>
    </div>
  </main>;
}
