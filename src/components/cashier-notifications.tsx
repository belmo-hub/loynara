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
  /** Short accessible name of the card; the explanations below are too long for a label. */
  label: string;
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
    label: "Benachrichtigungen",
    on: "Benachrichtigungen an",
    off: "Bei neuen NFC-Anfragen kann sich dieses Handy auch bei gesperrtem Bildschirm melden. Je nach Einstellung (z. B. Fokus-Modus) kommt keine Meldung. Die Meldung zeigt keine Kundendaten. Bestätigt wird nur in der geöffneten Kasse.",
    enable: "Benachrichtigungen einschalten",
    disable: "Ausschalten",
    blocked: "Benachrichtigungen sind blockiert. Erlaube sie für diese Seite in den Einstellungen deines Browsers und lade die Kasse danach neu.",
    installIntro: "Auf dem iPhone gibt es Benachrichtigungen nur für die Kasse auf dem Home-Bildschirm. So geht’s:",
    installSteps: ["In Safari auf Teilen tippen.", "„Zum Home-Bildschirm“ wählen.", "Die Kasse über das neue Symbol öffnen und dort Benachrichtigungen einschalten."],
    fallback: "Benachrichtigungen sind auf diesem Gerät nicht verfügbar. NFC-Anfragen erscheinen nur, solange die Kasse geöffnet bleibt.",
    failed: "Benachrichtigungen konnten nicht geändert werden. Bitte versuche es erneut.",
  },
  fr: {
    label: "Notifications",
    on: "Notifications activées",
    off: "Pour les nouvelles demandes NFC, ce téléphone peut vous alerter même à écran verrouillé. Selon les réglages (par ex. le mode concentration), aucune alerte n’arrive. La notification n’affiche aucune donnée client. La confirmation se fait uniquement dans la caisse ouverte.",
    enable: "Activer les notifications",
    disable: "Désactiver",
    blocked: "Les notifications sont bloquées. Autorisez-les pour cette page dans les réglages du navigateur, puis rechargez la caisse.",
    installIntro: "Sur iPhone, les notifications ne fonctionnent que pour la caisse installée sur l’écran d’accueil :",
    installSteps: ["Touchez Partager dans Safari.", "Choisissez « Sur l’écran d’accueil ».", "Ouvrez la caisse depuis ce symbole, puis activez les notifications."],
    fallback: "Les notifications ne sont pas disponibles sur cet appareil. Les demandes NFC n’apparaissent que pendant que la caisse reste ouverte.",
    failed: "Les notifications n’ont pas pu être modifiées. Veuillez réessayer.",
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
      // If the server cannot take the device back, say "off" so the cashier can switch it on again, never a false "on".
      const synced = next === "on" ? await syncCashierPush(locale).then(() => true, () => false) : true;
      if (active) setState(synced ? next : "off");
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
      <section className={styles.card} aria-label={copy.label}>
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
    <section className={styles.card} aria-label={copy.label}>
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
