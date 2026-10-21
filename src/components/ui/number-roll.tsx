"use client";

import { useState, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./number-roll.module.css";

/**
 * A number that rolls in when it changes (stamps, points, owner tiles). The first value shows still; every later one
 * re-mounts and rises into place in 220 ms, readable throughout (DESIGN.md: facts never move in ways that hide them).
 */
export function NumberRoll({ value, children, className }: { value: number; children?: ReactNode; className?: string }) {
  const [initial] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && value !== initial) setChanged(true);
  return <span key={value} className={cx(styles.num, changed && styles.roll, className)}>{children ?? value}</span>;
}
