import type { Metadata, Viewport } from "next";
import { ViewTransition } from "react";
import styles from "./layout.module.css";
import "./kasse-sheet.css";

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
  // The layout mounts once per visit, so the sheet enters from the owner's link (type kasse-sheet) and nowhere else.
  return <ViewTransition enter={{ "kasse-sheet": "kasse-sheet", default: "none" }} exit="none" default="none"><div className={styles.sheet}>{children}</div></ViewTransition>;
}
