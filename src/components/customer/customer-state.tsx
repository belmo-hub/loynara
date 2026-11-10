"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { LegalLinks } from "@/components/ui/legal-links";
import { CustomerShell } from "@/components/ui/customer-shell";
import styles from "./customer-state.module.css";

type Props = { title: ReactNode; message?: ReactNode; tone?: "info" | "error"; icon?: ReactNode; locale?: "de" | "fr"; brandColor?: string | null; children?: ReactNode;
  /** The shop, when the page knows it: its header replaces the Loynara mark. */
  merchant?: string;
  /** Announce the message politely when it changes (the tap page's waiting and booked states). */
  live?: boolean;
  /** Move focus to the title on mount, so a screen reader announces a state the page changed into (closed, gone). */
  focusTitle?: boolean;
  /** The page is still asking: the words show only once that has taken 300 ms, so a quick answer never flashes them. */
  loading?: boolean };

/**
 * One guest state screen (mock 29, G-07): the shop's header (or the Loynara mark), the heading on the grey, a muted
 * line, then the actions. An error carries a danger icon tile above the heading. Titles follow Marketing's rule
 * (PR-CHECKLIST §4): a state or result takes no full stop („Abgemeldet“), a headline written as a sentence keeps it.
 */
export function CustomerState({ title, message, tone = "info", icon, locale = "de", brandColor, merchant, live = false, children, focusTitle = false, loading = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusTitle) heading.current?.focus(); }, [focusTitle]);
  // A page that stays on this screen and changes its state (the tap page) is told apart by its title.
  const state = typeof title === "string" ? title : "";
  return <CustomerShell brandColor={brandColor} locale={locale} header={merchant ? <MerchantHeader name={merchant} locale={locale} /> : <BrandMark label="Loynara" />} footer={<LegalLinks locale={locale} />}>
    <section className={`card-state-page ${styles.state}`} data-tone={tone} data-loading={loading || undefined}>
      {/* The tile marks an error before a word is read (G-07); other states carry no decorative icon. */}
      {icon && tone === "error" ? <span className={styles.icon} data-tone={tone} aria-hidden="true">{icon}</span> : null}
      <h1 ref={heading} tabIndex={-1} className={styles.title}><Swap key={String(loading)} id={state}>{title}</Swap></h1>
      {message ? <p key={tone} className={styles.message} role={tone === "error" ? "alert" : live ? "status" : undefined} aria-live={live && tone !== "error" ? "polite" : undefined}><Swap key={String(loading)} id={state}>{message}</Swap></p> : null}
      {children ? <div className={styles.body}>{children}</div> : null}
    </section>
  </CustomerShell>;
}

/**
 * Screen change, in place: words that change where they stand. The old ones leave the layout at once and fade out
 * over the new ones, which fade in after them. The first state is plain text, as the server sent it. The screen keys
 * it by its `loading`, so the first real state follows the waiting words by arriving, never by fading them out.
 */
function Swap({ id, children }: { id: string; children: ReactNode }) {
  const [first] = useState(id);
  const [shown, setShown] = useState({ id, children });
  const [old, setOld] = useState<{ id: string; children: ReactNode } | null>(null);
  if (id !== shown.id) { setOld(shown); setShown({ id, children }); }
  if (!old && id === first) return children;
  return <span className={styles.swap}>
    {old ? <span key={old.id} className={styles.out} aria-hidden="true" onAnimationEnd={() => setOld(null)}>{old.children}</span> : null}
    <span key={id} className={id === first ? undefined : styles.in}>{children}</span>
  </span>;
}

/** The shop's monogram tile, its name and „Deine Treuekarte“, as on the card. */
export function MerchantHeader({ name, locale = "de" }: { name: string; locale?: "de" | "fr" }) {
  return <div className={styles.merchant}>
    <span className={styles.mono} aria-hidden="true">{Array.from(name)[0]}</span>
    <p><strong>{name}</strong><span>{locale === "fr" ? "Votre carte de fidélité" : "Deine Treuekarte"}</span></p>
  </div>;
}

/** A state's action as a signpost row: white, or green when it is the screen's one next step. */
export function StateLink({ href, icon, children, primary = false, onClick }: { href: string; icon: ReactNode; children: ReactNode; primary?: boolean; onClick?: () => void }) {
  return <Link prefetch={false} href={href} className={styles.row} data-primary={primary || undefined} onClick={onClick}>
    <span className={styles.rowIcon} aria-hidden="true">{icon}</span>
    <span className={styles.rowText}>{children}</span>
    <ArrowRight className={styles.rowArrow} size={22} aria-hidden="true" />
  </Link>;
}
