"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type TableHTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./table.module.css";

/** Container for wide tables; becomes a keyboard-scrollable region only while its content overflows. */
export function TableScroll({ label, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} role={overflows ? "region" : undefined} aria-label={overflows ? label : undefined} tabIndex={overflows ? 0 : undefined} className={cx(styles.scroll, className)} {...rest}>{children}</div>;
}

type Props = TableHTMLAttributes<HTMLTableElement> & { caption: ReactNode; captionHidden?: boolean; stack?: boolean };

/** Semantic table with a sticky header. With `stack`, rows become labelled cards below 700 px (cells need data-label). */
export function Table({ caption, captionHidden = true, stack = false, className, children, ...rest }: Props) {
  return <table className={cx(styles.table, className)} data-stack={stack || undefined} {...rest}>
    <caption className={captionHidden ? styles.hidden : styles.caption}>{caption}</caption>
    {children}
  </table>;
}
