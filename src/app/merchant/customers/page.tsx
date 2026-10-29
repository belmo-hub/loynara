"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { CustomersView } from "@/components/owner/customers-view";
import { useOwner } from "@/components/owner/owner-context";

export default function MerchantCustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned" || Boolean(me && !me.programSlug);
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  // Every address change reloads the view, except opening or closing a card: the list stays as it was under it.
  const list = new URLSearchParams(searchParams);
  list.delete("card");
  return <CustomersView key={list.toString()} />;
}
