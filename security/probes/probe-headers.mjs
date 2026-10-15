import { Client, signUp, onboard } from "./harness.mjs";
const o = new Client("h"); await signUp(o, `hdr-${Date.now()}@example.test`); await onboard(o, "Header Cafe");
for (const p of ["/merchant", "/cashier", "/merchant/staff", "/merchant/customers"]) {
  const r = await o.get(p);
  const h = r.headers;
  console.log(p, r.status, ["content-security-policy","strict-transport-security","x-frame-options","x-content-type-options","referrer-policy","x-powered-by"].map(k => `${k.split("-").map(s=>s[0]).join("")}=${h.get(k) ? "y" : "n"}`).join(" "), "unsafe-eval:", (h.get("content-security-policy")||"").includes("unsafe-eval"));
}
