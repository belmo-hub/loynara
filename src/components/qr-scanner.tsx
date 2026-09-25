"use client";

import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";
import { Icon, type UiLocale } from "./loyalty-ui";

export function QrScanner({ onDetected, onClose, locale = "de" }: { onDetected: (text: string) => void; onClose: () => void; locale?: UiLocale }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onDetected);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [state, setState] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState("");
  const french = locale === "fr";

  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setState("error");
      setError(french ? "La caméra n’est pas disponible ici. Saisissez le code manuellement." : "Diese Umgebung bietet keinen Kamerazugriff. Gib den Kartencode unten manuell ein.");
      return;
    }
    const video = videoRef.current;
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
    void reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (result, _error, controls) => {
      if (!result || cancelled) return;
      cancelled = true;
      controls.stop();
      callbackRef.current(result.getText());
    }).then(controls => {
      if (cancelled) controls.stop();
      else { controlsRef.current = controls; setState("ready"); }
    }).catch(cause => {
      if (cancelled) return;
      setState("error");
      const message = cause instanceof Error ? cause.message : "Die Kamera konnte nicht gestartet werden.";
      setError(/denied|permission|notallowed/i.test(message) ? french ? "L’accès à la caméra a été refusé. Autorisez-le dans le navigateur ou saisissez le code." : "Die Kamerafreigabe wurde abgelehnt. Erlaube den Zugriff in deinem Browser oder gib den Code manuell ein." : french ? "La caméra n’a pas pu démarrer. Saisissez le code manuellement." : "Die Kamera konnte nicht gestartet werden. Gib den Kartencode manuell ein.");
    });
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      const stream = video.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    };
  }, [french]);

  return <div className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title" lang={locale}><div className="scanner-content"><div className="scanner-head"><div><span className="tiny-label">{french ? "SCAN CAMÉRA" : "KAMERA-SCAN"}</span><h2 id="scanner-title">{french ? "Scanner le QR code" : "QR-Code scannen"}</h2></div><button type="button" className="scanner-close" onClick={onClose} aria-label={french ? "Fermer la caméra" : "Kamera schließen"}><Icon name="close" size={20} /></button></div><div className="scanner-video-wrap"><video ref={videoRef} autoPlay muted playsInline aria-label={french ? "Aperçu de la caméra" : "Kameravorschau für den QR-Code"} /><span className="scanner-sight" aria-hidden="true" /></div><p role="status">{state === "starting" ? french ? "Démarrage de la caméra …" : "Kamera wird gestartet …" : state === "ready" ? french ? "Placez le QR code entièrement dans le cadre." : "Halte den QR-Code vollständig in den Rahmen." : error}</p><button type="button" className="button button--outline button--full" onClick={onClose}>{french ? "Saisir le code manuellement" : "Code manuell eingeben"}</button></div></div>;
}
