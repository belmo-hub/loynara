"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/loyalty-ui";
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
  return <main className="card-state-page"><div><BrandMark /><h1>E-Mail-Angebote abbestellen</h1>
    <p>Du erhältst danach keine Angebote für diese Karte per E-Mail mehr. Deine Treuekarte und eine separat bestätigte Wiederherstellungsadresse bleiben bestehen.</p>
    {status === "done" ? <p role="status">Die Abmeldung wurde gespeichert.</p> : <button className="button" disabled={status === "busy"} onClick={() => void confirm()}>Angebote abbestellen</button>}
    {status === "error" && <p role="alert">Der Link konnte nicht verarbeitet werden. Bitte prüfe die Nachricht und versuche es erneut.</p>}
  </div></main>;
}
