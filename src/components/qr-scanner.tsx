"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import type { UiLocale } from "./loyalty-ui";
import { Button } from "./ui/button";
import { cx } from "./ui/cx";
import styles from "./qr-scanner.module.css";

type CameraState = "starting" | "ready" | "error";

/** How often a camera frame is decoded. */
const SCAN_INTERVAL_MS = 150;
/** Frames are scaled down to this width before decoding, which keeps older phones responsive. */
const MAX_FRAME_WIDTH = 640;

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

type QrScannerProps = {
  /**
   * Every read, several per second while a code is in view: the camera keeps running from one customer to the next.
   * The caller decides what a read means and ignores reads while a card is open.
   */
  onDetected: (text: string) => void;
  onClose: () => void;
  locale?: UiLocale;
  /** Hides the preview while a card is open, without stopping the camera. */
  paused?: boolean;
  /** Called when the camera cannot start (permission, busy device, no camera). */
  onFailure?: (cause: unknown) => void;
};

/** The counter camera: inline on the cashier screen and kept running between customers. */
export function QrScanner({ onDetected, onClose, locale = "de", paused = false, onFailure }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onDetected);
  const failureRef = useRef(onFailure);
  const pausedRef = useRef(paused);
  const stopRef = useRef<(() => void) | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CameraState>("starting");
  const [error, setError] = useState("");
  const french = locale === "fr";

  useEffect(() => { callbackRef.current = onDetected; failureRef.current = onFailure; }, [onDetected, onFailure]);
  // A preview that was hidden may have been paused by the browser; resume it when the counter is ready again.
  useEffect(() => { pausedRef.current = paused; if (!paused) videoRef.current?.play().catch(() => {}); }, [paused]);

  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
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
          video.srcObject = stream;
          await video.play();
          if (cancelled) return;
          setState("ready");
          // jsQR decodes every card code; the previous decoder missed about one in sixteen perfectly rendered ones. The
          // frame size is read on every pass, so a camera that delivers its first frame late is still decoded.
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Canvas unavailable");
          const scan = () => {
            if (cancelled) return;
            if (!pausedRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
              const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
              const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
              if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
              context.drawImage(video, 0, 0, width, height);
              const found = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
              if (found?.data && !cancelled) callbackRef.current(found.data);
            }
            timer = setTimeout(scan, SCAN_INTERVAL_MS);
          };
          scan();
        } catch (cause) {
          if (cancelled) return;
          stop();
          setState("error");
          setError(cameraErrorMessage(cause, french));
          failureRef.current?.(cause);
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

  const status = state === "starting" ? french ? "Démarrage de la caméra …" : "Kamera wird gestartet …" : state === "ready" ? french ? "Caméra prête. Présentez le QR code de la carte suivante." : "Kamera bereit. QR-Code der nächsten Karte in den Rahmen halten." : error;
  // `counter-camera` and `scanner-video-wrap` stay as hooks for the counter specs.
  return <section className={cx("counter-camera", styles.camera)} aria-label={french ? "Caméra de caisse" : "Kassenkamera"} lang={locale} hidden={paused}>
    <div className={cx("scanner-video-wrap", styles.video)}>
      <video ref={videoRef} autoPlay muted playsInline aria-label={french ? "Aperçu de la caméra" : "Kameravorschau für den QR-Code"} />
      <span className={styles.sight} aria-hidden="true" />
    </div>
    <p className={styles.state} data-state={state} role={state === "error" ? "alert" : "status"}>{status}</p>
    <div className={styles.actions}>
      {state === "error" && <Button variant="secondary" size="sm" onClick={restartScanner}>{french ? "Réessayer la caméra" : "Kamera erneut versuchen"}</Button>}
      {state === "ready" && <Button variant="quiet" size="sm" onClick={restartScanner}>{french ? "Redémarrer la caméra" : "Kamera neu starten"}</Button>}
      <Button variant="quiet" size="sm" onClick={closeScanner}>{french ? "Éteindre la caméra" : "Kamera ausschalten"}</Button>
    </div>
  </section>;
}

/** The counter camera after it went to sleep (idle, hidden tab, failure): one tap wakes it, or it can be turned off. */
export function SleepingCamera({ locale, hidden, onWake, onClose }: { locale: UiLocale; hidden: boolean; onWake: () => void; onClose: () => void }) {
  const french = locale === "fr";
  return <section className={cx("counter-camera counter-camera--sleeping", styles.camera, styles.sleeping)} hidden={hidden}>
    <Button variant="primary" size="lg" block onClick={onWake}>{french ? "Rallumer la caméra" : "Kamera fortsetzen"}</Button>
    <div className={styles.actions}><Button variant="quiet" size="sm" onClick={onClose}>{french ? "Éteindre la caméra" : "Kamera ausschalten"}</Button></div>
  </section>;
}
