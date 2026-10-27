import type { Metadata } from "next";

/** The card and its booking page share the per-card manifest (Home-Screen install, Web Push on iOS). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return { manifest: `/card/${encodeURIComponent(token)}/manifest.webmanifest`, icons: { apple: "/card-icon-192.png" } };
}

export default function CardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
