"use client";

import Link from "next/link";
import type { LaunchReadiness, ReadinessStep } from "@/lib/readiness";
import { Notice, OwnerIcon, Skeleton } from "./owner-ui";
import type { Loadable } from "./use-load";

const GROUPS: Array<{ id: ReadinessStep["group"]; title: string; lead: string }> = [
  { id: "setup", title: "Einrichtung", lead: "Was gespeichert ist." },
  { id: "verify", title: "Im Betrieb geprüft", lead: "Was ein echter Ablauf bereits belegt hat." },
  { id: "external", title: "Außerhalb von Loynara", lead: "Bleibt offen, bis es dort geklärt ist. Loynara kann es nicht prüfen." },
];
const STATUS_TEXT: Record<ReadinessStep["status"], string> = { done: "erledigt", todo: "offen", external: "außerhalb von Loynara", not_applicable: "nicht nötig" };

function Mark({ status }: { status: ReadinessStep["status"] }) {
  if (status === "done") return <span className="ow-step-mark" aria-hidden="true"><OwnerIcon name="check" size={16} /></span>;
  if (status === "external") return <span className="ow-step-mark ow-step-mark--external" aria-hidden="true">i</span>;
  if (status === "not_applicable") return <span className="ow-step-mark ow-step-mark--na" aria-hidden="true">–</span>;
  return <span className="ow-step-mark ow-step-mark--todo" aria-hidden="true" />;
}

/**
 * Start-readiness derived on the server from saved data and booked evidence. Nothing here can be ticked off by hand,
 * so a refresh, another device or a second person always sees the same state.
 */
export function ReadinessCard({ readiness, reload, isOwner, compact = false }: { readiness: Loadable<LaunchReadiness>; reload: () => void; isOwner: boolean; compact?: boolean }) {
  if (readiness.state === "idle") return null;
  if (readiness.state === "loading") return <section className="ow-card" aria-busy="true" aria-label="Startklar wird geprüft"><Skeleton height={22} width={200} /><div style={{ marginTop: 12 }}><Skeleton height={96} /></div></section>;
  if (readiness.state === "error") return <Notice tone="warn" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reload}>Erneut laden</button>}>Der Startstatus konnte nicht geladen werden. Das heißt nicht, dass Schritte fehlen.</Notice>;

  const data = readiness.data;
  const next = data.next ? data.steps.find(step => step.id === data.next!.stepId) : undefined;
  const complete = data.requiredDone === data.requiredTotal;
  const openRecommendations = data.steps.filter(step => !step.required && step.status === "todo").length;
  const visibleAction = (step: ReadinessStep) => step.action && (!step.action.ownerOnly || isOwner) ? step.action : undefined;

  const body = (
    <>
      {next && data.next && (
        <div className="ow-action ow-action--lead" style={{ marginBottom: 16 }}>
          <p className="ow-eyebrow" style={{ margin: 0 }}>Nächster Schritt</p>
          <h3>{next.title}</h3>
          <p>{next.evidence} {data.next.reason}</p>
          {visibleAction(next) && <div><Link className="ow-btn ow-btn--sm ow-btn--primary" href={visibleAction(next)!.href}>{visibleAction(next)!.label}</Link></div>}
        </div>
      )}
      {GROUPS.map(group => {
        const steps = data.steps.filter(step => step.group === group.id);
        if (steps.length === 0) return null;
        return (
          <div key={group.id} className="ow-readiness-group">
            <h3>{group.title}</h3><p className="ow-hint" style={{ margin: "0 0 4px" }}>{group.lead}</p>
            <ol className="ow-steps">
              {steps.map(step => {
                const action = visibleAction(step);
                return (
                  <li key={step.id} className="ow-step" data-done={step.status === "done"} data-next={next?.id === step.id}>
                    <Mark status={step.status} />
                    <div>
                      <div className="ow-step-title">{step.title}{step.required && step.status !== "done" && <span className="ow-chip ow-chip--warn" style={{ marginLeft: 8 }}>Pflicht</span>}<span className="ow-sr"> – {STATUS_TEXT[step.status]}</span></div>
                      <div className="ow-step-note">{step.evidence}</div>
                    </div>
                    {action && step.status !== "external" && next?.id !== step.id ? <Link className="ow-btn ow-btn--sm ow-btn--ghost" href={action.href}>{action.label}</Link> : <span />}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </>
  );

  const summary = complete
    ? `Alle ${data.requiredTotal} Pflichtschritte sind belegt${openRecommendations ? `, ${openRecommendations} Empfehlung${openRecommendations === 1 ? "" : "en"} offen` : ""}.`
    : `${data.requiredDone} von ${data.requiredTotal} Pflichtschritten belegt.`;
  if (compact && complete) {
    return (
      <details className="ow-card ow-readiness">
        <summary><strong>Startklar</strong> <span className="ow-muted">{summary}</span></summary>
        <div style={{ marginTop: 12 }}>{body}</div>
      </details>
    );
  }
  return (
    <section className="ow-card ow-readiness" aria-labelledby="ow-ready-title">
      <div className="ow-card-head"><div><h2 id="ow-ready-title">Startklar</h2><p>{summary}</p></div></div>
      {body}
    </section>
  );
}
