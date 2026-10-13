import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import { DesignGallery } from "./gallery";

export const metadata: Metadata = { title: "Gestaltung – Vorschau", robots: { index: false, follow: false } };

/** Development-only catalogue of tokens and primitives. Not reachable in production. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AuthShell width="reading"><DesignGallery /></AuthShell>;
}
