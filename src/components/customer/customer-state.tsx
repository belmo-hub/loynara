"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { CustomerShell } from "@/components/ui/customer-shell";
import { Skeleton } from "@/components/ui/skeleton";
import styles from "./customer-state.module.css";

type Props = { title: ReactNode; message?: ReactNode; tone?: "info" | "error"; icon?: ReactNode; locale?: "de" | "fr"; brandColor?: string | null; children?: ReactNode;
  /** Move focus to the title on mount, so a screen reader announces a state the page changed into (closed, gone). */
  focusTitle?: boolean };

/** One calm screen for a guest-facing state (loading, closed card, invalid link, confirmation). */
export function CustomerState({ title, message, tone = "info", icon, locale = "de", brandColor, children, focusTitle = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusTitle) heading.current?.focus(); }, [focusTitle]);
  return <CustomerShell brandColor={brandColor} locale={locale} footer={<LegalLinks locale={locale} />}>
    <section className={`card-state-page ${styles.state}`}>
      {icon ? <span className={styles.icon} data-tone={tone} aria-hidden="true">{icon}</span> : null}
      <h1 ref={heading} tabIndex={-1} className={styles.title}>{title}</h1>
      {message ? <p className={styles.message} role={tone === "error" ? "alert" : undefined}>{message}</p> : null}
      {children ? <div className={styles.body}>{children}</div> : null}
    </section>
  </CustomerShell>;
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

export function LegalLinks({ locale }: { locale: "de" | "fr" }) {
  return <nav className={styles.legal} aria-label={locale === "fr" ? "Mentions" : "Rechtliches"}>
    <Link href="/datenschutz">{locale === "fr" ? "Confidentialité" : "Datenschutz"}</Link>
    <Link href="/teilnahmebedingungen">{locale === "fr" ? "Conditions de participation" : "Teilnahmebedingungen"}</Link>
  </nav>;
}
