import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, request, expect } from "@playwright/test";
import { parse } from "dotenv";
import QRCode from "qrcode";
import pg from "pg";

// Actual application recording, restricted to fresh synthetic local tenants.
// Canvas camera input is explicitly simulated; API responses are never mocked.
const origin = "http://localhost:3000";
const mailpit = "http://127.0.0.1:8026";
const verifyOnly = process.argv.includes("--verify");
if (process.argv.slice(2).some(arg => arg !== "--verify")) throw new Error("Use --verify or no arguments");
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
const nextEnv = parse(await readFile(".env.local"));
for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "PUBLIC_BASE_URL", "BETTER_AUTH_URL", "PUBLIC_REGISTRATION_ENABLED", "TRUST_PROXY_CLIENT_IP"])
  assert.equal(nextEnv[key], process.env[key], `Local configuration mismatch: ${key}`);
if (process.env.PUBLIC_BASE_URL !== origin || process.env.BETTER_AUTH_URL !== origin
  || database.protocol !== "postgresql:" || database.port !== "54329" || database.username !== "looplocal"
  || !["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/looplocal"
  || !["localhost", "127.0.0.1"].includes(process.env.SMTP_HOST ?? "") || process.env.SMTP_PORT !== "1026"
  || process.env.PUBLIC_REGISTRATION_ENABLED !== "true" || (process.env.BETTER_AUTH_SECRET?.length ?? 0) < 32
  || ["TRUST_PROXY_CLIENT_IP", "EXTERNAL_EMAIL_ENABLED", "LIVE_BILLING_ENABLED", "BILLING_FIXTURE_MODE", "GOOGLE_WALLET_ENABLED", "APPLE_WALLET_ENABLED"].some(key => process.env[key] === "true" || nextEnv[key] === "true"))
  throw new Error("Fixed synthetic local demo configuration required");

const run = promisify(execFile);
const videoDir = resolve("var/full-platform-video");
await mkdir(videoDir, { recursive: true });
await mkdir("screenshots", { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const hashes = ["auth_signup_peer", "auth_signin_peer", "enroll_peer", "card_read_peer", "card_contact_peer", "merchant_locations_create_peer"]
    .map(scope => createHmac("sha256", process.env.BETTER_AUTH_SECRET).update(scope).update("\0").update("untrusted-peer").digest("hex"));
  await db.query("DELETE FROM rate_limits WHERE key_hash = ANY($1::text[])", [hashes]);
} finally { await db.end(); }

const contexts = [];
async function api() {
  const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  contexts.push(context);
  return context;
}
async function json(response, status = 200) {
  assert.equal(response.status(), status, "Application action returned unexpected HTTP status");
  return response.json();
}
const owner = await api(), cashier = await api(), guest = await api();
const inbox = await request.newContext({ baseURL: mailpit });
contexts.push(inbox);
const stamp = randomUUID().slice(0, 8);
let browser, recorded;
const scenes = [];
let phase = "synthetic setup";
try {
  await json(await owner.get("/api/health"));
  for (const [session, role] of [[owner, "inhaber"], [cashier, "kasse"]]) {
    await json(await session.post("/api/auth/sign-up/email", { data: {
      name: `${role} · synthetische Demo`, email: `${role}-${stamp}@example.test`, password: `Local!${randomUUID()}Aa`,
    } }));
  }
  const rule = { city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Morgenlicht Stempel", programType: "stamp", rulesText: "Ein Stempel je bestätigtem Kassenbesuch. Fünf Stempel für einen Kaffee.", rewardTitle: "Kaffee", rewardCost: 5 };
  const { programSlug, locationId } = await json(await owner.post("/api/merchant/onboard", { data: {
    ...rule, businessName: "Morgenlicht Café (Demo)", locationName: "Kassel Mitte", locale: "de", currency: "EUR", brandColor: "#28665b",
  } }), 201);
  await json(await owner.post("/api/merchant/locations", { data: { ...rule, name: "Kassel West (Demo)", programName: "Morgenlicht West" } }), 201);
  await json(await owner.post("/api/merchant/locations/select", { data: { locationId } }));
  const { token: invitation } = await json(await owner.post("/api/staff/invite", { data: { locationId, email: `kasse-${stamp}@example.test`, role: "cashier" } }), 201);
  await json(await cashier.post("/api/staff/accept", { data: { token: invitation } }));
  await json(await owner.post("/api/merchant/referrals/settings", { data: { programSlug, enabled: true, referrerBonus: 1, referredBonus: 1 } }));
  const { cardToken: referrerToken } = await json(await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } }), 201);
  const referral = await json(await guest.get(`/api/card/${referrerToken}/referral`));
  const { cardToken: referredToken } = await json(await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, referralCode: new URL(referral.shareUrl).searchParams.get("ref") } }), 201);
  const referred = await json(await guest.get(`/api/card/${referredToken}`));
  const referredLookup = await json(await cashier.get(`/api/cashier/lookup?code=${encodeURIComponent(referred.scanCode)}`));
  await json(await cashier.post("/api/cashier/award", { data: { membershipId: referredLookup.membershipId, quantity: 1, requestId: randomUUID(), idempotencyKey: randomUUID() } }));

  browser = await chromium.launch({ channel: "chrome", headless: true });
  recorded = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    storageState: await owner.storageState(), ...(verifyOnly ? {} : { recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } }) });
  const page = await recorded.newPage();
  page.setDefaultTimeout(15000);
  const baseline = await json(await owner.get("/api/me"));
  const activeAudiencePath = `/api/merchant/audiences/preview?programSlug=${programSlug}&kind=recently_active&withinDays=30`;
  assert.equal((await json(await owner.get(activeAudiencePath))).total, 1);
  let cardToken, scanCode, membershipId, campaignId;
  async function caption(title, note = "Synthetische Daten · lokale Anwendung · keine Geräteprüfung") {
    await page.evaluate(({ title, note }) => {
      document.querySelector("#recording-caption")?.remove();
      const bar = document.createElement("aside");
      bar.id = "recording-caption";
      Object.assign(bar.style, { position: "fixed", bottom: "0", left: "0", right: "0", zIndex: "2147483647", background: "#143e38", color: "white", padding: "13px 30px", font: "15px system-ui", boxShadow: "0 -2px 18px #0002", pointerEvents: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "32px" });
      const main = document.createElement("strong"); main.textContent = title; main.style.fontSize = "20px";
      const secondary = document.createElement("span"); secondary.textContent = note; secondary.style.maxWidth = "580px";
      bar.append(main, secondary); document.body.append(bar);
    }, { title, note });
  }
  async function hold(ms) { if (!verifyOnly) await page.waitForTimeout(ms); }
  async function scene(name, seconds, action) {
    phase = name;
    const start = performance.now();
    await action();
    await hold(Math.max(0, seconds * 1000 - (performance.now() - start)));
    if (!verifyOnly) await page.screenshot({ path: resolve(`screenshots/kassel-${name}.png`) });
    scenes.push({ name, seconds: Number(((performance.now() - start) / 1000).toFixed(2)) });
    console.log(`Scene ${name}: PASS`);
  }
  await scene("01-dashboard", 6, async () => {
    await page.goto("/merchant");
    await page.getByRole("heading", { name: /Guten Tag, Morgenlicht/ }).waitFor();
    await caption("Einfach für Gäste. Leistungsstark für den Betrieb.");
  });
  await scene("02-programme", 9, async () => {
    await page.goto("/merchant/program");
    await page.getByRole("heading", { name: "Programmregeln" }).waitFor();
    await caption("Eigene Marke, bestehende Stempelregel, mehrere Prämien");
    await hold(1500);
    await page.getByLabel("Prämientitel").fill("Frühstücksteller");
    await page.getByLabel("Benötigte Stempel").fill("10");
    await page.getByRole("button", { name: "Prämie hinzufügen", exact: true }).click();
    await page.getByText("Prämie hinzugefügt.", { exact: true }).waitFor();
    await page.locator(".reward-manager").scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".reward-manager-row").count(), 2);
  });
  await scene("03-enrollment", 7, async () => {
    await recorded.clearCookies();
    await page.goto(`/join/${programSlug}`);
    await page.getByRole("heading", { name: "Mach deinen Besuch zählbar." }).waitFor();
    await caption("Kunde: QR öffnen, Teilnahme bestätigen, Karte erstellen");
    await hold(1800);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
    await expect(page).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/);
    cardToken = new URL(page.url()).pathname.split("/").at(-1);
    await expect(page.locator(".customer-balance-line strong")).toHaveText("0 Stempel");
    const card = await json(await guest.get(`/api/card/${cardToken}`));
    scanCode = card.scanCode;
    await caption("Persönliche Browserkarte • vollständiger QR • 0 Stempel", "Ohne Kunden-App · privaten Kartenlink sicher speichern");
    await page.locator(".customer-balance-line").scrollIntoViewIfNeeded();
  });
  await scene("04-reopen", 5, async () => {
    await page.goto("/join/" + programSlug);
    await page.goto(`/card/${cardToken}`);
    await expect(page.locator(".customer-balance-line strong")).toHaveText("0 Stempel");
    await caption("Gespeicherten Kartenlink wieder öffnen", "Kein verifizierter Ersatz bei Linkverlust · Wallet noch nicht am Gerät geprüft");
    await page.locator(".customer-qr img").evaluate(async image => { if (!image.complete) await new Promise(resolve => { image.onload = resolve; }); });
    await page.locator(".customer-balance-line").scrollIntoViewIfNeeded();
  });
  await scene("05-scan-award", 12, async () => {
    const qr = await QRCode.toDataURL(scanCode, { width: 512, margin: 4 });
    await page.addInitScript(({ qr }) => {
      if (location.pathname !== "/cashier") return;
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 640;
        const draw = canvas.getContext("2d"); draw.fillStyle = "white"; draw.fillRect(0, 0, 640, 640);
        const stream = canvas.captureStream(10);
        const image = new Image(); image.src = qr; await image.decode();
        setTimeout(() => draw.drawImage(image, 64, 64, 512, 512), 1400);
        window.syntheticCameraTrack = stream.getVideoTracks()[0];
        return stream;
      } } });
    }, { qr });
    await recorded.addCookies((await cashier.storageState()).cookies);
    await page.goto("/cashier");
    await page.getByRole("button", { name: "Kamera öffnen" }).waitFor();
    await caption("Kasse: QR erkennen, Karte prüfen, einen Stempel bestätigen", "Kamerabild simuliert · echter QR-Decoder · echte lokale Buchung");
    await page.getByRole("button", { name: "Kamera öffnen" }).click();
    await expect(page.locator(".balance-display strong")).toHaveText("0 Stempel");
    assert.equal(await page.evaluate(() => window.syntheticCameraTrack.readyState), "ended");
    assert.equal((await json(await guest.get(`/api/card/${cardToken}`))).balance, 0, "Scanning never awards");
    await hold(1200);
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await hold(1300);
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(page.locator(".balance-display strong")).toHaveText("1 Stempel");
    await expect(page.locator(".quantity-row output")).toHaveText("1");
    membershipId = (await json(await cashier.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`))).membershipId;
  });
  await scene("06-redeem", 10, async () => {
    await caption("Demo: bis zur Prämie auffüllen, Kaffee auswählen, bestätigen", "Zusätzliche 4 Stempel sind eine ausdrücklich bestätigte synthetische Demo-Buchung");
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Menge erhöhen" }).click();
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(page.locator(".balance-display strong")).toHaveText("5 Stempel");
    await hold(1800);
    await page.locator(".reward-action-list button").first().click();
    await hold(1800);
    await page.getByRole("button", { name: "Ja, einlösen" }).click();
    await expect(page.locator(".balance-display strong")).toHaveText("0 Stempel");
  });
  await scene("07-card-activity", 6, async () => {
    await recorded.clearCookies();
    await page.goto(`/card/${cardToken}`);
    await expect(page.locator(".customer-balance-line strong")).toHaveText("0 Stempel");
    await caption("Karte wieder öffnen: korrekter Saldo und Einlösung gespeichert");
    await hold(1500);
    await page.locator(".customer-activity-list").scrollIntoViewIfNeeded();
    await expect(page.locator(".customer-activity-list")).toContainText("-5 Stempel");
  });
  // Synthetic contact prerequisite through real routes. No external recipient.
  const address = `gast-${stamp}@example.test`;
  await json(await guest.post(`/api/card/${cardToken}/contact`, { data: { email: address } }));
  await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { timeout: 30000 });
  const messages = await json(await inbox.get("/api/v1/messages"));
  const verification = messages.messages.find(message => message.Subject?.includes("bestätigen") && message.To?.some(to => to.Address === address));
  assert.ok(verification, "Synthetic verification captured in Mailpit");
  const text = (await json(await inbox.get(`/api/v1/message/${verification.ID}`))).Text;
  const verificationUrl = text.match(/http:\/\/localhost:3000\/verify-email#token=v_[A-Za-z0-9_-]{43}/)?.[0];
  assert.ok(verificationUrl);
  // Separate unrecorded browser shows the same real verification and opt-in UI.
  const contactContext = await browser.newContext({ baseURL: origin });
  try {
    const contactPage = await contactContext.newPage();
    await contactPage.goto(verificationUrl);
    await contactPage.getByRole("heading", { name: "E-Mail bestätigt." }).waitFor();
    await contactPage.goto(`/card/${cardToken}`);
    await contactPage.getByRole("button", { name: "Test-E-Mail-Marketing aktivieren" }).click();
    await contactPage.getByText("Lokale Test-Marketing-E-Mails aktiviert.", { exact: false }).waitFor();
  } finally { await contactContext.close(); }
  await recorded.addCookies((await owner.storageState()).cookies);
  await scene("08-dashboard-update", 5, async () => {
    await page.goto("/merchant");
    await page.getByRole("heading", { name: /Guten Tag, Morgenlicht/ }).waitFor();
    const current = await json(await owner.get("/api/me"));
    assert.equal(current.stats.awards, baseline.stats.awards + 2);
    assert.equal(current.stats.redemptions, baseline.stats.redemptions + 1);
    await caption("Inhaber: Dashboard und Aktivität folgen den bestätigten Buchungen");
  });
  await scene("09-customer-audience", 8, async () => {
    await page.goto("/merchant/customers");
    await page.getByRole("button", { name: new RegExp(membershipId.slice(0, 12)) }).click();
    await page.getByText("Erfasste Käufe").waitFor();
    await caption("Pseudonyme Kartenhistorie und echte Zielgruppenabfragen");
    await hold(2200);
    await page.goto("/merchant/audiences");
    await page.getByLabel("Segment").selectOption("recently_active");
    await page.getByRole("button", { name: "Anzahl berechnen" }).click();
    await expect(page.getByTestId("audience-total")).toHaveText("2");
    await caption("Kürzlich aktiv: 2 Karten nach bestätigter Kassenaktivität");
  });
  await scene("10-campaign", 12, async () => {
    await page.goto("/merchant/campaigns");
    await page.getByLabel("Titel", { exact: true }).fill("Morgenlicht Demo-Dank");
    await page.getByLabel("Betreff", { exact: true }).fill(`Lokaler Demo-Dank ${stamp}`);
    await page.getByRole("textbox", { name: "Nachricht", exact: true }).fill("Danke für deinen Besuch im Morgenlicht Café. Dies ist eine synthetische lokale Testnachricht.");
    await page.getByLabel("Zielgruppe auswählen").selectOption("recently_active");
    await page.getByRole("button", { name: "Zielgruppe prüfen" }).click();
    await page.getByText("1 kontaktierbar", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Zielgruppenvorschau" }).scrollIntoViewIfNeeded();
    await caption("Kampagne: Zielgruppe, Ausschlüsse, Entwurf und Termin", "Eine verifizierte .test-Adresse mit Einwilligung · externe Zustellung AUS");
    await hold(1800);
    await page.getByRole("button", { name: "Entwurf speichern" }).click();
    await page.getByText("Morgenlicht Demo-Dank", { exact: true }).waitFor();
    // The current minute is a valid due time; the operator clock is unchanged.
    const local = await page.evaluate(() => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
    await page.getByLabel("Termin für Planung").fill(local);
    await page.getByRole("button", { name: "Planen", exact: true }).click();
    await page.getByText("Termin gespeichert.", { exact: false }).waitFor();
    const list = await json(await owner.get(`/api/merchant/campaigns?programSlug=${programSlug}`));
    campaignId = list.campaigns[0].id;
    await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { timeout: 30000 });
    await page.reload();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByRole("heading", { name: "Letzte Zustellversuche" }).scrollIntoViewIfNeeded();
    await caption("Geplante Testnachricht vom lokalen Mailpit angenommen", "Lokale Erfassung bestätigt keine echte Postfachzustellung");
    const result = await json(await owner.get(`/api/merchant/campaigns/${campaignId}`));
    assert.equal(result.campaign.status, "complete"); assert.equal(result.summary.sent, 1);
  });
  await scene("11-mailpit", 4, async () => {
    const captured = (await json(await inbox.get("/api/v1/messages"))).messages.find(message => message.Subject?.includes(`Lokaler Demo-Dank ${stamp}`));
    assert.ok(captured, "Scheduled message captured locally");
    await page.goto(mailpit);
    await page.getByText(`[LOCAL TEST] Lokaler Demo-Dank ${stamp}`, { exact: true }).click();
    await caption("Mailpit: die geplante Nachricht ist lokal angekommen", "Ausschließlich synthetischer Kontakt · keine externe E-Mail");
  });
  await scene("12-referrals", 6, async () => {
    await page.goto("/merchant/analytics");
    await page.getByRole("heading", { name: "Empfehlungsereignisse" }).scrollIntoViewIfNeeded();
    const analytics = await json(await owner.get("/api/merchant/analytics?window=30"));
    assert.deepEqual(analytics.referrals, { attributed: 1, qualified: 1, reversed: 0 });
    await caption("Empfehlungen: Beitritt und Bonusqualifikation getrennt zählen", "Bonus erst nach bestätigtem Checkout · keine Umsatzbehauptung");
  });
  await scene("13-team-locations", 7, async () => {
    await page.goto("/merchant/staff");
    await page.getByRole("heading", { name: "Aktuelle Zugänge" }).waitFor();
    await caption("Eigene Teamzugänge, Standortrechte und Zugriffsverlauf");
    await hold(2500);
    await page.goto("/merchant/locations");
    await page.getByRole("heading", { name: "Standorte", exact: true }).waitFor();
    await page.getByText("Kassel West (Demo)", { exact: true }).waitFor();
    await caption("Mehrere Standorte mit eigenen Programmen und Guthaben");
  });
  await scene("14-offline", 9, async () => {
    await recorded.clearCookies();
    await recorded.addCookies((await cashier.storageState()).cookies);
    await page.goto("/cashier");
    await page.getByLabel("Kartencode manuell eingeben").fill(scanCode);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await page.getByText("Offline-Puffer bereit", { exact: false }).waitFor();
    await caption("Offline: Vergabe vormerken, anschließend abgleichen", "Browser-Trennung simuliert · Einlösung bleibt online · Guthaben erst nach Annahme");
    await recorded.setOffline(true);
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Offline-Vergabe vormerken" }).click();
    await page.getByText("1 ausstehend", { exact: false }).waitFor();
    assert.equal((await json(await guest.get(`/api/card/${cardToken}`))).balance, 0);
    await hold(1700);
    await recorded.setOffline(false);
    await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren" }).click();
    await page.getByText("Vom Server angenommen", { exact: false }).waitFor();
    assert.equal((await json(await guest.get(`/api/card/${cardToken}`))).balance, 1);
  });
  await scene("15-plan", 6, async () => {
    await recorded.clearCookies();
    await recorded.addCookies((await owner.storageState()).cookies);
    await page.goto("/merchant/billing");
    await page.getByText("Entwurf ohne Zahlung", { exact: true }).waitFor();
    await caption("Standortpläne und Nutzung sichtbar. Keine Live-Abrechnung.", "Nächster Nachweis: geschütztes HTTPS, zwei echte Telefone, reale Wallet-Karte");
  });
  const video = page.video();
  await recorded.close(); recorded = null;
  let duration = null;
  if (video) {
    const raw = await video.path();
    const target = resolve("demo/full-platform-kassel-synthetic.mp4");
    const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", raw])).stdout);
    const rawDuration = Number(probe.format.duration);
    // Recorded setup waits are included. Fit the requested demo length and
    // disclose any pacing adjustment; this video measures no checkout speed.
    const pace = rawDuration > 119 ? 114 / rawDuration : 1;
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", raw, "-vf", `setpts=${pace}*PTS`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", target], { timeout: 60000 });
    await unlink(raw);
    duration = Number(JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", target])).stdout).format.duration);
    assert.ok(duration >= 90 && duration <= 120, "Demo must be 90–120 seconds");
    const revision = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile("demo/full-platform-kassel-evidence.json", JSON.stringify({ revision, sourceChanges: "see containing commit; no app UI changes", recordedAt: new Date().toISOString(), result: "PASS", durationSeconds: duration, rawDurationSeconds: rawDuration, playbackRate: Number((1 / pace).toFixed(3)), scenes, syntheticOnly: true, camera: "canvas stream simulation; real ZXing decoder and HTTP lookup", actualHardware: "NOT RUN", realWalletProviders: "NOT RUN", externalMessages: 0, campaignLocalCaptured: 1, recentlyActiveAudienceBeforeAfter: [1, 2], mainCardBalances: [0, 1, 5, 0, 1], offlineBalanceBeforeAcceptance: 0, pendingAwardAcceptedOnce: true }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ result: "PASS", verifyOnly, scenes: scenes.length, durationSeconds: duration, camera: "SIMULATED", hardware: "NOT RUN", wallet: "NOT RUN", mail: "LOCAL MAILPIT ONLY" }));
} catch (error) {
  // Do not print card/recovery URLs or request payloads from a browser failure.
  console.error(`Full-platform demo failed during ${phase}: ${String(error.message).replace(/(?:card_|sc_|v_|ref_)[A-Za-z0-9_-]+/g, "[redacted]")}`);
  process.exitCode = 1;
} finally {
  if (recorded) await recorded.close();
  if (browser) await browser.close();
  await Promise.all(contexts.map(context => context.dispose()));
}
