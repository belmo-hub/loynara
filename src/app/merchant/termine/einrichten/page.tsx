"use client";

import { BookingSetup } from "@/components/owner/booking-setup";
import { useOwner } from "@/components/owner/owner-context";
import { Notice, PageHead } from "@/components/owner/owner-ui";

export default function BookingSetupPage() {
  const { me } = useOwner();
  if (!me) return null;
  if (!me.bookingEnabled) return <div className="ow-page"><PageHead title="Termine" /><Notice>Online-Termine sind für diesen Standort nicht eingeschaltet.</Notice></div>;
  // C-R8: the rule sentence, under the page head, in an info notice.
  if (me.role !== "owner") return <div className="ow-page"><PageHead title="Termine einrichten" /><Notice>Nur die Inhaberin oder der Inhaber kann die Online-Termine einrichten.</Notice></div>;
  return <BookingSetup />;
}
