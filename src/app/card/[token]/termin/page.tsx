import type { Metadata } from "next";
import { db } from "@/db";
import { CustomerFlow } from "@/components/booking/customer-flow";
import { cardScope } from "@/lib/booking/appointments";

/** Design r3: the tab and history name the shop's booking page, not the marketing title (WCAG 2.4.2). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const shop = await cardScope(db, token).then(card => card.shopName, () => null);
  return { title: shop ? `Termin buchen – ${shop}` : "Termin buchen" };
}

export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CustomerFlow token={token} />;
}
