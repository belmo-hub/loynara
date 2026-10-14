"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export type ProgramType = "stamps" | "points";
export type UiLocale = "de" | "fr";

type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "download"
  | "mail"
  | "menu"
  | "scan"
  | "shield"
  | "spark"
  | "stamp"
  | "wallet";

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m4 11 5 5L20 5" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    scan: <><path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M15 4h4a1 1 0 0 1 1 1v4" /><path d="M20 15v4a1 1 0 0 1-1 1h-4" /><path d="M9 20H5a1 1 0 0 1-1-1v-4" /><path d="M4 12h16" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" /><path d="m19 17 .5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5L19 17Z" /></>,
    stamp: <><circle cx="12" cy="8" r="4" /><path d="M8 12c-1 1.5-1 3-1 4h10c0-1 0-2.5-1-4" /><path d="M5 20h14" /></>,
    wallet: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 9V6a3 3 0 0 1 3-3h12" /><path d="M17 14h.01" /></>,
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup" aria-label="Loynara">
      <BrandIcon className="brand-symbol" />
      {!compact && <span className="brand-word">Loynara</span>}
    </span>
  );
}

export function BrandIcon({ className = "", inverse = false }: { className?: string; inverse?: boolean }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="17" fill={inverse ? "#f5efdf" : "#16473f"} /><path d="M17 16v33h30" fill="none" stroke={inverse ? "#16473f" : "#f5efdf"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="45" cy="21" r="6" fill="#f2a078" /></svg>;
}

export function SectionHeading({ eyebrow, title, children, centered = false }: { eyebrow: string; title: string; children?: ReactNode; centered?: boolean }) {
  return <div className={`section-heading${centered ? " section-heading--center" : ""}`}><span className="eyebrow"><span className="eyebrow-dot" />{eyebrow}</span><h2>{title}</h2>{children && <p>{children}</p>}</div>;
}

export type DemoRequestInput = { name: string; business: string; email: string; city: string; website?: string };

export function DemoRequestForm({ endpoint = "/api/demo-request" }: { endpoint?: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Die Anfrage konnte nicht gespeichert werden.");
      setStatus("success");
      setMessage(result?.message || "Danke! Deine Anfrage wurde gespeichert.");
      form.reset();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Bitte versuche es erneut.");
    }
  }

  return <form className="demo-form" onSubmit={submit}>
    <div className="form-row">
      <label>Dein Name<input name="name" autoComplete="name" required maxLength={100} placeholder="Vor- und Nachname" /></label>
      <label>Geschäft<input name="business" autoComplete="organization" required maxLength={120} placeholder="Name deines Geschäfts" /></label>
    </div>
    <div className="form-row">
      <label>E-Mail-Adresse<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="du@geschaeft.de" /></label>
      <label>Stadt<input name="city" autoComplete="address-level2" required maxLength={100} placeholder="Zum Beispiel Kassel" /></label>
    </div>
    <div className="honeypot" aria-hidden="true"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
    <p className="form-note">Wir nutzen deine Angaben nur, um auf deine Demo-Anfrage zu antworten. Es wird nichts automatisch versendet.</p>
    <div className="form-submit-row"><button className="button button--ink" type="submit" disabled={status === "sending"}>{status === "sending" ? "Wird gespeichert …" : "Demo anfragen"}<Icon name="arrow" size={18} /></button><span className="form-response" role="status" aria-live="polite" data-state={status}>{message}</span></div>
  </form>;
}
