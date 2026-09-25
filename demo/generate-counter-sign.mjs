import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import QRCode from "qrcode";
import { parse } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deviceTest = process.argv[2] === "--device-test";
if (deviceTest && process.argv.length !== 3) throw new Error("Device-test sign uses only the configured approved origin");
const accessPath = path.join(root, deviceTest ? "var/device-test-access.json" : "var/preview-access.json");
if (deviceTest && !existsSync(accessPath)) throw new Error("Start and seed the approved device-test instance before printing its sign");
const access = JSON.parse(readFileSync(accessPath, "utf8"));
if (!/^[a-z0-9-]{1,120}$/.test(access.programSlug ?? "")) throw new Error("Synthetic preview programme slug is missing");

const approved = deviceTest ? parse(readFileSync(path.join(root, "var/device-test.env"))) : null;
if (deviceTest) {
  const origin = approved?.DEVICE_TEST_APPROVED_ORIGIN;
  const parsedOrigin = origin ? new URL(origin) : null;
  if (!origin || approved?.BETTER_AUTH_URL !== origin || approved?.PUBLIC_BASE_URL !== origin
    || parsedOrigin?.origin !== origin || parsedOrigin.protocol !== "https:"
    || ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname)) {
    throw new Error("Device-test sign requires the exact approved HTTPS origin in both app URLs");
  }
}
const joinUrl = deviceTest ? `${approved.DEVICE_TEST_APPROVED_ORIGIN}/join/${access.programSlug}` : process.argv[2] ?? `http://localhost:3001/join/${access.programSlug}`;
const parsed = new URL(joinUrl);
const localPreview = parsed.protocol === "http:" && parsed.hostname === "localhost" && parsed.port === "3001";
if ((!localPreview && parsed.protocol !== "https:") || parsed.pathname !== `/join/${access.programSlug}` || parsed.search || parsed.hash || parsed.username || parsed.password) {
  throw new Error("Use the current synthetic programme's localhost preview URL or its approved HTTPS URL");
}

const escape = (value) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const qr = await QRCode.toString(joinUrl, { type: "svg", width: 720, margin: 2, errorCorrectionLevel: "H" });
const accessNote = localPreview
  ? "LOKALE TESTVORSCHAU · Dieser Link funktioniert nur auf dem Mac, auf dem LoopLocal unter localhost:3001 läuft. Für den Test mit zwei Geräten ist zuerst eine freigegebene HTTPS-Vorschau nötig."
  : "GESCHÜTZTE TESTVORSCHAU · Nur mit freigegebenem HTTPS-Zugang und synthetischen Daten verwenden.";
const action = localPreview ? "Am Mac öffnen. Karte erstellen." : "QR scannen. Karte öffnen.";
const merchantName = "Demo Kaffeebar Kassel";

const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escape(merchantName)} · Anmeldeschild</title>
  <style>
    :root { color-scheme: light; --forest:#193b2d; --green:#2f6b58; --paper:#f4f1e9; --orange:#ef9c74; }
    * { box-sizing:border-box; }
    body { margin:0; background:#e6ebe4; color:var(--forest); font-family:Arial,Helvetica,sans-serif; }
    .sheet { width:148mm; min-height:210mm; margin:18px auto; padding:12mm 13mm 9mm; background:var(--paper); box-shadow:0 14px 40px #193b2d22; display:flex; flex-direction:column; align-items:center; text-align:center; }
    .eyebrow { margin:7mm 0 3mm; color:var(--green); font-size:10px; font-weight:800; letter-spacing:.18em; }
    h1 { margin:0; font-size:31px; line-height:1.06; letter-spacing:-.06em; }
    .sub { margin:3mm 0 7mm; font-size:15px; font-weight:700; }
    .qr { width:76mm; height:76mm; padding:3mm; border:2px solid var(--green); border-radius:8mm; background:#fff; }
    .qr svg { display:block; width:100%; height:100%; }
    .instruction { margin:7mm 0 2mm; font-size:18px; line-height:1.2; font-weight:800; letter-spacing:-.04em; }
    .steps { margin:0; padding:0; display:flex; gap:4mm; list-style:none; font-size:11px; line-height:1.35; font-weight:700; }
    .steps li { width:30mm; }
    .steps b { display:inline-grid; place-items:center; width:17px; height:17px; margin-right:3px; border-radius:50%; background:var(--green); color:#fff; font-size:10px; }
    .join-url { width:100%; margin:7mm 0 0; padding:3mm; border-top:1px solid #c9d8ca; border-bottom:1px solid #c9d8ca; overflow-wrap:anywhere; font-size:10px; font-weight:700; }
    .note { margin:auto 0 0; padding-top:5mm; color:#415d49; font-size:9px; line-height:1.4; text-align:left; }
    .attribution { align-self:flex-end; margin:4mm 0 0; color:#415d49; font-size:10px; font-weight:700; }
    @page { size:A5 portrait; margin:0; }
    @media print { body { background:#fff; print-color-adjust:exact; -webkit-print-color-adjust:exact; } .sheet { margin:0; box-shadow:none; } }
  </style>
</head>
<body>
  <main class="sheet">
    <p class="eyebrow">SYNTHETISCHE DEMO · KASSEL</p>
    <h1>${escape(merchantName)}</h1>
    <p class="sub">Deine Stempelkarte im Browser</p>
    <div class="qr" role="img" aria-label="QR-Code zur Demo-Kaffeekarte">${qr}</div>
    <p class="instruction">${escape(action)}</p>
    <ol class="steps"><li><b>1</b>Programm lesen</li><li><b>2</b>Karte erstellen</li><li><b>3</b>An der Kasse zeigen</li></ol>
    <p class="join-url">${escape(joinUrl)}</p>
    <p class="note">${escape(accessNote)} Es werden keine echten Kundendaten benötigt. Die Teilnahmebedingungen in der Vorschau sind ein Entwurf.</p>
    <p class="attribution">Mit LoopLocal</p>
  </main>
</body>
</html>
`;

const target = path.join(root, deviceTest ? "var/device-test-counter-sign.html" : "demo/counter-sign.html");
writeFileSync(target, html, "utf8");
if (deviceTest) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(target).href);
    await page.pdf({ path: path.join(root, "var/device-test-counter-sign.pdf"), preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}
console.log(`Generated ${path.relative(root, target)}${deviceTest ? " and var/device-test-counter-sign.pdf" : ""} for ${localPreview ? "loopback preview" : "configured HTTPS device test"}.`);
