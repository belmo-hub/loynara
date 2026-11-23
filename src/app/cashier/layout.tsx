import type { Metadata, Viewport } from "next";
import styles from "./layout.module.css";
import "./kasse-sheet.css";
import { KasseSheetFrame } from "./kasse-sheet-frame";

export const metadata: Metadata = {
  // The tab and the task switcher name the Kasse, in the words its home-screen icon already carries.
  title: "Loynara Kasse",
  manifest: "/cashier.webmanifest",
  icons: { apple: "/cashier-icon-192.png" },
  appleWebApp: { capable: true, title: "Loynara Kasse", statusBarStyle: "black" },
};

// The Kasse is always dark: the bars, the splash and the first paint take the dark --color-bg (Design 36c).
export const viewport: Viewport = {
  themeColor: "#0F1713",
  colorScheme: "dark",
};

export default function CashierLayout({ children }: LayoutProps<"/cashier">) {
  // The layout mounts once per visit, so the sheet enters from the owner's link (type kasse-sheet) and nowhere else.
  return <KasseSheetFrame className={styles.sheet}>{children}</KasseSheetFrame>;
}
