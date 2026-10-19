import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { can, type AdminRole } from "@/lib/admin/capabilities";
import { AdminSignOut } from "./forms";
export function AdminShell({ roles, children }: { roles: AdminRole[]; children: ReactNode }) {
  return <div className="ow-page"><header className="ow-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}><Link href="/admin" aria-label="Loynara Konsole"><BrandMark /></Link><AdminSignOut /></header><nav aria-label="Konsole" className="ow-row" style={{ flexWrap: "wrap" }}>{can(roles,"home.view") && <><Link className="ow-btn ow-btn--secondary" href="/admin">Übersicht</Link><Link className="ow-btn ow-btn--secondary" href="/admin/team">Team</Link></>}{(can(roles,"audit.view_all") || can(roles,"audit.view_own")) && <Link className="ow-btn ow-btn--secondary" href="/admin/audit">Protokoll</Link>}</nav><main className="ow-stack" id="admin-main">{children}</main></div>;
}
