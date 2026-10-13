import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CashierShell, type CashierState } from "@/components/ui/cashier-shell";
import { StampGrid } from "@/components/ui/stamp-grid";
import styles from "../shells.module.css";

const labels: Record<CashierState, string> = { ready: "Bereit zum Scannen", open: "Karte offen", busy: "Wird gebucht", done: "Erledigt", error: "Nicht gebucht" };

export default async function CashierShellPreview({ searchParams }: { searchParams: Promise<{ state?: CashierState }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const state = (await searchParams).state ?? "open";
  return <CashierShell location="Kassel Mitte" state={state} stateLabel={labels[state] ?? labels.open} stateDetail={state === "ready" ? "Code in den Rahmen halten" : "K-H3G3E2"} brandColor="#2F6B58"
    dock={<><Button variant="go" size="xl" block>1 Stempel vergeben</Button><Button variant="secondary" size="lg" block>Abbrechen</Button></>}>
    <section className={styles.cashierCard} aria-label="Geöffnete Karte"><p className={styles.balance}>6 von 8 Stempeln</p><StampGrid earned={6} total={8} size="sm" /></section>
  </CashierShell>;
}
