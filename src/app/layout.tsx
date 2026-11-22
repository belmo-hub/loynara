import type { Metadata } from "next";
import { manrope } from "./fonts";
import "../styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loynara – digitale Treuekarten für deinen Tresen",
  description: "Ein digitales Stempel- oder Punkteprogramm für lokale Geschäfte. Browserkarte mit bewusst bestätigten Kassenbuchungen.",
  robots: { index: false, follow: false },
  // Android Chrome then scales 1rem with the phone's text size setting; type is in rem and no root size is set.
  other: { "text-scale": "scale" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      // globals.css scrolls smoothly; Next.js 16 keeps that for its own navigation scroll unless told otherwise.
      data-scroll-behavior="smooth"
      className={`${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
