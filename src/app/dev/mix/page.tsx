import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowRight, CirclePlus, Flag, Gift, Link2, Megaphone, Palette, Printer } from "lucide-react";
import { MixCard } from "@/components/customer/mix-card";
import { MixChip, MixPanel, MixRow, MixSection, MixStack, mixButton, mixStyles } from "@/components/ui/mix";

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
    <Spec name="above the goal (9 of 8): true count, guest and owner voice"><MixCard {...shop} balance={9} /><MixCard {...shop} balance={9} voice="owner" /></Spec>
    <Spec name="Programm example"><MixCard {...shop} size="example" /><MixCard {...shop} size="example" reward={{ ...shop.reward, title: "Großer Milchkaffee mit Hafermilch und einem Stück Kuchen nach Wahl" }} /></Spec>
    <Spec name="thumb 0 … 8"><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{Array.from({ length: 9 }, (_, n) => <MixCard key={n} {...shop} balance={n} size="thumb" />)}</div></Spec>
    <Spec name="10 and 12 stamps"><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 10 }} /><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 12 }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 10 }} size="thumb" /><MixCard {...shop} balance={7} reward={{ ...shop.reward, cost: 12 }} size="thumb" />{[13, 16, 20, 21, 25, 30].map(n => <MixCard key={n} {...shop} balance={5} reward={{ ...shop.reward, cost: n }} size="thumb" />)}</div></Spec>
    <Spec name="points (house ladder)"><MixCard {...shop} programType="points" balance={186} reward={breakfast} rewards={[{ id: "a", title: "Kaffee", cost: 60 }, breakfast]} /></Spec>
    <MixStack className="patterns">
      <MixSection title="Deine Karte"><MixPanel>{["Programmregeln", "So findest du deine Karte wieder", "Meine Kartendaten exportieren"].map(t => <MixRow key={t} title={t} href="#" />)}</MixPanel></MixSection>
      <MixSection title={<><Flag size={20} aria-hidden="true" />Als Nächstes</>}><MixPanel><MixRow title="Deine 100. Karte" href="#" /></MixPanel></MixSection>
      <MixSection title="Aussehen" aside={<MixChip>Beispiel</MixChip>} note="Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.">
        <MixPanel><MixRow icon={<Palette size={20} />} title="Kundenkarte" sub="Namen, Logo und Farbe" href="#" /></MixPanel></MixSection>
      <MixPanel>
        <MixRow icon={<Link2 size={20} />} title="Anmeldelink kopieren" href="#" />
        <MixRow icon={<Printer size={20} />} title="Tresenschild laden" sub="Mit QR-Code zum Ausdrucken" href="#" />
        <MixRow icon={<CirclePlus size={20} />} title="Startbonus" sub="Mit der ersten Buchung, einmal pro Karte" end="Aus" href="#" />
        <MixRow icon={<Megaphone size={20} />} title="Neuigkeit" end="Keine" href="#" />
      </MixPanel>
      <MixPanel>
        <MixRow thumb={<MixCard {...shop} balance={8} size="thumb" />} title={<>K-4RT9QE<MixChip warm><Gift size={16} aria-hidden="true" />Prämie verdient</MixChip></>} sub="Letzte Buchung 13.11., 18:12" href="#" />
        <MixRow thumb={<MixCard {...shop} size="thumb" />} title="K-C7YPM6" sub="Letzte Buchung 12.11., 08:41" href="#" />
        <a className={mixStyles.more} href="#">Weitere Karten laden</a>
      </MixPanel>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}><MixChip>Beispiel</MixChip><MixChip>Korrigiert</MixChip><MixChip>Einlösung</MixChip><MixChip warm><Gift size={16} aria-hidden="true" />Prämie verdient</MixChip></div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}><a className={mixButton()} href="#">Ansehen<ArrowRight size={20} aria-hidden="true" /></a><a className={mixButton({ variant: "quiet" })} href="#">Tresenschild laden</a></div>
      <a className={mixButton({ lg: true, block: true })} href="#">Ansehen</a>
    </MixStack>
    <div className="ly-theme-dark" style={{ margin: "16px -16px -40px", padding: "16px 16px 40px", background: "var(--color-bg)", display: "grid", gap: 16 }}>
      <Spec name="kasse"><MixCard {...shop} size="kasse" title="K-C7YPM6" sub="Geprüfte Karte" label="Aktueller Kontostand"
        foot={<><span style={{ height: 56, padding: "0 20px 0 16px", borderRadius: 999, background: "rgba(255,255,255,.16)", display: "inline-flex", alignItems: "center", fontWeight: 720 }}>Andere Karte</span><span style={{ fontWeight: 720 }}>Karte offen</span></>} /></Spec>
    </div>
  </main>;
}
