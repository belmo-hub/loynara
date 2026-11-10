"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson } from "../client-api";
import { buttonClassName } from "../ui/button";
import styles from "./customer-flow.module.css";
import { formatWhen, type BookingView } from "./booking-format";

/** „Nächster Termin“ and „Termin buchen“ under the balance; renders nothing while the shop has booking off or the read fails. */
export function CardBooking({ token }: { token: string }) {
  const [view, setView] = useState<BookingView | null>(null);
  useEffect(() => {
    let active = true;
    void apiJson<BookingView>(`/api/card/${encodeURIComponent(token)}/booking`).then(result => { if (active) setView(result); }).catch(() => { /* the card works without booking */ });
    return () => { active = false; };
  }, [token]);
  if (!view?.enabled) return null;
  const next = view.upcoming[0];
  return <section className={`card-booking ${styles.panel}`} aria-label="Termine">
    {next ? <p className="card-booking-next"><strong>Nächster Termin:</strong> {formatWhen(next.start, view.shop.timezone)}, {next.service.name} bei {next.staff.name}{next.status === "requested" ? " (angefragt)" : ""}</p> : null}
    <Link href={`/card/${encodeURIComponent(token)}/termin`} className={buttonClassName({ block: true })}>Termin buchen</Link>
  </section>;
}
