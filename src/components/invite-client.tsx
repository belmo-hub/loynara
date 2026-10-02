"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "./client-api";
import { BrandMark, Icon } from "./loyalty-ui";

export function InviteClient({ token, registrationOpen = true }: { token: string; registrationOpen?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true); setError("");
    try { await postJson("/api/staff/accept", { token }); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Einladung konnte nicht angenommen werden."); }
    finally { setBusy(false); }
  }

  return <main className="invite-page"><div className="invite-card"><Link href="/"><BrandMark /></Link><span className="eyebrow"><span className="eyebrow-dot" /> TEAMEINLADUNG</span><h1>{done ? "Willkommen im Team." : "Dein Zugang zum Tresen."}</h1><p>{done ? "Dein Teamzugang ist aktiv. Du kannst dich zur Kassenansicht begeben." : "Melde dich mit genau der E-Mail-Adresse an, an die diese Einladung adressiert wurde. Danach kannst du sie hier annehmen."}</p>{error && <p className="auth-error" role="alert">{error}</p>}{done ? <Link href="/cashier" className="button button--ink">Zur Kasse <Icon name="arrow" size={17} /></Link> : <><button type="button" className="button button--ink" onClick={accept} disabled={busy}>{busy ? "Einladung wird geprüft …" : "Einladung annehmen"}<Icon name="arrow" size={17} /></button><div className="invite-links"><Link href="/login">Einloggen</Link>{registrationOpen && <Link href="/register">Konto erstellen</Link>}</div></>}</div></main>;
}
