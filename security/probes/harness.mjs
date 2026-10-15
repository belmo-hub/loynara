// Probe harness for the local audit stack only. Refuses anything but loopback.
export const BASE = process.env.BASE ?? "http://localhost:3081";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error("local only");

export class Client {
  constructor(name) { this.name = name; this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  store(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/Max-Age=0/i.test(line) || v === "") this.jar.delete(k); else this.jar.set(k, v);
    }
  }
  async req(method, path, body, extra = {}) {
    const headers = { origin: BASE, ...(extra.headers ?? {}) };
    if (this.jar.size) headers.cookie = this.cookieHeader();
    let payload;
    if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual" });
    this.store(res);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  }
  get(p, x) { return this.req("GET", p, undefined, x); }
  post(p, b, x) { return this.req("POST", p, b ?? {}, x); }
  del(p, b, x) { return this.req("DELETE", p, b ?? {}, x); }
}

const rnd = () => Math.random().toString(36).slice(2, 8);
export async function signUp(c, email) {
  const r = await c.post("/api/auth/sign-up/email", { name: c.name, email, password: "correct-horse-battery-" + rnd() + "X1" });
  if (r.status !== 200) throw new Error(`signup ${email} ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.user;
}
export async function onboard(c, name) {
  const r = await c.post("/api/merchant/onboard", { businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: name + " Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Gratiskaffee", rewardCost: 8 });
  if (r.status !== 201) throw new Error(`onboard ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}
export async function addStaff(owner, locationId, role, label) {
  const c = new Client(label);
  const email = `${label}-${rnd()}@example.test`;
  const user = await signUp(c, email);
  const inv = await owner.post("/api/staff/invite", { locationId, email, role });
  if (inv.status !== 201) throw new Error(`invite ${inv.status} ${JSON.stringify(inv.json)}`);
  const acc = await c.post("/api/staff/accept", { token: inv.json.token });
  if (acc.status !== 200) throw new Error(`accept ${acc.status} ${JSON.stringify(acc.json)}`);
  return { c, user, email };
}
export async function enroll(slug) {
  const c = new Client("guest");
  const r = await c.post("/api/enroll", { slug, acceptedTerms: true, additionalCard: true });
  if (r.status !== 201) throw new Error(`enroll ${r.status} ${JSON.stringify(r.json)}`);
  const card = await c.get(`/api/card/${r.json.cardToken}`);
  return { c, cardToken: r.json.cardToken, card: card.json };
}
export const uuid = () => crypto.randomUUID();
export function show(label, r, expectDenied = true) {
  const ok = expectDenied ? r.status >= 400 : r.status < 400;
  console.log(`${ok ? "ok  " : "FAIL"} ${label} -> ${r.status} ${typeof r.json === "string" ? r.json.slice(0, 120) : JSON.stringify(r.json).slice(0, 160)}`);
  return ok;
}
