import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { platformAdmins } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/loyalty";
import { peerIdentity } from "@/lib/rate-limit";
import { verifyAccessAssertion } from "./access";
import { can, STEP_UP_CAPABILITIES, type AdminRole, type Capability } from "./capabilities";
import { hasSecondFactor } from "./second-factor";
import { hasFreshStepUp, touchAdminSession } from "./session";
export type AdminContext = { userId: string; email: string; sessionId: string; roles: AdminRole[] };
async function checkAdmin(request: Request, capability: Capability, enrollment = false, page = false): Promise<AdminContext> {
  const assertion = await verifyAccessAssertion(request.headers.get("cf-access-jwt-assertion"));
  let adminHost: string;
  try { adminHost = new URL(process.env.ADMIN_ORIGIN ?? "").host; } catch { throw new DomainError("NOT_FOUND", "Not found"); }
  if ((request.headers.get("host") ?? new URL(request.url).host).toLowerCase().replace(/:443$/, "") !== adminHost.toLowerCase().replace(/:443$/, "")) throw new DomainError("NOT_FOUND", "Not found");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  if (assertion.email !== session.user.email.toLowerCase()) throw new DomainError("NOT_FOUND", "Not found");
  const roles = (await db.select({ role: platformAdmins.role }).from(platformAdmins).where(eq(platformAdmins.userId, session.user.id))).map(row => row.role as AdminRole);
  if (!roles.length || !can(roles, capability)) throw new DomainError("NOT_FOUND", "Not found");
  if (!enrollment && !await hasSecondFactor(session.user.id)) throw new DomainError(page ? "TWO_FACTOR_REQUIRED" : "NOT_FOUND", "Not found");
  if (!enrollment) {
    const proof = await db.execute(sql`SELECT id FROM verification WHERE id=${`admin-mfa:${session.session.id}`} AND value=${session.user.id} AND "expiresAt">now()`);
    if (!proof.rows.length) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== process.env.ADMIN_ORIGIN) throw new DomainError("INVALID_ORIGIN", "Request origin not allowed");
  peerIdentity(request);
  const ip = process.env.TRUSTED_INGRESS === "cloudflare_tunnel" ? request.headers.get("cf-connecting-ip") : null;
  if (await touchAdminSession({ sessionId: session.session.id, userId: session.user.id, sessionCreatedAt: session.session.createdAt, roles, ip, userAgent: request.headers.get("user-agent") }) === "expired") throw new DomainError("UNAUTHENTICATED", "Sign in required");
  if (STEP_UP_CAPABILITIES.has(capability) && !await hasFreshStepUp(session.session.id)) throw new DomainError("STEP_UP_REQUIRED", "Anmeldung erneut bestätigen");
  return { userId: session.user.id, email: session.user.email, sessionId: session.session.id, roles };
}
export async function requireAdmin(request: Request, capability: Capability): Promise<AdminContext> {
  return checkAdmin(request, capability);
}
async function pageContext(capability: Capability, path: string, enrollment: boolean): Promise<AdminContext> {
  try {
    return await checkAdmin(new Request(new URL(path, process.env.ADMIN_ORIGIN ?? "http://invalid"), { headers: await headers() }), capability, enrollment, true);
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "UNAUTHENTICATED") redirect("/admin/sign-in");
      if (error.code === "TWO_FACTOR_REQUIRED") redirect("/admin/two-factor");
      if (error.code === "STEP_UP_REQUIRED") redirect(`/admin/step-up?next=${encodeURIComponent(path)}`);
    }
    notFound();
  }
}
export async function requireAdminPage(capability: Capability, path = "/admin"): Promise<AdminContext> {
  return pageContext(capability, path, false);
}
export async function requireAdminEnrollmentPage(): Promise<AdminContext> {
  return pageContext("home.view", "/admin/two-factor", true);
}

export async function requireAdminEnrollment(request: Request): Promise<AdminContext> {
  return checkAdmin(request, "home.view", true);
}
