import { createHash, createHmac } from "node:crypto";
function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32 || value.startsWith("replace-")) throw new Error("Export proof unavailable");
  return value;
}
export function exportProofToken(challengeId: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(challengeId)) throw new Error("Invalid export challenge");
  return `e_${createHmac("sha256", secret()).update(`loynara-export-proof-v1:${challengeId}`).digest("base64url")}`;
}
export function exportProofHash(token: string): string {
  if (!/^e_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid export proof");
  return createHash("sha256").update(token).digest("hex");
}
export function exportBinding(purpose: "email" | "card", value: string): string {
  return createHmac("sha256", secret()).update(`loynara-export-${purpose}-v1:\0`).update(purpose === "email" ? value.trim().toLowerCase() : value).digest("hex");
}
