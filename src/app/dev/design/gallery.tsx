"use client";

import { Megaphone, Stamp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TextArea, TextField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { PointsLadder } from "@/components/ui/points-ladder";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StampGrid } from "@/components/ui/stamp-grid";
import { Stat, StatGroup } from "@/components/ui/stat";
import { Table, TableScroll } from "@/components/ui/table";
import { Segmented, TabNav } from "@/components/ui/tabs";
import { ToastProvider, useToast } from "@/components/ui/toast";
import styles from "./gallery.module.css";

const colours = ["bg", "surface", "raised", "ink", "ink-muted", "line", "line-strong", "action", "action-soft", "accent-text", "stamp", "success", "danger", "warning", "focus"];
const sizes = [["--display-36", "Übersicht"], ["--text-28", "Noch 2 Besuche bis zur Prämie"], ["--text-22", "Karte offen"], ["--text-18", "Letzte Vorgänge"], ["--text-16", "Ein Stempel pro Besuch. Gebucht wird erst, wenn das Team bestätigt."], ["--text-14", "Nur für die Wiederherstellung deiner Karte."], ["--text-12", "Übersicht"]];
const rewards = [{ title: "Kleiner Kaffee", cost: 30 }, { title: "Stück Kuchen", cost: 70 }, { title: "Frühstück für zwei", cost: 150 }];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.section} aria-labelledby={`g-${title}`}><h2 id={`g-${title}`} className={styles.sectionTitle}>{title}</h2>{children}</section>;
}

function Overlays() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  return <div className={styles.row}>
    <Button variant="secondary" onClick={() => setDialog(true)}>Dialog öffnen</Button>
    <Button variant="secondary" onClick={() => setSheet(true)}>Seitenblatt öffnen</Button>
    <Button variant="secondary" onClick={() => toast.show("Stempel vergeben")}>Hinweis zeigen</Button>
    <Button variant="secondary" onClick={() => toast.show("Keine Verbindung. Die Buchung wird nachgeholt.", { tone: "error" })}>Fehlerhinweis</Button>
    <Dialog open={dialog} onClose={() => setDialog(false)} title="Prämie einlösen?" description="Gratiskaffee für Karte K-H3G3E2. Danach stehen 0 Stempel auf der Karte."
      actions={<><Button variant="secondary" onClick={() => setDialog(false)}>Abbrechen</Button><Button onClick={() => setDialog(false)}>Ja, einlösen</Button></>} />
    <Sheet open={sheet} onClose={() => setSheet(false)} title="Karte K-H3G3E2" footer={<Button block onClick={() => setSheet(false)}>Fertig</Button>}>
      <p>6 von 8 Stempeln, zuletzt heute um 09:41.</p>
    </Sheet>
  </div>;
}

