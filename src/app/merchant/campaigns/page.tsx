"use client";

import { CampaignsView } from "@/components/owner/campaigns-view";
import { useOwner } from "@/components/owner/owner-context";
import { BackToActions } from "@/components/owner/actions-list";
import { Notice, PageHead } from "@/components/owner/owner-ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MerchantCampaignsPage() {
  const router = useRouter();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned" || Boolean(me && !me.programSlug);
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  if (me.role !== "owner") return <div className="ow-page"><PageHead back={<BackToActions />} title="Kampagnen" lead="Wähle ein Ziel, prüfe die Zielgruppe und speichere einen Entwurf. Nichts wird automatisch versendet." /><Notice>Nur Inhaber:innen können Kampagnen verwalten.</Notice></div>;
  return <CampaignsView />;
}
