"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/loyalty-ui";
import { postJson } from "@/components/client-api";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ message: string }>("/api/recover", { email });
      setMessage(result.message);
      setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Anfrage fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  return <main className="card-state-page"><div><BrandMark /><h1>Karte wiederfinden</h1>
    <p>Gib die E-Mail-Adresse ein, die du zuvor auf deiner Karte bestätigt hast. Ohne bestätigte E-Mail ist ein verlorener Kartenlink derzeit nicht wiederherstellbar.</p>
    <form className="recovery-form" onSubmit={submit}><label htmlFor="recovery-email">Bestätigte E-Mail-Adresse</label><input id="recovery-email" type="email" required autoComplete="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /><button className="button" disabled={busy} type="submit">{busy ? "Wird geprüft …" : "Link anfordern"}</button></form>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}<Link href="/">Zur Startseite</Link>
  </div></main>;
}
