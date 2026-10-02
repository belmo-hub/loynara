import Link from "next/link";

export default function MerchantNotFound() {
  return (
    <div className="ow-page" style={{ maxWidth: 560 }}>
      <div className="ow-card ow-stack">
        <h1 style={{ fontSize: 22 }}>Diese Seite gibt es nicht.</h1>
        <p className="ow-muted">Die Adresse ist nicht (mehr) gültig. Über die Übersicht erreichst du alle verfügbaren Bereiche.</p>
        <div><Link className="ow-btn ow-btn--primary" href="/merchant">Zur Übersicht</Link></div>
      </div>
    </div>
  );
}
