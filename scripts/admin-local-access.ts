import "dotenv/config";
import { parseArgs } from "node:util";
import { basename } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
export async function createLocalAccess(address: string) {
  if (process.env.NODE_ENV === "production") throw new Error("Local Access is forbidden in production");
  const email = address.trim().toLowerCase();
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase());
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowed.includes(email)) throw new Error("Email must be on ADMIN_ALLOWED_EMAILS");
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwks = { keys: [await exportJWK(publicKey)] };
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email }).setProtectedHeader({ alg: "ES256", typ: "JWT" }).setIssuer("https://loynara-local-access.invalid").setAudience("loynara-local-admin").setIssuedAt(now).setExpirationTime(now + 43200).sign(privateKey);
  return { mode: "local_test" as const, jwks, token };
}
async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" } }, strict: true });
  if (!values.email) throw new Error("Email required");
  console.log(JSON.stringify(await createLocalAccess(values.email), null, 2));
}
if (["admin-local-access.ts", "admin-local-access.js"].includes(basename(process.argv[1] ?? ""))) {
  main().catch(() => { console.error("LOCAL_ACCESS_REFUSED Check the local mode and allowed email."); process.exit(1); });
}
