"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./tabs.module.css";

type Option<T extends string> = { value: T; label: ReactNode };

/** Small set of mutually exclusive views or ranges (30 / 90 Tage, Bearbeiten / Vorschau). */
export function Segmented<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (value: T) => void; options: Array<Option<T>>; className?: string }) {
  return <div role="group" aria-label={label} className={cx(styles.segmented, className)}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={option.value === value} className={styles.segment} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

/** Links between sibling pages, shown as tabs. */
export function TabNav({ label, items, className }: { label: string; items: Array<{ href: string; label: ReactNode; current?: boolean }>; className?: string }) {
  return <nav aria-label={label} className={cx(styles.tabnav, className)}>
    {items.map((item) => <Link key={item.href} href={item.href} className={styles.tab} aria-current={item.current ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}
