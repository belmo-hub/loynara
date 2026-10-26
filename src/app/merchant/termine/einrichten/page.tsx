"use client";

import { BookingSetup } from "@/components/owner/booking-setup";
import { useOwner } from "@/components/owner/owner-context";
import { Notice } from "@/components/owner/owner-ui";

export default function BookingSetupPage() {
  const { me } = useOwner();
  if (!me) return null;
  if (me.role !== "owner") return <div className="ow-page"><Notice tone="warn">Die Einrichtung der Online-Buchung ist Inhaber:innen vorbehalten.</Notice></div>;
  return <BookingSetup />;
}
