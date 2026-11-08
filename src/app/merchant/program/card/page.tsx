"use client";

import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { type PublicProgram } from "@/components/client-api";
import { CardStudio, type Brand } from "@/components/owner/card-studio";
import { useOwner } from "@/components/owner/owner-context";
import { GuardedLink } from "@/components/owner/owner-shell";
import { Notice, Skeleton } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

export default function CardStudioPage() {
  const { me } = useOwner();
  const slug = me ? encodeURIComponent(me.programSlug) : null;
  const isOwner = me?.role === "owner";
  const [brand, reloadBrand] = useLoad<Brand>(isOwner && slug ? `/api/merchant/program/brand?programSlug=${slug}` : null);
  const [program, reloadProgram] = useLoad<PublicProgram>(isOwner && slug ? `/api/program/${slug}` : null);
  const [, setVersion] = useState(0);
  if (!me) return null;
  // A Programm row's page (Design, 28 Oct): back to the list instead of an eyebrow; the page keeps its own save bar.
  const head = <header className="ow-pagehead"><div><GuardedLink href="/merchant/program" className="ow-back"><ChevronLeft size={20} aria-hidden="true" />Programm</GuardedLink><h1>Kundenkarte</h1><p>{me.hiddenSurfaces?.includes("walletPreviews") ? "Gestalte, wie deine Karte im Browser aussieht." : "Gestalte, wie deine Karte im Browser und in den Wallets aussieht."} Nichts wird gespeichert, bis du es bestätigst.</p></div></header>;
  if (!isOwner) return <div className="ow-page">{head}<Notice>Die Kundenkarte kann nur von Inhaber:innen gestaltet werden.</Notice></div>;
  if (brand.state === "error" || program.state === "error") {
    return <div className="ow-page">{head}<Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => { reloadBrand(); reloadProgram(); }}>Erneut laden</button>}>{brand.state === "error" ? brand.message : program.state === "error" ? program.message : ""}</Notice></div>;
  }
  if (brand.state !== "ok" || program.state !== "ok") return <div className="ow-page">{head}<Skeleton height={420} /></div>;
  return <div className="ow-page">{head}<CardStudio me={me} program={program.data} initial={brand.data} onSaved={() => setVersion(value => value + 1)} /></div>;
}
