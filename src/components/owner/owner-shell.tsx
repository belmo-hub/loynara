"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { activeGroup, groupHref, groupLabel, MORE_HREF, visibleGroups, visibleItems } from "./nav";
import { useOwner } from "./owner-context";
import { OwnerIcon, Skeleton } from "./owner-ui";
import { ProgrammeEndedPage } from "./programme-ended-page";

function GuardedLink({ href, children, ...rest }: { href: string; children: ReactNode } & Omit<React.ComponentProps<typeof Link>, "href">) {
  const router = useRouter();
  const { guard } = useOwner();
  return <Link href={href} {...rest} onClick={event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    guard(() => router.push(href));
    rest.onClick?.(event);
  }}>{children}</Link>;
}
export { GuardedLink };

/** One word per area for the phone bottom bar. */
const TAB_LABELS: Record<string, string> = { program: "Programm" };

export function OwnerShell({ children }: { children: ReactNode }) {
  const owner = useOwner();
  const router = useRouter();
  const pathname = usePathname();
  const subnav = useRef<HTMLDivElement>(null);

  // Sub-page tabs wider than the phone: bring the current tab into view and fade the edge that hides more tabs.
  useEffect(() => {
    const row = subnav.current;
    if (!row) return;
    const edges = () => { row.dataset.start = String(row.scrollLeft > 1); row.dataset.end = String(row.scrollLeft + row.clientWidth < row.scrollWidth - 1); };
    const active = row.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    edges();
    row.addEventListener("scroll", edges, { passive: true });
    window.addEventListener("resize", edges);
    return () => { row.removeEventListener("scroll", edges); window.removeEventListener("resize", edges); };
  }, [pathname, owner.me]);

  if (owner.status === "unprovisioned") {
    // Before a programme exists (setup, ENG-122f): the logo alone, no shop name, no Kasse and no tab bar; signing out stays.
    return <div className="ow-bare ow-bare--setup"><div className="ow-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}><BrandMark word={false} label="Loynara" /><LogoutButton className="ow-btn ow-btn--ghost ow-btn--sm" onSignedOut={owner.resetAfterSignOut} /></div><main id="ow-main">{children}</main></div>;
  }
  if (owner.status === "ended" && owner.ended) {
    // Nothing else is offered: no navigation and no settings that could change the programme.
    return <div className="ow-bare"><div className="ow-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}><BrandMark /><LogoutButton className="ow-btn ow-btn--secondary" onSignedOut={owner.resetAfterSignOut} /></div><main id="ow-main"><ProgrammeEndedPage info={owner.ended} /></main></div>;
  }
  if (owner.status === "error") {
    return <div className="ow-page" style={{ maxWidth: 560, paddingTop: 96 }} role="alert"><div className="ow-card ow-stack"><h1 style={{ fontSize: "var(--text-22)" }}>Dein Bereich ist nicht erreichbar</h1><p className="ow-muted">{owner.error}</p><div><button type="button" className="ow-btn ow-btn--primary" onClick={owner.reload}>Erneut versuchen</button></div><LogoutButton className="ow-btn ow-btn--secondary" onSignedOut={owner.resetAfterSignOut} /></div></div>;
  }

  const me = owner.me;
  const role = me?.role ?? "owner";
  const hidden = me?.hiddenSurfaces ?? [];
  const group = activeGroup(pathname, role, hidden);
  const subItems = group ? visibleItems(group, role, hidden) : [];
  const many = owner.locations.length > 1;
  const openCashier = (event: React.MouseEvent) => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); owner.guard(() => router.push("/cashier")); } };

  return (
    <div className="ow-shell">
      <a href="#ow-main" className="ow-skip">Zum Inhalt springen</a>
      {/* Desktop only: below 1024 px the bottom bar and the „Mehr“ page carry the same destinations. */}
      <aside className="ow-side" aria-label="Bereichsnavigation">
        <div className="ow-brand"><GuardedLink href="/merchant" aria-label="Loynara – zur Übersicht"><BrandMark /></GuardedLink></div>
        <LocationBox />
        <nav className="ow-nav" aria-label="Hauptnavigation">
          {visibleGroups(role, hidden).map(item => (
            <GuardedLink key={item.id} href={groupHref(item, role, hidden)} aria-current={group?.id === item.id ? "page" : undefined}><OwnerIcon name={item.icon} />{groupLabel(item, hidden)}</GuardedLink>
          ))}
        </nav>
        <div className="ow-side-foot">
          <Link href="/cashier" className="ow-utility" onClick={openCashier}><OwnerIcon name="till" size={18} />Kasse öffnen</Link>
          {me && <p className="ow-who">{me.businessName}<br />{me.role === "owner" ? "Inhaber:in" : "Manager:in"}</p>}
          <LogoutButton className="ow-btn ow-btn--secondary" onSignedOut={owner.resetAfterSignOut} />
        </div>
      </aside>
      <div className="ow-main">
        <div className="ow-topbar">
          <GuardedLink href="/merchant" className="ow-topbar-brand" aria-label="Loynara – Übersicht"><BrandMark word={false} /></GuardedLink>
          <div className="ow-topbar-loc">{me ? <><strong>{me.locationName}</strong><span>{many ? "Aktiver Standort" : me.businessName}</span></> : <Skeleton height={14} width={140} />}</div>
          <Link href="/cashier" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={openCashier}><OwnerIcon name="till" size={18} />Kasse</Link>
        </div>
        {subItems.length > 1 && (
          <nav className="ow-subnav" aria-label={`${group?.label ?? "Bereich"} – Unterseiten`}>
            <div ref={subnav} className="ow-subnav-inner">
              {subItems.map(item => {
                const current = item.exactMatch ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return <GuardedLink key={item.href} href={item.href} aria-current={current ? "page" : undefined}>{item.label}</GuardedLink>;
              })}
            </div>
          </nav>
        )}
        <main id="ow-main" className="ow-content" tabIndex={-1} aria-busy={owner.switching || !me}>
          {owner.switching || !me
            ? <div className="ow-page" aria-label="Standort wird gewechselt"><Skeleton height={32} width={240} /><Skeleton height={120} /><Skeleton height={220} /></div>
            : <div key={`${me.locationId}:${owner.epoch}`} className="ow-body">{children}</div>}
        </main>
        {/* Phones and tablets: the first areas in thumb reach; „Mehr“ is the page with the rest (Einstellungen, data, sign-out). */}
        <nav className="ow-tabs" aria-label="Bereiche">
          {visibleGroups(role, hidden).slice(0, 4).map(item => (
            <GuardedLink key={item.id} href={groupHref(item, role, hidden)} className="ow-tab" aria-current={group?.id === item.id ? "page" : undefined}><OwnerIcon name={item.icon} />{TAB_LABELS[item.id] ?? groupLabel(item, hidden)}</GuardedLink>
          ))}
          <GuardedLink href={MORE_HREF} className="ow-tab" aria-current={pathname === MORE_HREF || group?.id === "settings" ? "page" : undefined}><OwnerIcon name="menu" />Mehr</GuardedLink>
        </nav>
      </div>
    </div>
  );
}

function LocationBox() {
  const owner = useOwner();
  const me = owner.me;
  if (!me) return <div className="ow-loc"><Skeleton height={44} /></div>;
  const many = owner.locations.length > 1;
  return (
    <div className="ow-loc">
      <span className="ow-loc-label" id="ow-loc-label">Aktiver Standort</span>
      {many
        ? <select aria-labelledby="ow-loc-label" value={me.locationId} disabled={owner.switching} onChange={event => owner.switchLocation(event.target.value)}>
            {owner.locations.map(location => <option key={location.id} value={location.id}>{owner.locations.filter(other => other.name === location.name).length > 1 && location.city ? `${location.name} · ${location.city}` : location.name}</option>)}
          </select>
        : <span className="ow-loc-name">{me.locationName}</span>}
      <span className="ow-loc-sub">{me.programType === "stamp" ? "Stempelkarte" : "Punktekarte"}{many ? ` · ${owner.locations.length} Standorte` : ""}</span>
      {owner.switchError && <span className="ow-error" role="alert">{owner.switchError}</span>}
    </div>
  );
}
