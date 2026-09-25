"use client";

import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";
import { Icon, type UiLocale } from "./loyalty-ui";

type CameraState = "starting" | "ready" | "error";

function cameraErrorMessage(cause: unknown, french: boolean): string {
  const name = cause instanceof Error ? cause.name : "";
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) {
    return french
      ? "Accès à la caméra refusé. Autorisez la caméra dans le navigateur, puis réessayez, ou saisissez le code manuellement."
      : "Kamerazugriff abgelehnt. Erlaube die Kamera im Browser und versuche es erneut, oder gib den Code manuell ein.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(name)) {
    return french
      ? "Aucune caméra n’a été trouvée. Branchez-en une ou saisissez le code manuellement."
      : "Keine Kamera gefunden. Schließe eine Kamera an oder gib den Code manuell ein.";
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) {
    return french
      ? "La caméra est occupée ou ne peut pas démarrer. Fermez les autres applications utilisant la caméra, puis réessayez."
      : "Die Kamera ist belegt oder kann nicht starten. Schließe andere Kamera-Apps und versuche es erneut.";
  }
  return french
    ? "La caméra n’a pas pu démarrer. Réessayez ou saisissez le code manuellement."
    : "Die Kamera konnte nicht gestartet werden. Versuche es erneut oder gib den Code manuell ein.";
}

function mayRetryWithoutFacingPreference(cause: unknown): boolean {
  return cause instanceof Error && ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(cause.name);
}

export function QrScanner({ onDetected, onClose, locale = "de" }: { onDetected: (text: string) => void; onClose: () => void; locale?: UiLocale }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onDetected);
  const stopRef = useRef<(() => void) | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CameraState>("starting");
  const [error, setError] = useState("");
  const french = locale === "fr";

  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    let delivered = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    const stop = () => {
      cancelled = true;
      controls?.stop();
      controls = null;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
    stopRef.current = stop;

    if (!window.isSecureContext) {
      queueMicrotask(() => {
        if (cancelled) return;
        setState("error");
        setError(french
          ? "La caméra exige une page HTTPS sécurisée ou localhost. Utilisez le code manuel ici."
          : "Die Kamera benötigt eine sichere HTTPS-Seite oder localhost. Gib den Code hier manuell ein.");
      });
    } else if (!navigator.mediaDevices?.getUserMedia || !video) {
      queueMicrotask(() => {
        if (cancelled) return;
        setState("error");
        setError(french
          ? "Cet appareil ou ce navigateur ne fournit pas de caméra. Saisissez le code manuellement."
          : "Dieses Gerät oder dieser Browser bietet keine Kamera. Gib den Code manuell ein.");
      });
    } else {
      const start = async () => {
        try {
          // An ideal preference selects the rear phone camera when available,
          // while still allowing the built-in camera on a laptop.
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
          } catch (cause) {
            if (cancelled || !mayRetryWithoutFacingPreference(cause)) throw cause;
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          }
          if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
          const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
          const startedControls = await reader.decodeFromStream(stream, video, (result, _decodeError, scanControls) => {
            if (!result || cancelled || delivered) return;
            delivered = true;
            scanControls.stop();
            stop();
            callbackRef.current(result.getText());
          });
          if (cancelled) startedControls.stop();
          else { controls = startedControls; setState("ready"); }
        } catch (cause) {
          if (cancelled) return;
          stop();
          setState("error");
          setError(cameraErrorMessage(cause, french));
        }
      };
      void start();
    }

    return () => {
      stop();
      if (stopRef.current === stop) stopRef.current = null;
    };
  }, [attempt, french]);

  function closeScanner() {
    stopRef.current?.();
    onClose();
  }

  function restartScanner() {
    stopRef.current?.();
    setState("starting");
    setError("");
    setAttempt(value => value + 1);
  }

  return <div className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title" lang={locale}><div className="scanner-content"><div className="scanner-head"><div><span className="tiny-label">{french ? "SCAN CAMÉRA" : "KAMERA-SCAN"}</span><h2 id="scanner-title">{french ? "Scanner le QR code" : "QR-Code scannen"}</h2></div><button type="button" className="scanner-close" onClick={closeScanner} aria-label={french ? "Fermer la caméra" : "Kamera schließen"}><Icon name="close" size={20} /></button></div><div className="scanner-video-wrap"><video ref={videoRef} autoPlay muted playsInline aria-label={french ? "Aperçu de la caméra" : "Kameravorschau für den QR-Code"} /><span className="scanner-sight" aria-hidden="true" /></div><p role={state === "error" ? "alert" : "status"}>{state === "starting" ? french ? "Démarrage de la caméra …" : "Kamera wird gestartet …" : state === "ready" ? french ? "Placez le QR code entièrement dans le cadre." : "Halte den QR-Code vollständig in den Rahmen." : error}</p>{state !== "starting" && <button type="button" className="button button--outline button--full" onClick={restartScanner} style={{ marginBottom: 8 }}>{state === "error" ? french ? "Réessayer la caméra" : "Kamera erneut versuchen" : french ? "Redémarrer la caméra" : "Kamera neu starten"}</button>}<button type="button" className="button button--outline button--full" onClick={closeScanner}>{french ? "Saisir le code manuellement" : "Code manuell eingeben"}</button></div></div>;
}
