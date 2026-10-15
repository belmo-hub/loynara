import { BASE } from "./harness.mjs";
const email = `paths-${Date.now()}@example.test`, password = "correct-horse-battery-staple-1";
await fetch(BASE + "/api/auth/sign-up/email", { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "p", email, password }) });
for (const p of ["/api/auth/sign-in/email", "/api/auth/sign-in/email/", "/api/auth//sign-in/email", "/api/auth/sign-in//email", "/api/auth/sign-in/email?x=1", "/api/auth/sign-in/%65mail", "/api/auth/SIGN-IN/email", "/api/auth/sign-in/email%2F", "/api/auth/./sign-in/email"]) {
  const r = await fetch(BASE + p, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ email, password }) , redirect: "manual"});
  console.log(p.padEnd(32), r.status, r.headers.getSetCookie().some(c => c.includes("session_token")) ? "SESSION ISSUED" : "");
}
