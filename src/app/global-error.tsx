"use client";

// Replaces the root layout when it fails, so neither the app stylesheet nor the fonts are loaded here: the colours are
// copied from the design tokens (light and dark) and the type falls back to the system font. Nothing external is fetched.
const css = `
:root { --bg: #EEF0EF; --ink: #17291F; --muted: #58645C; --action: #245D47; --on-action: #FFFFFF; --line: #7A867D; --focus: #2E7D5B; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #0F1713; --ink: #E9EFEA; --muted: #A6B3AA; --action: #9FD3B5; --on-action: #0F1713; --line: #6B7B71; --focus: #9FD3B5; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink); font: 400 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 480px; margin: 0 auto; padding: calc(48px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 40px max(16px, env(safe-area-inset-left)); display: grid; gap: 16px; }
h1 { margin: 0; font: 600 1.75rem/1.15 Georgia, "Times New Roman", serif; letter-spacing: -.015em; text-wrap: balance; }
p { margin: 0; color: var(--muted); }
.actions { display: grid; gap: 12px; margin-top: 8px; }
button { display: inline-flex; align-items: center; justify-content: center; min-height: 56px; padding: 0 24px; border-radius: 999px; font: 700 1.125rem/1 system-ui, -apple-system, sans-serif; text-decoration: none; cursor: pointer; }
button { border: 1.5px solid transparent; background: var(--action); color: var(--on-action); }
button.secondary { border-color: var(--line); background: transparent; color: var(--ink); }
button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
code { font: .875rem ui-monospace, Menlo, monospace; color: var(--ink); overflow-wrap: anywhere; }
small { color: var(--muted); font-size: .875rem; }
`;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="de">
    <head><title>Loynara</title><meta name="viewport" content="width=device-width, initial-scale=1" /><style>{css}</style></head>
    <body>
      <main>
        <h1>Loynara hat gerade ein Problem.</h1>
        <p>Lade die Seite neu. Hilft das nicht, versuch es in ein paar Minuten noch einmal.</p>
        <div className="actions">
          <button type="button" onClick={() => retry()}>Noch einmal versuchen</button>
          {/* A full reload, not a router navigation: the router may be the part that failed. */}
          <button type="button" className="secondary" onClick={() => window.location.reload()}>Seite neu laden</button>
        </div>
        {error.digest ? <small>Fehlercode <code>{error.digest}</code></small> : null}
      </main>
    </body>
  </html>;
}
