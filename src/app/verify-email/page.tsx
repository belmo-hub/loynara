"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { MailCheck } from "lucide-react";
import { CustomerState } from "@/components/customer/customer-state";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"ready" | "checking" | "verified" | "invalid">("ready");
  // Only a confirmation that failed during this visit is an error; a link without a token is just explained.
  const [attempted, setAttempted] = useState(false);
  const token = useRef("");
  const captured = useRef(false);
  const generation = useRef(0);

  // Scrubbing must survive strict effects and allow a later email link in the same tab.
  useEffect(() => {
    function capture() {
      const next = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      if (!next && captured.current) return;
      captured.current = true;
      token.current = next;
      generation.current += 1;
      window.history.replaceState(null, "", window.location.pathname);
      setState(next ? "ready" : "invalid");
    }
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);

  async function confirm() {
    if (!token.current) { setState("invalid"); return; }
    const submitted = generation.current, proof = token.current;
    setAttempted(true);
    setState("checking");
    try {
      await postJson<{ verified: true }>("/api/contact/verify", { token: proof });
      if (generation.current === submitted) setState("verified");
    } catch { if (generation.current === submitted) setState("invalid"); }
    finally { if (generation.current === submitted) token.current = ""; }
  }

  const title = state === "checking" ? "E-Mail wird bestätigt …" : state === "verified" ? "E-Mail bestätigt." : state === "invalid" ? "Bestätigungslink ungültig." : "E-Mail-Adresse bestätigen";
  const message = state === "checking" ? "Bitte warte, während wir den einmaligen Link prüfen." : state === "verified" ? "Deine E-Mail-Adresse ist jetzt als Wiederherstellungsmethode bestätigt. Marketing-E-Mails bleiben aus, bis du sie auf deiner Karte ausdrücklich aktivierst." : state === "invalid" ? "Der Link ist abgelaufen, wurde bereits genutzt oder gehört nicht mehr zur aktuellen Adresse. Öffne deine Karte und fordere bei Bedarf einen neuen Link an." : "Bestätige diese Adresse nur, wenn du sie selbst als Wiederherstellungsmethode für deine Loynara-Karte angefordert hast.";
  return <CustomerState icon={<MailCheck size={22} />} title={title} message={message} tone={state === "invalid" && attempted ? "error" : "info"} focusTitle={attempted && (state === "verified" || state === "invalid")}>
    {state === "ready" || state === "checking" ? <Button block loading={state === "checking"} onClick={() => void confirm()}>E-Mail-Adresse bestätigen</Button> : null}
  </CustomerState>;
}
