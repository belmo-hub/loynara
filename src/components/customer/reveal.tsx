"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./motion.module.css";

/** The closing collapse (160 ms, as in motion.module.css) and a little room. */
const LEAVE_MS = 200;

/**
 * A block that opens and closes in place (DESIGN.md: Disclosure, Row add / remove). It stays mounted while it closes,
 * so pass the same children until then. `gap`: the gap of the grid it stands in.
 */
export function Reveal({ open, gap, children }: { open: boolean; gap?: string; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setShown(false), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [open]);
  if (!shown) return null;
  return <div className={styles.reveal} data-open={open || undefined} style={gap ? { "--reveal-gap": gap } as CSSProperties : undefined}><div>{children}</div></div>;
}
