"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BookingDay } from "@/components/owner/booking-day";
import { useOwner } from "@/components/owner/owner-context";

export default function MerchantBookingDayPage() {
  const router = useRouter();
  const { me, status } = useOwner();
  const unprovisioned = status === "unprovisioned" || Boolean(me && !me.programSlug);
  useEffect(() => { if (unprovisioned) router.replace("/merchant/program"); }, [unprovisioned, router]);
  if (!me || unprovisioned) return null;
  return <BookingDay />;
}
