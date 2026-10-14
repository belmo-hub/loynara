"use client";

import { useEffect, useRef, useState } from "react";
import { MailX } from "lucide-react";
import { CustomerState } from "@/components/customer/customer-state";
import styles from "@/components/customer/states.module.css";
import { Button } from "@/components/ui/button";
import { postJson } from "@/components/client-api";

export default function UnsubscribePage() {
  const token = useRef("");
  const [status, setStatus] = useState<"ready" | "busy" | "done" | "error">("ready");
  useEffect(() => {
    token.current = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  async function confirm() {
    setStatus("busy");
    try { await postJson("/api/unsubscribe", { token: token.current }); token.current = ""; setStatus("done"); }
    catch { setStatus("error"); }
  }
  return <CustomerState icon={<MailX size={22} />} title="E-Mail-Angebote abbestellen" message="Du erhältst danach keine Angebote für diese Karte per E-Mail mehr. Deine Treuekarte und eine separat bestätigte Wiederherstellungsadresse bleiben bestehen.">
    {status === "done" ? <p className={styles.status} role="status">Die Abmeldung wurde gespeichert.</p> : <Button block loading={status === "busy"} onClick={() => void confirm()}>Angebote abbestellen</Button>}
    {status === "error" && <p className={styles.error} role="alert">Der Link konnte nicht verarbeitet werden. Bitte prüfe die Nachricht und versuche es erneut.</p>}
  </CustomerState>;
}
