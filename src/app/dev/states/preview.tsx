"use client";

import AppError from "@/app/error";
import CashierError from "@/app/cashier/error";
import MerchantError from "@/app/merchant/error";
import "@/components/owner/owner.css";

const sample = Object.assign(new Error("Vorschau"), { digest: "4183092741" });

export function StatesPreview({ kind }: { kind: "app" | "merchant" | "cashier" }) {
  const retry = () => window.location.reload();
  if (kind === "merchant") return <div className="owner-app ly-theme-auto" style={{ minHeight: "100dvh", background: "var(--color-bg)" }}><MerchantError error={sample} retry={retry} /></div>;
  if (kind === "cashier") return <CashierError error={sample} retry={retry} />;
  return <AppError error={sample} retry={retry} />;
}
