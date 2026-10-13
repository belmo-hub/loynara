import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { FieldFrame, useFieldIds } from "./field";
import styles from "./select.module.css";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode; children?: ReactNode };

/** Native select (best on phones) with the field frame and a decorative chevron. */
export function Select({ label, hint, error, id, className, children, ...select }: Props) {
  const ids = useFieldIds(id, hint, error);
  return <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
    <span className={styles.wrap}>
      <select id={ids.id} className={styles.select} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} {...select}>{children}</select>
      <ChevronDown className={styles.chevron} size={18} aria-hidden="true" />
    </span>
  </FieldFrame>;
}
