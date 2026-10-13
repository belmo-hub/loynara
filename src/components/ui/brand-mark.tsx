import styles from "./brand-mark.module.css";

/** Loynara mark (the confirmed stamp) with an optional word mark. Decorative unless `label` is given. */
export function BrandMark({ word = true, label }: { word?: boolean; label?: string }) {
  return <span className={styles.lockup} aria-label={label} role={label ? "img" : undefined}>
    <svg className={styles.symbol} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="17" fill="#16473F" /><path d="M17 16v33h30" fill="none" stroke="#F5EFDF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="45" cy="21" r="6" fill="#F2A078" /></svg>
    {word ? <span className={styles.word} aria-hidden={label ? "true" : undefined}>Loynara</span> : null}
  </span>;
}
