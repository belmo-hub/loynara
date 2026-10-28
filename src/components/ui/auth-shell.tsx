import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import styles from "./auth-shell.module.css";

type Props = {
  children?: ReactNode; width?: "narrow" | "reading"; /** null: the page carries the legal links itself. */ footer?: ReactNode; brandHref?: string;
  /** The mark alone and larger, as on the sign-in (Design's screen 34). */ mark?: boolean;
};

/** Datenschutz and Teilnahmebedingungen, each a 44 px target. */
export const LegalLinks = ({ className = styles.legal }: { className?: string }) =>
  <nav aria-label="Rechtliches" className={className}><Link href="/datenschutz">Datenschutz</Link><Link href="/teilnahmebedingungen">Teilnahmebedingungen</Link></nav>;

/** Sign-in, invitation, legal and system pages: brand, one centred column, legal links. */
export function AuthShell({ children, width = "narrow", footer, brandHref, mark = false }: Props) {
  const brand = <BrandMark word={!mark} label="Loynara" />;
  return <div className={cx("ly-theme-auto", styles.shell)} data-width={width}>
    <header className={styles.header} data-mark={mark || undefined}>{brandHref ? <Link href={brandHref} className={styles.brandLink}>{brand}</Link> : brand}</header>
    <main id="inhalt" className={styles.main}>{children}</main>
    {footer !== null && <footer className={styles.footer}>{footer ?? <LegalLinks />}</footer>}
  </div>;
}
