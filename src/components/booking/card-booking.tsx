"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson } from "../client-api";
import { buttonClassName } from "../ui/button";
import styles from "./customer-flow.module.css";
import mix from "../ui/mix.module.css";
import { formatWhen, type BookingView } from "./booking-format";
import { Reveal } from "../customer/reveal";

/** „Nächster Termin“ and „Termin buchen“ under the balance; renders nothing while the shop has booking off or the read fails. */
export function CardBooking({ token }: { token: string }) {
  const [view, setView] = useState<BookingView | null>(null);
  useEffect(() => {
    let active = true;
    void apiJson<BookingView>(`/api/card/${encodeURIComponent(token)}/booking`).then(result => { if (active) setView(result); }).catch(() => { /* the card works without booking */ });
    return () => { active = false; };
  }, [token]);
  // D8 (Design, 22 Nov): it arrives in a Reveal like its sibling notices, so the card below never jumps.
  const enabled = view?.enabled ? view : null;
  const next = enabled?.upcoming[0];
  const full = enabled ? enabled.upcoming.length >= enabled.shop.maxOpenPerCard : false;
  return <Reveal open={Boolean(enabled)} gap="var(--space-4)">{enabled ? <section className={`card-booking ${mix.panel} ${mix.pad}`} aria-label="Termine">
    {next ? <p className="card-booking-next"><strong>Nächster Termin:</strong> {formatWhen(next.start, enabled.shop.timezone)}, {next.service.name} bei {next.staff.name}{next.status === "requested" ? " (angefragt)" : ""}</p> : null}
    {/* At the open-appointment limit the entry leads to the appointments, not to a booking that would fail. */}
    <Link href={`/card/${encodeURIComponent(token)}/termin`} className={buttonClassName({ block: true, variant: full ? "secondary" : undefined })}>{full ? "Meine Termine" : "Termin buchen"}</Link>
  </section> : null}</Reveal>;
}
