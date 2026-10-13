import type { Metadata } from "next";
import { fraunces, manrope } from "./fonts";
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
      className={`${manrope.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
