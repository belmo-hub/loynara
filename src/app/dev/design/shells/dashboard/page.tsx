import { BarChart3, CreditCard, Gift, LayoutGrid, MapPin, Megaphone, Receipt, ScanLine, Settings, Stamp, UserCog, Users, UsersRound, Workflow } from "lucide-react";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/ui/button";
import { DashboardShell, type NavGroup } from "@/components/ui/dashboard-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGroup } from "@/components/ui/stat";

const i = (Icon: typeof Stamp) => <Icon size={18} />;
const groups: NavGroup[] = [
  { id: "overview", label: "Überblick", items: [{ id: "home", href: "/dev/design/shells/dashboard", label: "Übersicht", icon: i(LayoutGrid), current: true }] },
  { id: "program", label: "Programm", items: [{ id: "program", href: "#programm", label: "Treueprogramm", icon: i(Stamp), tabLabel: "Programm" }, { id: "card", href: "#karte", label: "Kundenkarte", icon: i(CreditCard) }] },
  { id: "customers", label: "Kunden", items: [{ id: "customers", href: "#kunden", label: "Kundenkarten", icon: i(Users), tabLabel: "Kunden" }] },
  { id: "marketing", label: "Marketing", items: [{ id: "campaigns", href: "#kampagnen", label: "Kampagnen", icon: i(Megaphone) }, { id: "audiences", href: "#zielgruppen", label: "Zielgruppen", icon: i(UsersRound) }, { id: "automations", href: "#automationen", label: "Automationen", icon: i(Workflow) }, { id: "referrals", href: "#empfehlungen", label: "Empfehlungen", icon: i(Gift) }] },
  { id: "insights", label: "Auswertung", items: [{ id: "analytics", href: "#auswertung", label: "Auswertung", icon: i(BarChart3) }] },
  { id: "ops", label: "Betrieb", items: [{ id: "locations", href: "#standorte", label: "Standorte", icon: i(MapPin) }, { id: "staff", href: "#team", label: "Team", icon: i(UserCog) }, { id: "billing", href: "#abrechnung", label: "Abrechnung", icon: i(Receipt) }, { id: "settings", href: "#einstellungen", label: "Einstellungen", icon: i(Settings) }] },
];

export default function DashboardShellPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DashboardShell groups={groups} tabIds={["home", "customers", "program", "analytics"]} brandHref="/dev/design/shells/dashboard"
    location={<span>Kassel Mitte</span>} compactLocation={<span>Kassel Mitte</span>} user={<span>Demo Inhaber · Inhaber:in</span>} moreFooter={<span>Demo Inhaber · Inhaber:in</span>}
    primaryAction={<a href="#kasse" className={buttonClassName({ block: true })}><ScanLine size={18} aria-hidden="true" /> Kasse öffnen</a>}
    compactAction={<a href="#kasse" className={buttonClassName({ size: "sm" })}><ScanLine size={18} aria-hidden="true" /> Kasse</a>}>
    <PageHeader title="Übersicht" description="Demo Kaffeebar Kassel, letzte 30 Tage" />
    <StatGroup label="Kennzahlen"><Stat label="Aktive Karten" value={10} note="10 neu" /><Stat label="Bestätigte Besuche" value={36} note="in 30 Tagen" /></StatGroup>
  </DashboardShell>;
}
