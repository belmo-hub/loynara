import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CustomerShell } from "@/components/ui/customer-shell";
import { StampGrid } from "@/components/ui/stamp-grid";
import styles from "../shells.module.css";

export default async function CustomerShellPreview({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { brand } = await searchParams;
  return <CustomerShell brandColor={brand ? `#${brand}` : "#2F6B58"} header={<strong>Demo Kaffeebar Kassel</strong>} footer={<p>Vorschau der Kundenhülle mit synthetischen Daten.</p>}>
    <h1 className={styles.goal}>Noch 2 Besuche bis zur Prämie</h1>
    <section className={styles.object} aria-label="Stempelkarte"><StampGrid earned={6} total={8} /></section>
    <Button block>Karte in Wallet speichern</Button>
  </CustomerShell>;
}
