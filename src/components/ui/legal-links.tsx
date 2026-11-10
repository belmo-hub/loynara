"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./legal-links.module.css";

const IMPRESSUM = "https://getloynara.com/impressum/";
const PAGES = [{ href: "/datenschutz", de: "Datenschutz", fr: "Confidentialité" }, { href: "/teilnahmebedingungen", de: "Teilnahmebedingungen", fr: "Conditions de participation" }];

/**
 * The one set of legal links (G-22) on every shell: muted, centred, 44 px targets. The page the reader is on is plain
 * text with aria-current (G-M6). `newTab`: the card opens them beside itself, so the way back to the card stays (G-11).
 */
export function LegalLinks({ locale = "de", newTab = false }: { locale?: "de" | "fr"; newTab?: boolean }) {
  const path = usePathname();
  const target = newTab ? { target: "_blank", rel: "noopener" } : {};
  return <nav className={styles.legal} aria-label={locale === "fr" ? "Mentions" : "Rechtliches"}>
    {PAGES.map(page => page.href === path
      ? <span key={page.href} aria-current="page">{page[locale]}</span>
      : <Link key={page.href} href={page.href} {...target}>{page[locale]}</Link>)}
    {/* G-16, Legal 31 Oct: the operator's Impressum one tap away, linked rather than copied; the word stays German. */}
    <a href={IMPRESSUM} target="_blank" rel="noopener">Impressum</a>
  </nav>;
}

/** „Inhalt“ (G-26): one anchor per section, from the page's own list, so it is in the server HTML and nothing jumps. */
export function LegalContents({ sections }: { sections: ReadonlyArray<{ id: string; title: string }> }) {
  return <nav className={styles.contents} aria-label="Inhalt">
    <ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol>
  </nav>;
}
