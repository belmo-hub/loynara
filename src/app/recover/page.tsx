"use client";

import { useState, type FormEvent } from "react";
import { MailSearch } from "lucide-react";
import { CustomerState } from "@/components/customer/customer-state";
import styles from "@/components/customer/states.module.css";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { postJson } from "@/components/client-api";
import { recoveryRequestFeedback } from "@/components/recovery-request-feedback";

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
    } catch (cause) { setError(recoveryRequestFeedback(cause)); }
    finally { setBusy(false); }
  }
  return <CustomerState icon={<MailSearch size={22} />} title="Karte wiederfinden" message="Gib die E-Mail-Adresse ein, die du auf deiner Karte bestätigt hast. Wir schicken dir einen Link, mit dem du die Karte auf diesem Gerät wieder öffnest. Ohne bestätigte Adresse hilft dir das Geschäft nach einer Prüfung mit einem neuen Kartenlink.">
    <form className={styles.form} onSubmit={submit}>
      <TextField id="recovery-email" label="Bestätigte E-Mail-Adresse" type="email" required autoComplete="email" inputMode="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} />
      <Button type="submit" block loading={busy}>{busy ? "Wird geprüft …" : "Link anfordern"}</Button>
    </form>
    {message && <p className={styles.status} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </CustomerState>;
}