export function DesignGallery() {
  const [range, setRange] = useState<"30" | "90">("30");
  const [stamps, setStamps] = useState(6);
  return <ToastProvider>
    <PageHeader title="Gestaltung" description="Tokens und Bausteine aus DESIGN.md. Hell und dunkel folgen der Systemeinstellung." />

    <Section title="Farben"><ul className={styles.swatches}>{colours.map((c) => <li key={c}><span className={styles.swatch} style={{ background: `var(--color-${c})` }} /><code>--color-{c}</code></li>)}</ul></Section>

    <Section title="Schrift"><div className={styles.stack}>{sizes.map(([token, text]) => <p key={token} style={{ fontSize: `var(${token})`, fontFamily: token.startsWith("--display") ? "var(--font-display)" : undefined, margin: 0, lineHeight: 1.3 }}><code className={styles.token}>{token}</code> {text}</p>)}</div></Section>

    <Section title="Buttons">
      <div className={styles.row}><Button>Speichern</Button><Button variant="secondary">Abbrechen</Button><Button variant="quiet">Alle ansehen</Button><Button variant="danger">Karte schließen</Button><Button loading>Wird gespeichert</Button><Button disabled>Prämie einlösen</Button></div>
      <div className={styles.row}><Button size="sm">Klein</Button><Button size="lg">Öffnen</Button><Button variant="go" size="xl" block>1 Stempel vergeben</Button></div>
    </Section>

    <Section title="Felder">
      <div className={styles.grid2}>
        <TextField label="E-Mail-Adresse" type="email" placeholder="gast@beispiel.de" hint="Nur für die Wiederherstellung deiner Karte." />
        <TextField label="Kartennummer" defaultValue="K-7QX2M" error="Diese Kartennummer gibt es nicht. Prüfe die Schreibweise." />
        <Select label="Standort" defaultValue="mitte"><option value="mitte">Kassel Mitte</option><option value="wilhelmshoehe">Bäckerei & Konditorei Wilhelmshöhe</option></Select>
        <TextArea label="Programmregeln" defaultValue="Ein Stempel pro Kaffee. Acht Stempel ergeben einen Gratiskaffee." />
      </div>
      <Checkbox description="Freiwillig, jederzeit abbestellbar.">Ich möchte Angebote per E-Mail erhalten.</Checkbox>
    </Section>

    <Section title="Abzeichen und Karten">
      <div className={styles.row}><Badge>Entwurf</Badge><Badge tone="action">Aktiv</Badge><Badge tone="success">Einlösbar</Badge><Badge tone="warning">Offline vorgemerkt</Badge><Badge tone="danger">Gesperrt</Badge><Badge tone="stamp">Prämie bereit</Badge></div>
      <Card as="section" padding="lg" aria-labelledby="g-card"><CardHeader id="g-card" title="Startklar" description="4 von 6 Schritten erledigt" action={<Badge tone="action">4/6</Badge>} /><p className={styles.muted}>Karten ohne Rahmenschatten; Schatten nur für Objekte und Überlagerungen.</p></Card>
    </Section>

    <Section title="Auswahl und Navigation">
      <Segmented label="Zeitraum" value={range} onChange={setRange} options={[{ value: "30", label: "30 Tage" }, { value: "90", label: "90 Tage" }]} />
      <TabNav label="Kunden" items={[{ href: "/dev/design", label: "Kundenkarten", current: true }, { href: "/dev/design#g-Tabelle", label: "Zielgruppen" }, { href: "/dev/design#g-Leer", label: "Import" }]} />
    </Section>

    <Section title="Kennzahlen">
      <StatGroup label="Kennzahlen, letzte 30 Tage">
        <Stat label="Aktive Karten" value={10} note="10 neu in 30 Tagen" />
        <Stat label="Bestätigte Besuche" value={36} trend={[{ label: "KW 38", value: 0 }, { label: "KW 39", value: 4 }, { label: "KW 40", value: 9 }, { label: "KW 41", value: 36 }]} note="diese Woche hervorgehoben" />
        <Stat label="Wiederkehrend" value={88} unit="%" note="7 von 8 Gästen mit Besuch" />
        <Stat label="Eingelöste Prämien" value={1284} note="2 Karten kurz davor" />
      </StatGroup>
    </Section>

    <Section title="Tabelle">
      <TableScroll label="Letzte Vorgänge"><Table caption="Letzte Vorgänge" stack>
        <thead><tr><th scope="col">Vorgang</th><th scope="col">Karte</th><th scope="col">Zeit</th><th scope="col" data-align="end">Menge</th></tr></thead>
        <tbody>{[["Prämie eingelöst", "K-N3VUE6", "09:41", "−8"], ["Stempel vergeben", "K-369RZM", "09:38", "+1"], ["Stempel vergeben", "K-H3G3E2", "09:12", "+2"]].map(([a, b, c, d]) => <tr key={b + c}><td data-label="Vorgang">{a}</td><td data-label="Karte">{b}</td><td data-label="Zeit">{c}</td><td data-label="Menge" data-align="end">{d}</td></tr>)}</tbody>
      </Table></TableScroll>
    </Section>

    <Section title="Treue">
      <div className={styles.loyalty}>
        <div className={styles.stack}><div className={styles.object}><StampGrid earned={stamps} total={8} landed={stamps} /></div><div className={styles.row}><Button size="sm" variant="secondary" onClick={() => setStamps((n) => Math.max(0, n - 1))}>Stempel entfernen</Button><Button size="sm" onClick={() => setStamps((n) => Math.min(8, n + 1))}>Stempel landen lassen</Button></div></div>
        <div className={styles.object}><PointsLadder balance={64} rewards={rewards} /></div>
        <ProgressRing value={6} max={8} label="Stempel bis zur Prämie" size={140}><strong className={styles.ringValue}>2</strong><span className={styles.muted}>Besuche</span></ProgressRing>
      </div>
    </Section>

    <Section title="Leer und Laden">
      <div className={styles.grid2}>
        <Card><EmptyState icon={<Megaphone size={24} />} title="Noch keine Kampagnen" action={<Button size="sm">Kampagne anlegen</Button>}>Mit einer Kampagne erinnerst du Gäste, deren letzter Besuch länger her ist.</EmptyState></Card>
        <Card aria-busy="true"><div className={styles.stack}><Skeleton height={20} width="40%" /><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} width="70%" /></div></Card>
      </div>
    </Section>

    <Section title="Überlagerungen"><Overlays /></Section>
    <p className={styles.muted}><Stamp size={16} aria-hidden="true" /> Schalte die Systemdarstellung um, um das dunkle Thema zu prüfen.</p>
  </ToastProvider>;
}
