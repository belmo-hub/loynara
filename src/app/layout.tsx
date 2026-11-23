import type { Metadata, Viewport } from "next";
import { manrope } from "./fonts";
import "../styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loynara – digitale Treuekarten für deinen Tresen",
  description: "Ein digitales Stempel- oder Punkteprogramm für lokale Geschäfte. Browserkarte mit bewusst bestätigten Kassenbuchungen.",
  robots: { index: false, follow: false },
};

// The browser bar takes the page ground, --color-bg in each theme (Design 36c).
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#EEF0EF" }, { media: "(prefers-color-scheme: dark)", color: "#0F1713" }],
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
