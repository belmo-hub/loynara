"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

function sameOrigin() {
  try { return document.referrer !== "" && new URL(document.referrer).origin === window.location.origin; } catch { return false; }
}

/** „Zurück“ on a legal page, only when the reader came from this app (G-11): the brand no longer leads to the sign-in. */
export function LegalBack() {
  const shown = useSyncExternalStore(() => () => undefined, sameOrigin, () => false);
  if (!shown) return null;
  return <button type="button" className={styles.back} onClick={() => history.back()}><ChevronLeft size={16} aria-hidden="true" />Zurück</button>;
}

/** „Inhalt“: one anchor per section heading of the surrounding article, read from the page itself (G-26). */
export function LegalContents() {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    const headings = [...(ref.current?.closest("article")?.querySelectorAll("h2") ?? [])];
    setItems(headings.map((heading, index) => {
      heading.id ||= `abschnitt-${index + 1}`;
      return { id: heading.id, title: heading.textContent ?? "" };
    }));
  }, []);
  return <nav ref={ref} className={styles.contents} aria-label="Inhalt" hidden={!items.length}>
    <ol>{items.map(item => <li key={item.id}><a href={`#${item.id}`}>{item.title}</a></li>)}</ol>
  </nav>;
}
