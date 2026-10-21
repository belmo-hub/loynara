"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { activeGroup, groupHref, groupLabel, visibleGroups, visibleItems } from "./nav";
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
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname; // a new route closes the drawer without an effect
  const setOpen = (value: boolean) => setOpenAt(value ? pathname : null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const side = useRef<HTMLElement>(null);
  const restoreMenuFocus = useRef(false);

  useEffect(() => {
    if (!open) {
      if (restoreMenuFocus.current) {
        restoreMenuFocus.current = false;
        // The close has committed, so the trigger is no longer inside inert content.
        menuButton.current?.focus();
      }
      return;
    }
    side.current?.querySelector<HTMLElement>("a, select")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { restoreMenuFocus.current = true; setOpenAt(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (owner.status === "unprovisioned") {
    return <div className="ow-bare"><div className="ow-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}><BrandMark /><LogoutButton className="ow-btn ow-btn--secondary" onSignedOut={owner.resetAfterSignOut} /></div><main id="ow-main">{children}</main></div>;
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
      <aside ref={side} className="ow-side" data-open={open} aria-label="Bereichsnavigation">
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
      {open && <div className="ow-scrim" onClick={() => { restoreMenuFocus.current = true; setOpen(false); }} aria-hidden="true" />}
      <div className="ow-main" {...(open ? { inert: true } : {})}>
        <div className="ow-topbar">
          <GuardedLink href="/merchant" className="ow-topbar-brand" aria-label="Loynara – Übersicht"><BrandMark word={false} /></GuardedLink>
          <div className="ow-topbar-loc">{me ? <><strong>{me.locationName}</strong><span>{many ? "Aktiver Standort" : me.businessName}</span></> : <Skeleton height={14} width={140} />}</div>
          <Link href="/cashier" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={openCashier}><OwnerIcon name="till" size={18} />Kasse</Link>
        </div>
        {subItems.length > 1 && (
          <nav className="ow-subnav" aria-label={`${group?.label ?? "Bereich"} – Unterseiten`}>
            <div className="ow-subnav-inner">
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
        {/* Phones and tablets: the first areas in thumb reach; "Mehr" opens the full navigation panel. */}
        <nav className="ow-tabs" aria-label="Bereiche">
          {visibleGroups(role, hidden).slice(0, 4).map(item => (
            <GuardedLink key={item.id} href={groupHref(item, role, hidden)} className="ow-tab" aria-current={group?.id === item.id ? "page" : undefined}><OwnerIcon name={item.icon} />{TAB_LABELS[item.id] ?? groupLabel(item, hidden)}</GuardedLink>
          ))}
          <button ref={menuButton} type="button" className="ow-tab" aria-label="Mehr: Navigation öffnen" aria-expanded={open} onClick={() => setOpen(true)}><OwnerIcon name="menu" />Mehr</button>
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
