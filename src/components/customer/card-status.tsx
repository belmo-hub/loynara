"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// The guest card page holds one status region at a time (DESIGN.md: one role="status" per guest page). Every panel keeps
// its own message visible beside its action, so guidance such as "check your inbox" stays on screen. Only the panel that
// spoke last marks its message as the live status; the others stay plain text. Persistent facts (referral progress) are
// never status.

const Context = createContext<{ latest: string | null; speak: (source: string) => void } | null>(null);

export function CardStatusProvider({ children }: { children: ReactNode }) {
  const [latest, speak] = useState<string | null>(null);
  const value = useMemo(() => ({ latest, speak }), [latest]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** This panel's message, whether it is the page's live status, and a setter; an empty text clears it. */
export function useCardStatus(source: string) {
  const context = useContext(Context);
  const [text, setText] = useState("");
  const speak = context?.speak;
  const announce = useCallback((next: string) => {
    setText(next);
    if (next) speak?.(source);
  }, [speak, source]);
  return { text, live: context ? context.latest === source : true, announce };
}

export function CardStatusLine({ text, live, className }: { text: string; live: boolean; className?: string }) {
  return text ? <p className={className} role={live ? "status" : undefined}>{text}</p> : null;
}
