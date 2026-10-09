import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  manifest: "/cashier.webmanifest",
  icons: { apple: "/cashier-icon-192.png" },
  appleWebApp: { capable: true, title: "Loynara Kasse", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#214739",
};

export default function CashierLayout({ children }: LayoutProps<"/cashier">) {
  return <>{children}</>;
}
