import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { merchantPalette } from "./merchant-color";
import { ToastProvider } from "./toast";
import styles from "./customer-shell.module.css";

type Props = { brandColor?: string | null; locale?: "de" | "fr"; header?: ReactNode; footer?: ReactNode; children?: ReactNode; className?: string;
  /** Two columns from 960 px (the card page): main holds a lead column and a rest column. */
  wide?: boolean;
  /** The placeholder the page showed before its data came, in the same frame: it lies over the content and fades away
   *  (DESIGN.md, "Skeleton to content"). Never a target; the page takes it away once it has gone. */
  cover?: { header?: ReactNode; main: ReactNode } };

/** Frame for every guest page: one column, safe areas, the shop's colour with guaranteed contrast, system theme. */
export function CustomerShell({ brandColor, locale = "de", header, footer, children, className, wide = false, cover }: Props) {
  const light = merchantPalette(brandColor ?? "", "light");
  const dark = merchantPalette(brandColor ?? "", "dark");
  // --merchant-text differs per theme, so the CSS picks the light or dark value (see customer-shell.module.css).
  const shared = Object.fromEntries(Object.entries(light.cssVars).filter(([name]) => name !== "--merchant-text"));
  const style = { ...shared, "--merchant-text-light": light.merchantText, "--merchant-text-dark": dark.merchantText } as CSSProperties;
  return <div className={cx("ly-theme-auto", styles.shell, className)} style={style} lang={locale} data-wide={wide || undefined}>
    <ToastProvider closeLabel={locale === "fr" ? "Fermer la notification" : "Hinweis schließen"}>
      {header ? <header className={styles.header}>{header}</header> : null}
      <main id="inhalt" className={styles.main}>{children}</main>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      {cover ? <div className={styles.cover} aria-hidden="true">{cover.header ? <div className={styles.header}>{cover.header}</div> : null}<div className={styles.main}>{cover.main}</div></div> : null}
    </ToastProvider>
  </div>;
}
