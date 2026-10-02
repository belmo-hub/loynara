import Link from "next/link";
import { BrandMark } from "@/components/loyalty-ui";

export default function NotFound() {
  return (
    <main className="app-state-page">
      <div className="app-state-card">
        <BrandMark />
        <h1>Diese Seite gibt es nicht.</h1>
        <p>Die Adresse ist nicht (mehr) gültig.</p>
        <Link className="button button--ink" href="/login">Zur Anmeldung</Link>
      </div>
    </main>
  );
}
