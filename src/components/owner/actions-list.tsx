"use client";

import { ChartColumn, Clock, Mail, Megaphone, Star, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { MeResponse } from "@/components/client-api";
import { CAP_WINDOW_DAYS, SHOP_WEEKLY_CAP } from "@/lib/wallet-message-rules";
import type { HiddenSurfaces } from "./nav";
import { useOwner } from "./owner-context";
import { PageHead } from "./owner-ui";
import { useLoad } from "./use-load";
import { Rows, RowSection, type ValueRow } from "./value-rows";

/** The part of the wallet-message read the list needs: the rolling 7-day cap, as the message page enforces it. */
export type MessageRoom = { remaining: number; nextAllowedAt: string | null; timezone: string };

/** „30. Oktober“ in the shop's time zone (Marketing R9/R12: the owner format). */
export const ownerDay = (iso: string, timeZone: string) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone }).format(new Date(iso));

/** R9 FINAL: how many messages are free in the rolling window, or from when one is again. */
export const messageRoom = (room: MessageRoom) => room.remaining > 0
  ? `Noch ${room.remaining} frei · höchstens ${SHOP_WEEKLY_CAP} in ${CAP_WINDOW_DAYS} Tagen`
  : room.nextAllowedAt ? `Wieder möglich ab ${ownerDay(room.nextAllowedAt, room.timezone)}` : undefined;

/**
 * The day the shop may send again after using its last free message: the one message still counted in the rolling window
 * leaves it 7 days after it was sent (a message stopped before any send never counted); from 21:00 the server waits for
 * 08:00, so the day moves on (wallet-messages.ts reopensAt). Null when no counted message is in the window.
 */
export function reopenDay(history: Array<{ createdAt: string; status: string; sent: number }>, timeZone: string, now = Date.now()) {
  const window = CAP_WINDOW_DAYS * 86_400_000;
  const counted = history.filter(row => now - Date.parse(row.createdAt) < window && !(row.status === "stopped" && row.sent === 0))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!counted) return null;
  const free = new Date(Date.parse(counted.createdAt) + window);
  const hour = Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone }).formatToParts(free).find(part => part.type === "hour")?.value);
  return ownerDay(new Date(free.getTime() + (hour >= 21 ? 86_400_000 : 0)).toISOString(), timeZone);
}

/** R12 FINAL: the confirm box, with what is left after this message (`remaining` is before it). */
export const sendNote = (reach: number, remaining: number, reopen: string | null) =>
  `Die Nachricht geht sofort an ${reach} Kunden mit Apple Wallet, die Nachrichten erlaubt haben. ${remaining > 1
    ? `Danach ist noch ${remaining - 1} ${remaining - 1 === 1 ? "Nachricht" : "Nachrichten"} frei, höchstens ${SHOP_WEEKLY_CAP} in ${CAP_WINDOW_DAYS} Tagen.`
    : reopen ? `Danach ist bis ${reopen} keine Nachricht mehr frei.` : ""}`.trim();

/** Aktionen (screen 08, ENG-087's gate left open): what the owner can do for regulars, then the reports. Withheld surfaces leave no row. */
export function actionSections({ me, hidden, room }: { me: MeResponse; hidden: HiddenSurfaces; room: MessageRoom | null }) {
  const offered = (surface: HiddenSurfaces[number]) => !hidden.includes(surface);
  const regulars: ValueRow[] = [
    ...(offered("walletMessages") ? [{ key: "message", icon: Megaphone, title: "Nachricht an deine Stammkunden", sub: room ? messageRoom(room) : undefined, href: "/merchant/wallet-messages" }] : []),
    // Double points need amounts, so only points programmes have it; its page stays the Programm question (ENG-099).
    ...(me.programType === "points" ? [{ key: "happy-hour", icon: Clock, title: "Happy Hour", sub: "Doppelte Punkte zu ruhigen Zeiten", value: me.happyHourEnabled ? "An" : "Aus", off: !me.happyHourEnabled, href: "/merchant/program/happy-hour" }] : []),
    ...(offered("campaigns") ? [{ key: "campaigns", icon: Mail, title: "Kampagnen", href: "/merchant/campaigns" }] : []),
    ...(offered("automations") ? [{ key: "automations", icon: Workflow, title: "Automationen", href: "/merchant/automations" }] : []),
  ];
  return [
    ...(regulars.length ? [{ title: "Für deine Stammkunden", rows: regulars }] : []),
    { title: "Auswertung", rows: [
      { key: "results", icon: ChartColumn, title: "Ergebnisse", sub: "Karten, Buchungen und Prämien", href: "/merchant/analytics" },
      { key: "adviser", icon: Star, title: "Beratung", sub: "Hinweise aus deinen Buchungen", href: "/merchant/adviser" },
    ] },
  ];
}

export function ActionsList() {
  const { me, hiddenSurfaces } = useOwner();
  const router = useRouter();
  const owner = me?.role === "owner";
  const messages = owner && me.programSlug && !hiddenSurfaces.includes("walletMessages");
  const [wallet] = useLoad<MessageRoom>(messages ? `/api/merchant/wallet-messages?programSlug=${encodeURIComponent(me.programSlug)}` : null);
  // The area is the owner's (nav.ts); a manager who opens the address lands on the Übersicht.
  useEffect(() => { if (me && !owner) router.replace("/merchant"); }, [me, owner, router]);
  if (!me || !owner) return null;
  return (
    <div className="ow-page ow-results">
      <PageHead title="Aktionen" />
      {actionSections({ me, hidden: hiddenSurfaces, room: wallet.state === "ok" ? wallet.data : null }).map(section =>
        <RowSection key={section.title} title={section.title}><Rows rows={section.rows} /></RowSection>)}
    </div>
  );
}
