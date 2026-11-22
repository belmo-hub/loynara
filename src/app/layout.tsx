import type { Metadata } from "next";
import { TRUSTED_TYPES_POLICY } from "@/lib/trusted-types-policy";
import { manrope } from "./fonts";
import "../styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loynara – digitale Treuekarten für deinen Tresen",
  description: "Ein digitales Stempel- oder Punkteprogramm für lokale Geschäfte. Browserkarte mit bewusst bestätigten Kassenbuchungen.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      // globals.css scrolls smoothly; Next.js 16 keeps that for its own navigation scroll unless told otherwise.
      data-scroll-behavior="smooth"
      className={`${manrope.variable} h-full antialiased`}
    >
      {/* Parsed and run before any Next.js code (lib/trusted-types-policy.ts). */}
      <head><script dangerouslySetInnerHTML={{ __html: TRUSTED_TYPES_POLICY }} /></head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
