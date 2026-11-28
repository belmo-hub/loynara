"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BookingDay } from "@/components/owner/booking-day";
import { useOwner } from "@/components/owner/owner-context";
import { Notice, PageHead } from "@/components/owner/owner-ui";

export default function MerchantBookingDayPage() {
  const router = useRouter();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned" || Boolean(me && !me.programSlug);
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  // Design, 22 Nov: without the operator's switch there is no day view and no wizard to reach.
  if (!me.bookingShown) return <div className="ow-page"><PageHead title="Termine" /><Notice>Online-Termine sind für diesen Standort nicht eingeschaltet.</Notice></div>;
  return <BookingDay readOnly={!me.bookingEnabled} />;
}
