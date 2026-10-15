import Link from "next/link";
import { OwnerIcon } from "@/components/owner/owner-ui";
import { buttonClassName } from "@/components/ui/button";
import { SystemState } from "@/components/ui/system-state";

export default function MerchantNotFound() {
  return <div className="ow-page">
    <SystemState icon={<OwnerIcon name="info" size={26} />} title="Diese Seite gibt es nicht."
      actions={<Link href="/merchant" className={buttonClassName({ size: "lg" })}>Zur Übersicht</Link>}>
      Diesen Bereich gibt es in deinem Konto nicht. Über die Übersicht erreichst du alle Bereiche, die du nutzen kannst.
    </SystemState>
  </div>;
}
