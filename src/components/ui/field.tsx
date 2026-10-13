import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./field.module.css";

type Frame = { label: ReactNode; hint?: ReactNode; error?: ReactNode; id?: string; className?: string };

/** Ids and ARIA wiring shared by every labelled control. */
export function useFieldIds(id: string | undefined, hint: unknown, error: unknown) {
  const auto = useId();
  const base = id ?? auto;
  const describedBy = [hint ? `${base}-hint` : null, error ? `${base}-error` : null].filter(Boolean).join(" ") || undefined;
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error`, describedBy, invalid: error ? true : undefined };
}

export function FieldFrame({ id, label, hint, error, hintId, errorId, className, children }: Frame & { id: string; hintId: string; errorId: string; children: ReactNode }) {
  return <div className={cx(styles.field, className)}>
    <label htmlFor={id} className={styles.label}>{label}</label>
    {children}
    {hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
    {error ? <p id={errorId} className={styles.error} aria-live="polite">{error}</p> : null}
  </div>;
}

export function TextField({ label, hint, error, id, className, ...input }: Frame & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds(id, hint, error);
  return <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
    <input id={ids.id} className={styles.input} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} {...input} />
  </FieldFrame>;
}

export function TextArea({ label, hint, error, id, className, ...area }: Frame & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ids = useFieldIds(id, hint, error);
  return <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
    <textarea id={ids.id} className={cx(styles.input, styles.area)} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} {...area} />
  </FieldFrame>;
}
