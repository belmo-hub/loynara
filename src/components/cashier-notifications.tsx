"use client";

import { useEffect, useState } from "react";
import styles from "@/components/cashier-notifications.module.css";
import {
  clearTapNotifications,
  disableCashierPush,
  enableCashierPush,
  getPushState,
  listenForTapRefresh,
  registerCashierWorker,
  syncCashierPush,
  TAP_REFRESH_EVENT,
  type CashierLocale,
  type CashierPushState,
} from "@/lib/cashier-push-client";

type Copy = {
  on: string;
  off: string;
  enable: string;
  disable: string;
  blocked: string;
  installIntro: string;
  installSteps: [string, string, string];
  fallback: string;
  failed: string;
};

const COPY: Record<CashierLocale, Copy> = {
  de: {
    on: "Benachrichtigungen an",
    off: "NFC-Anfragen erreichen dich auch bei gesperrtem Bildschirm.",
    enable: "Benachrichtigungen einschalten",
    disable: "Ausschalten",
    blocked: "Benachrichtigungen sind blockiert. Erlaube sie für diese Seite in den Browser-Einstellungen und lade die Kasse neu.",
    installIntro: "Auf dem iPhone funktionieren Benachrichtigungen nur aus dem Home-Bildschirm:",
    installSteps: ["In Safari auf Teilen tippen.", "„Zum Home-Bildschirm“ wählen.", "Die Kasse von dort öffnen."],
    fallback: "NFC-Anfragen erscheinen, solange die Kasse geöffnet ist.",
    failed: "Benachrichtigungen konnten nicht geändert werden. Bitte versuche es erneut.",
  },
  fr: {
    on: "Notifications activées",
    off: "Les demandes NFC vous parviennent aussi à écran verrouillé.",
    enable: "Activer les notifications",
    disable: "Désactiver",
    blocked: "Les notifications sont bloquées. Autorisez-les pour cette page dans les réglages du navigateur, puis rechargez la caisse.",
    installIntro: "Sur iPhone, les notifications ne fonctionnent que depuis l'écran d'accueil :",
    installSteps: ["Touchez Partager dans Safari.", "Choisissez « Sur l'écran d'accueil ».", "Ouvrez la caisse depuis cet écran."],
    fallback: "Les demandes NFC apparaissent tant que la caisse est ouverte.",
    failed: "Les notifications n'ont pas pu être modifiées. Veuillez réessayer.",
  },
};

export function CashierNotifications({ locale }: { locale: CashierLocale }) {
  const copy = COPY[locale];
  const [state, setState] = useState<CashierPushState | "checking">("checking");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const stopListening = listenForTapRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void clearTapNotifications();
      window.dispatchEvent(new Event(TAP_REFRESH_EVENT));
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    void (async () => {
      await registerCashierWorker().catch(() => null);
      if (!active) return;
      if (document.visibilityState === "visible") void clearTapNotifications();
      const next = await getPushState().catch((): CashierPushState => "unavailable");
      // "On" in this browser does not prove the server still has the device (it is bound to the login session).
      if (next === "on") await syncCashierPush(locale).catch(() => undefined);
      if (active) setState(next);
    })();

    return () => {
      active = false;
      stopListening();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [locale]);

  // The action runs synchronously from the click, so the permission prompt keeps the user gesture.
  async function run(action: () => Promise<CashierPushState>) {
    setBusy(true);
    setFailed(false);
    try {
      setState(await action());
    } catch {
      setFailed(true);
      setState(await getPushState().catch((): CashierPushState => "unavailable"));
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;

  if (state === "on") {
    return (
      <section className={styles.card} aria-label={copy.on}>
        <div className={styles.row}>
          <p className={styles.title}>{copy.on}</p>
          <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={busy} onClick={() => void run(disableCashierPush)}>
            {copy.disable}
          </button>
        </div>
        {failed ? <p role="alert" className={styles.error}>{copy.failed}</p> : null}
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label={copy.off}>
      {state === "off" ? (
        <div className={styles.row}>
          <p className={styles.text}>{copy.off}</p>
          <button type="button" className={styles.button} disabled={busy} onClick={() => void run(() => enableCashierPush(locale))}>
            {copy.enable}
          </button>
        </div>
      ) : null}
      {state === "blocked" ? <p className={styles.text}>{copy.blocked}</p> : null}
      {state === "needs_install" ? (
        <div className={styles.text}>
          <p className={styles.text}>{copy.installIntro}</p>
          <ol className={styles.steps}>
            {copy.installSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      ) : null}
      {state === "unavailable" || state === "unsupported" ? <p className={styles.text}>{copy.fallback}</p> : null}
      {failed ? <p role="alert" className={styles.error}>{copy.failed}</p> : null}
    </section>
  );
}
