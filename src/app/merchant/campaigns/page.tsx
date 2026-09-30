"use client";

import { CampaignsView } from "@/components/owner/campaigns-view";
import { useOwner } from "@/components/owner/owner-context";
import { Notice } from "@/components/owner/owner-ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MerchantCampaignsPage() {
  const router = useRouter();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned" || Boolean(me && !me.programSlug);
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  if (me.role !== "owner") return <div className="ow-page"><Notice tone="warn" role="alert">Nur Inhaber:innen können Kampagnen verwalten.</Notice></div>;
  return <CampaignsView />;
}
