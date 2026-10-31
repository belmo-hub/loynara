import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import { LegalLinks } from "./legal-links";
import styles from "./auth-shell.module.css";

type Props = {
  children?: ReactNode; width?: "narrow" | "reading"; /** null: the page carries the legal links itself. */ footer?: ReactNode; brandHref?: string;
  /** The mark alone and larger, as on the sign-in (Design's screen 34). */ mark?: boolean;
};


/** Sign-in, invitation, legal and system pages: brand, one centred column, legal links. */
export function AuthShell({ children, width = "narrow", footer, brandHref, mark = false }: Props) {
  const brand = <BrandMark word={!mark} label="Loynara" />;
  return <div className={cx("ly-theme-auto", styles.shell)} data-width={width}>
    <header className={styles.header} data-mark={mark || undefined}>{brandHref ? <Link href={brandHref} className={styles.brandLink}>{brand}</Link> : brand}</header>
    <main id="inhalt" className={styles.main}>{children}</main>
    {footer !== null && <footer className={styles.footer}>{footer ?? <LegalLinks />}</footer>}
  </div>;
}
