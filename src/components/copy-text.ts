"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copies text from a tap or click: the Clipboard API, else a selected off-screen field and execCommand("copy"), which
 * older iOS Safari and in-app browsers still allow. Resolves false instead of throwing, so the caller can say so.
 */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); }
  catch { if (!copyBySelection(text)) return false; }
  navigator.vibrate?.(30);
  return true;
}

function copyBySelection(text: string) {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  // 16 px keeps iOS from zooming in; fixed and transparent so nothing on the page moves.
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length); // iOS selects nothing with select() alone
  try { return document.execCommand("copy"); } catch { return false; } finally { field.remove(); }
}

/** A copy button's state: `copied` stays true for 2 s after a successful copy, so the button can read „Kopiert“. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(text: string) {
    const ok = await copyText(text);
    clearTimeout(timer.current);
    setCopied(ok);
    if (ok) timer.current = setTimeout(() => setCopied(false), 2000);
    return ok;
  }
  return { copied, copy };
}
