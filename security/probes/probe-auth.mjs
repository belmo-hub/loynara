import { Client, BASE } from "./harness.mjs";


const rnd = () => Math.random().toString(36).slice(2, 7);
const o = new Client("o"); const email = `auth-${rnd()}@example.test`;
const pw = "correct-horse-battery-staple-1";
let r = await o.post("/api/auth/sign-up/email", { name: "x", email, password: pw });
console.log("signup set-cookie:", r.headers.getSetCookie().map(c => c.replace(/=[^;]+/, "=<v>")).join(" | "));
// cross-origin variants with valid cookie
for (const [label, origin] of [["evil origin", "https://evil.example"], ["no origin", undefined], ["null origin", "null"]]) {
  const h = { cookie: o.cookieHeader(), "content-type": "application/json" }; if (origin) h.origin = origin;
  const res = await fetch(BASE + "/api/auth/update-user", { method: "POST", headers: h, body: JSON.stringify({ name: "pwned-" + label }) });
  console.log(`update-user ${label} -> ${res.status} ${(await res.text()).slice(0,100)}`);
}
for (const [label, origin] of [["evil origin", "https://evil.example"], ["no origin", undefined]]) {
  const h = { cookie: o.cookieHeader(), "content-type": "application/json" }; if (origin) h.origin = origin;
  const res = await fetch(BASE + "/api/auth/change-password", { method: "POST", headers: h, body: JSON.stringify({ currentPassword: pw, newPassword: pw + "x" }) });
  console.log(`change-password ${label} -> ${res.status} ${(await res.text()).slice(0,100)}`);
}
// login CSRF: sign-in from another origin without cookies
for (const [label, origin] of [["evil origin", "https://evil.example"], ["no origin", undefined]]) {
  const h = { "content-type": "application/json" }; if (origin) h.origin = origin;
  const res = await fetch(BASE + "/api/auth/sign-in/email", { method: "POST", headers: h, body: JSON.stringify({ email, password: pw }) });
  console.log(`sign-in ${label} -> ${res.status} set-cookie=${res.headers.getSetCookie().length}`);
}
// text/plain body (simple request, no preflight) to an app route
{
  const res = await fetch(BASE + "/api/staff/accept", { method: "POST", headers: { cookie: o.cookieHeader(), "content-type": "text/plain", origin: "https://evil.example" }, body: "{}" });
  console.log(`app route text/plain cross-origin -> ${res.status} ${(await res.text()).slice(0,80)}`);
}
// sessions endpoints
r = await o.get("/api/auth/list-sessions"); console.log("list-sessions", r.status, Array.isArray(r.json) ? r.json.length + " sessions, fields=" + Object.keys(r.json[0]).join(",") : r.json);
r = await o.get("/api/auth/get-session"); console.log("get-session fields:", Object.keys(r.json?.session ?? {}).join(","));
// password reset / other endpoints
for (const p of ["/api/auth/request-password-reset", "/api/auth/forget-password", "/api/auth/send-verification-email", "/api/auth/change-email", "/api/auth/delete-user", "/api/auth/sign-in/social", "/api/auth/link-social"]) {
  const res = await o.post(p, { email, redirectTo: "https://evil.example/x", newEmail: "victim@example.test", callbackURL: "https://evil.example", provider: "google" });
  console.log(`${p} -> ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
}
// open redirect via callbackURL on verify-email / reset-password GET
for (const p of ["/api/auth/verify-email?token=x&callbackURL=https://evil.example", "/api/auth/reset-password/abc?callbackURL=https://evil.example", "/api/auth/error?error=<script>alert(1)</script>"]) {
  const res = await fetch(BASE + p, { redirect: "manual" });
  console.log(`GET ${p} -> ${res.status} loc=${res.headers.get("location")} ct=${res.headers.get("content-type")}`);
}
