"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { LegalLinks } from "@/components/ui/legal-links";
import { CustomerShell } from "@/components/ui/customer-shell";
import { Skeleton } from "@/components/ui/skeleton";
import styles from "./customer-state.module.css";

type Props = { title: ReactNode; message?: ReactNode; tone?: "info" | "error"; icon?: ReactNode; locale?: "de" | "fr"; brandColor?: string | null; children?: ReactNode;
  /** The shop, when the page knows it: its header replaces the Loynara mark. */
  merchant?: string;
  /** Announce the message politely when it changes (the tap page's waiting and booked states). */
  live?: boolean;
  /** Move focus to the title on mount, so a screen reader announces a state the page changed into (closed, gone). */
  focusTitle?: boolean };

/**
 * One guest state screen (mock 29, G-07): the shop's header (or the Loynara mark), the heading on the grey, a muted
 * line, then the actions. An error carries a danger icon tile above the heading. Titles take no trailing full stop
 * (PR-CHECKLIST §4, mock 29).
 */
export function CustomerState({ title, message, tone = "info", icon, locale = "de", brandColor, merchant, live = false, children, focusTitle = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusTitle) heading.current?.focus(); }, [focusTitle]);
  return <CustomerShell brandColor={brandColor} locale={locale} header={merchant ? <MerchantHeader name={merchant} locale={locale} /> : <BrandMark label="Loynara" />} footer={<LegalLinks locale={locale} />}>
    <section className={`card-state-page ${styles.state}`} data-tone={tone}>
      {/* The tile marks an error before a word is read (G-07); other states carry no decorative icon. */}
      {icon && tone === "error" ? <span className={styles.icon} data-tone={tone} aria-hidden="true">{icon}</span> : null}
      <h1 ref={heading} tabIndex={-1} className={styles.title}>{title}</h1>
      {message ? <p key={tone} className={styles.message} role={tone === "error" ? "alert" : live ? "status" : undefined} aria-live={live && tone !== "error" ? "polite" : undefined}>{message}</p> : null}
      {children ? <div className={styles.body}>{children}</div> : null}
    </section>
  </CustomerShell>;
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

/** Placeholder in the shape of the card, so nothing jumps when the balance arrives. */
export function CustomerCardLoading({ label }: { label: string }) {
  return <CustomerShell footer={<LegalLinks locale="de" />}>
    <div className={styles.loading} aria-busy="true" aria-label={label}>
      <Skeleton height={56} width="70%" radius={12} />
      <Skeleton height={34} width="85%" />
      <Skeleton height={240} radius={28} />
      <Skeleton height={300} radius={20} />
    </div>
    <h1 className={styles.hidden}>{label}</h1>
  </CustomerShell>;
}

