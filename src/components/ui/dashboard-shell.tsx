"use client";

import { MoreHorizontal } from "lucide-react";
import NextLink from "next/link";
import { useState, type ComponentType, type ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import { Sheet } from "./sheet";
import { ToastProvider } from "./toast";
import styles from "./dashboard-shell.module.css";

export type NavItem = { id: string; href: string; label: string; icon: ReactNode; current?: boolean };
export type NavGroup = { id: string; label: string; items: NavItem[] };
type LinkProps = { href: string; className?: string; "aria-current"?: "page"; onClick?: () => void; children?: ReactNode };

type Props = {
  groups: NavGroup[];
  /** Item ids shown in the phone bottom bar (four at most); everything else lives in "Mehr". */
  tabIds: string[];
  brandHref: string;
  location: ReactNode;
  user: ReactNode;
  primaryAction: ReactNode;
  compactAction: ReactNode;
  /** Owner pages pass their guarded link so unsaved edits are never lost by navigating. */
  LinkComponent?: ComponentType<LinkProps>;
  mainId?: string;
  busy?: boolean;
  children?: ReactNode;
};

export function DashboardShell({ groups, tabIds, brandHref, location, user, primaryAction, compactAction, LinkComponent = NextLink, mainId = "inhalt", busy, children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const Link = LinkComponent;
  const items = groups.flatMap((g) => g.items);
  const tabs = tabIds.map((id) => items.find((i) => i.id === id)).filter((i): i is NavItem => Boolean(i)).slice(0, 4);
  const currentInMore = !tabs.some((t) => t.current) && items.some((i) => i.current);
  const navList = (onNavigate?: () => void) => groups.map((group) => <div key={group.id} className={styles.group}>
    <p className={styles.groupLabel}>{group.label}</p>
    {group.items.map((item) => <Link key={item.id} href={item.href} className={styles.navLink} aria-current={item.current ? "page" : undefined} onClick={onNavigate}>
      <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>{item.label}
    </Link>)}
  </div>);

  return <div className={cx("ly-theme-auto", styles.shell)}>
    <ToastProvider>
      <a href={`#${mainId}`} className={styles.skip}>Zum Inhalt springen</a>
      <aside className={styles.side} aria-label="Seitenleiste">
        <Link href={brandHref} className={styles.brand}><BrandMark label="Loynara, zur Übersicht" /></Link>
        <div className={styles.location}>{location}</div>
        <nav aria-label="Hauptnavigation" className={styles.nav}>{navList()}</nav>
        <div className={styles.sideFoot}>{primaryAction}<div className={styles.user}>{user}</div></div>
      </aside>
      <header className={styles.top}>
        <Link href={brandHref} className={styles.topBrand}><BrandMark word={false} label="Loynara, zur Übersicht" /></Link>
        <div className={styles.topLocation}>{location}</div>
        {compactAction}
      </header>
      <main id={mainId} className={styles.main} tabIndex={-1} aria-busy={busy || undefined}>{children}</main>
      <nav className={styles.tabs} aria-label="Bereiche">
        {tabs.map((tab) => <Link key={tab.id} href={tab.href} className={styles.tab} aria-current={tab.current ? "page" : undefined}><span aria-hidden="true">{tab.icon}</span>{tab.label}</Link>)}
        <button type="button" className={styles.tab} data-current={currentInMore || undefined} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><MoreHorizontal size={22} aria-hidden="true" />Mehr</button>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Mehr" side="bottom">
        <nav aria-label="Alle Bereiche" className={styles.moreNav}>{navList(() => setMoreOpen(false))}</nav>
        <div className={styles.moreUser}>{user}</div>
      </Sheet>
    </ToastProvider>
  </div>;
}
