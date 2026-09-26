import Link from "next/link";
import { BrandMark, Icon } from "./loyalty-ui";
import type { ReactNode } from "react";

export function AuthFrame({ eyebrow, title, description, children, footer }: { eyebrow: string; title: string; description: string; children: ReactNode; footer: ReactNode }) {
  return <main className="auth-page"><div className="auth-side"><Link href="/" aria-label="Loynara Startseite"><BrandMark /></Link><div className="auth-side-copy"><span className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> DEIN GESCHÄFT. DEIN PROGRAMM.</span><h2>Gute Besuche verdienen eine Fortsetzung.</h2><p>Ein klarer Weg von der Anmeldung über die Karte bis zur bestätigten Buchung am Tresen.</p><div className="auth-side-points"><span><Icon name="check" size={17} /> Für dein Team übersichtlich</span><span><Icon name="check" size={17} /> Für Gäste ohne App</span><span><Icon name="check" size={17} /> Vorgänge nachvollziehbar</span></div></div><small>Loynara · Produktvorschau</small></div><div className="auth-content"><div className="auth-card"><span className="eyebrow"><span className="eyebrow-dot" /> {eyebrow}</span><h1>{title}</h1><p>{description}</p>{children}<div className="auth-footer">{footer}</div></div></div></main>;
}
