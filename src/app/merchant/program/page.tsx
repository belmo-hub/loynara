"use client";

import { ProgramSetup } from "@/components/owner/program-setup";
import { ProgramView } from "@/components/owner/program-view";
import { useOwner } from "@/components/owner/owner-context";

export default function ProgramPage() {
  const { me, status } = useOwner();
  if (status === "unprovisioned" || (me && !me.programSlug)) return <ProgramSetup />;
  if (!me) return null;
  return <ProgramView me={me} />;
}
