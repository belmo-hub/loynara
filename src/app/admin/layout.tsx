import type { ReactNode } from "react";
import "@/components/owner/owner.css";
export const dynamic = "force-dynamic";
export default function AdminLayout({ children }: { children: ReactNode }) { return <div className="owner-app ly-theme-auto" style={{ minHeight: "100vh", paddingBottom: 48 }}>{children}</div>; }
