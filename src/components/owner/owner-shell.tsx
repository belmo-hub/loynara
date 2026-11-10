"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, ViewTransition, type ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { activeGroup, groupHref, MORE_HREF, routeMove, visibleGroups, visibleItems } from "./nav";
import { useOwner, type OwnerLocation } from "./owner-context";
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

export function OwnerShell({ children }: { children: ReactNode }) {
  const owner = useOwner();
  const router = useRouter();
  const pathname = usePathname();
  const subnav = useRef<HTMLDivElement>(null);
  // The direction of the last screen change, for the screen transition in owner.css.
  const [trail, setTrail] = useState({ path: pathname, move: "none" });
  if (trail.path !== pathname) setTrail({ path: pathname, move: routeMove(trail.path, pathname) });

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
    return <div className="ow-bare ow-bare--setup"><div className="ow-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}><BrandMark word={false} label="Loynara" /><LogoutButton className="ow-btn ow-btn--ghost ow-btn--sm" onSignedOut={owner.resetAfterSignOut} /></div><main id="ow-main">{children}</main></div>;
  }
  if (owner.status === "ended" && owner.ended) {
    // Nothing else is offered: no navigation and no settings that could change the programme.
    return <div className="ow-bare"><div className="ow-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}><BrandMark /><LogoutButton className="ow-btn ow-btn--secondary" onSignedOut={owner.resetAfterSignOut} /></div><main id="ow-main"><ProgrammeEndedPage info={owner.ended} /></main></div>;
  }
  if (owner.status === "error") {
    return <div className="ow-page ow-page--alone" role="alert"><div className="ow-card ow-stack"><h1 style={{ fontSize: "var(--text-22)" }}>Dein Bereich ist nicht erreichbar</h1><p className="ow-muted">{owner.error}</p><div><button type="button" className="ow-btn ow-btn--primary" onClick={owner.reload}>Erneut versuchen</button></div><LogoutButton className="ow-btn ow-btn--secondary" onSignedOut={owner.resetAfterSignOut} /></div></div>;
  }

  const me = owner.me;
  const role = me?.role ?? owner.role;
  const hidden = me?.hiddenSurfaces ?? owner.hiddenSurfaces;
  const group = activeGroup(pathname, role, hidden);
  const subItems = group ? visibleItems(group, role, hidden) : [];
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
            <GuardedLink key={item.id} href={groupHref(item, role, hidden)} aria-current={group?.id === item.id ? "page" : undefined}><OwnerIcon name={item.icon} />{item.label}</GuardedLink>
          ))}
        </nav>
        <div className="ow-side-foot">
          <Link href="/cashier" className="ow-utility" onClick={openCashier}><OwnerIcon name="till" size={18} />Kasse öffnen</Link>
          {/* Who is signed in, and the rare way out: one quiet block under the daily till button (I-15, F-22). */}
          <div className="ow-side-who">
            {me && <p className="ow-who">{me.businessName}<br />{me.role === "owner" ? "Inhaber:in" : "Manager:in"}</p>}
            <LogoutButton className="ow-btn ow-btn--ghost" onSignedOut={owner.resetAfterSignOut} />
          </div>
        </div>
      </aside>
      <div className="ow-main">
        <div className="ow-topbar">
          <GuardedLink href="/merchant" className="ow-topbar-brand" aria-label="Loynara – Übersicht"><BrandMark word={false} /></GuardedLink>
          <div className="ow-topbar-loc">{me ? <><strong>{me.businessName}</strong><span>{me.locationName}</span></> : <Skeleton height={14} width={140} />}</div>
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
            : <div key={`${me.locationId}:${owner.epoch}`} className="ow-body" data-move={trail.move}><ViewTransition key={pathname} enter="ow-screen" exit="ow-screen" update="ow-screen" default="none">{children}</ViewTransition></div>}
        </main>
        {/* Phones and tablets: the first areas in thumb reach; „Mehr“ is the page with the rest (Einstellungen, data, sign-out). */}
        <nav className="ow-tabs" aria-label="Bereiche">
          {visibleGroups(role, hidden).slice(0, 4).map(item => (
            <GuardedLink key={item.id} href={groupHref(item, role, hidden)} className="ow-tab" aria-current={group?.id === item.id ? "page" : undefined}><span className="ow-tab-icon"><OwnerIcon name={item.icon} /></span><span className="ow-tab-label">{item.label}</span></GuardedLink>
          ))}
          <GuardedLink href={MORE_HREF} className="ow-tab" aria-current={pathname === MORE_HREF || group?.id === "settings" ? "page" : undefined}><span className="ow-tab-icon"><OwnerIcon name="menu" /></span><span className="ow-tab-label">Mehr</span></GuardedLink>
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
  const label = (location: OwnerLocation) => owner.locations.filter(other => other.name === location.name).length > 1 && location.city ? `${location.name} · ${location.city}` : location.name;
  const current = owner.locations.find(location => location.id === me.locationId);
  // One location is plain text, not a box: nothing to choose (I-15). Several get a labelled select.
  return (
    <div className="ow-loc">
      {many && <label className="ow-label" htmlFor="ow-loc-select">Standort</label>}
      {many
        ? <select id="ow-loc-select" className="ow-select" title={current ? label(current) : me.locationName} value={me.locationId} disabled={owner.switching} onChange={event => owner.switchLocation(event.target.value)}>
            {owner.locations.map(location => <option key={location.id} value={location.id}>{label(location)}</option>)}
          </select>
        : <span className="ow-loc-name">{me.locationName}</span>}
      <span className="ow-loc-sub">{me.programType === "stamp" ? "Stempelkarte" : "Punktekarte"}</span>
      {owner.switchError && <span className="ow-error" role="alert">{owner.switchError}</span>}
    </div>
  );
}
