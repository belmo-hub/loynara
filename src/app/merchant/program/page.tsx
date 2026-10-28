"use client";

import { ProgramList } from "@/components/owner/program-list";
import { ProgramSetup } from "@/components/owner/program-setup";
import { ProgramView } from "@/components/owner/program-view";
import { useOwner } from "@/components/owner/owner-context";

export default function ProgramPage() {
  const { me, status } = useOwner();
  if (status === "unprovisioned") return <ProgramSetup />;
  if (!me) return null;
  return me.role === "owner" ? <ProgramList me={me} /> : <ProgramView me={me} />;
}
