import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./checkbox.module.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { children?: ReactNode; description?: ReactNode };

/** Checkbox whose whole row (label included) is the touch target. */
export function Checkbox({ children, description, className, ...input }: Props) {
  return <label className={cx(styles.row, className)}><input type="checkbox" className={styles.box} {...input} /><span className={styles.text}>{children}{description ? <small className={styles.description}>{description}</small> : null}</span></label>;
}
