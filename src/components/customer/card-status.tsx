"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// The guest card page shows one status message at a time (DESIGN.md: one role="status" per guest page). Each panel
// shows its message where its action is, but only the most recent one is rendered, so screen readers hear one
// announcement and specs find one status region. Persistent facts (referral progress) are plain text, not status.

type Message = { source: string; text: string };
const Context = createContext<{ message: Message | null; announce: (source: string, text: string) => void } | null>(null);

export function CardStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message | null>(null);
  const announce = useCallback((source: string, text: string) => setMessage(text ? { source, text } : null), []);
  const value = useMemo(() => ({ message, announce }), [message, announce]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** `text` is this panel's current message (empty when another panel spoke last); `announce("")` clears it. */
export function useCardStatus(source: string) {
  const context = useContext(Context);
  const [local, setLocal] = useState("");
  const announce = useCallback((text: string) => { if (context) context.announce(source, text); else setLocal(text); }, [context, source]);
  const text = context ? context.message?.source === source ? context.message.text : "" : local;
  return { text, announce };
}

export function CardStatusLine({ text, className }: { text: string; className?: string }) {
  return text ? <p className={className} role="status">{text}</p> : null;
}
