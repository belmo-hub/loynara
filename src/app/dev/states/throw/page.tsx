import { notFound } from "next/navigation";

// Dev-only: throws during render so the real app error boundary (src/app/error.tsx) takes over.
export const dynamic = "force-dynamic";

export default function ThrowPage() {
  if (process.env.NODE_ENV === "production") notFound();
  throw new Error("Absichtlicher Fehler für die Vorschau der Fehlerseite");
}
