"use client";

import { ViewTransition, type ReactNode } from "react";
import { kasseSheetEntered } from "@/components/cashier/kasse-sheet";

/** The Kasse's frame: from the owner's link (type kasse-sheet) it enters as the sheet; it mounts once per visit. */
export function KasseSheetFrame({ className, children }: { className: string; children: ReactNode }) {
  return <ViewTransition enter={{ "kasse-sheet": "kasse-sheet", default: "none" }} exit="none" default="none" onEnter={kasseSheetEntered}>
    <div className={className}>{children}</div>
  </ViewTransition>;
}
