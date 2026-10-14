import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import styles from "./auth-shell.module.css";

type Props = { children?: ReactNode; width?: "narrow" | "reading"; footer?: ReactNode; brandHref?: string };

/** Sign-in, invitation, legal and system pages: brand, one centred column, legal links. */
export function AuthShell({ children, width = "narrow", footer, brandHref }: Props) {
  const brand = <BrandMark label="Loynara" />;
  return <div className={cx("ly-theme-auto", styles.shell)} data-width={width}>
    <header className={styles.header}>{brandHref ? <Link href={brandHref} className={styles.brandLink}>{brand}</Link> : brand}</header>
    <main id="inhalt" className={styles.main}>{children}</main>
    <footer className={styles.footer}>{footer ?? <nav aria-label="Rechtliches" className={styles.legal}><Link href="/datenschutz">Datenschutz</Link><Link href="/teilnahmebedingungen">Teilnahmebedingungen</Link></nav>}</footer>
  </div>;
}
