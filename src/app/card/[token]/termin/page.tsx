import { CustomerFlow } from "@/components/booking/customer-flow";

export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CustomerFlow token={token} />;
}
