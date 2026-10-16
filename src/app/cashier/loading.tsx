import { CashierAccessState } from "@/components/cashier/cashier-view";

// Same dark frame the page itself shows while it checks access, so the counter never flashes a light page.
export default function CashierLoading() {
  return <CashierAccessState state="loading" message="" />;
}
