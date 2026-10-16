import { notFound } from "next/navigation";
import { StatesPreview } from "./preview";

// Dev-only: the error boundaries rendered with a sample code, one per visit (?kind=app|merchant|cashier).
export default async function StatesPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { kind } = await searchParams;
  return <StatesPreview kind={kind === "merchant" || kind === "cashier" ? kind : "app"} />;
}
