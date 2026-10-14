import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "go";
export type ButtonSize = "sm" | "md" | "lg" | "xl";
type Look = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean };

/** Class list for anything that should look like a button (also used for links). */
export function buttonClassName({ variant = "primary", size = "md", block = false }: Look = {}, extra?: string) {
  return cx(styles.button, styles[variant], styles[size], block && styles.block, extra);
}

/** A loading button ignores presses; server-rendered buttons get no handler at all. */
const swallowClick = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();

type Props = ButtonHTMLAttributes<HTMLButtonElement> & Look & { loading?: boolean; icon?: ReactNode };

/** While `loading`, the button stays focusable (aria-disabled) so keyboard and screen-reader users keep their place. */
export function Button({ variant, size, block, loading = false, icon, type = "button", className, disabled, onClick, children, ...rest }: Props) {
  return <button type={type} className={buttonClassName({ variant, size, block }, className)} disabled={disabled} aria-disabled={loading || undefined} aria-busy={loading || undefined}
    onClick={loading ? swallowClick : onClick} {...rest}>
    {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
    <span className={styles.label}>{children}</span>
    {loading ? <span className={styles.progress} aria-hidden="true" /> : null}
  </button>;
}
