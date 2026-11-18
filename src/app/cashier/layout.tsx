import type { Metadata, Viewport } from "next";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  // The tab and the task switcher name the Kasse, in the words its home-screen icon already carries.
  title: "Loynara Kasse",
  manifest: "/cashier.webmanifest",
  icons: { apple: "/cashier-icon-192.png" },
  appleWebApp: { capable: true, title: "Loynara Kasse", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#214739",
};

export default function CashierLayout({ children }: LayoutProps<"/cashier">) {
  return <><div className={styles.dim} aria-hidden="true" /><div className={styles.sheet}>{children}</div></>;
}
