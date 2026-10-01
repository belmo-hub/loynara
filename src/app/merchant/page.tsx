"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Overview } from "@/components/owner/overview";
import { useOwner } from "@/components/owner/owner-context";

export default function MerchantPage() {
  const router = useRouter();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned";
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  return <Overview />;
}
