"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { CustomersView } from "@/components/owner/customers-view";
import { JoinCard } from "@/components/owner/join-card";
import { useOwner } from "@/components/owner/owner-context";

export default function MerchantCustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned" || Boolean(me && !me.programSlug);
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  // ENG-085: the invite link and the Tresenschild left the Übersicht; here they stay one tap away for owner and Leitung.
  return <><CustomersView key={searchParams.toString()} /><div className="ow-page"><JoinCard me={me} /></div></>;
}
