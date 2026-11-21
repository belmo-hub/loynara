"use client";

import { useEffect, useReducer, useRef, type KeyboardEvent } from "react";
import { postJson } from "@/components/client-api";

// name and address only show the pick before submit; only the id and the point are sent (Google's terms, P-4).
export type ShopPlace = { id: string; name: string; address: string; latitude: number; longitude: number };
type Suggestion = { id: string; main: string; secondary: string };

/** The picked place's point as the onboarding payload takes it, or null for anything else. */
export function placeCoordinates(body: unknown): { latitude: number; longitude: number } | null {
  const { latitude, longitude } = (body ?? {}) as Record<string, unknown>;
  return typeof latitude === "number" && typeof longitude === "number" && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

type Status = "idle" | "searching" | "shown" | "failed" | "picking" | "pickFailed";
export type SearchState = { text: string; options: Suggestion[]; active: number; open: boolean; status: Status; picking: Suggestion | null };
type SearchEvent = { type: "type"; text: string } | { type: "results"; options: Suggestion[] } | { type: "failed" | "blur" | "focus" | "escape" | "pickFailed" | "picked" }
  | { type: "move"; down: boolean } | { type: "pick"; option: Suggestion };
export const IDLE: SearchState = { text: "", options: [], active: -1, open: false, status: "idle", picking: null };

/** The combobox's states (Design's review of #324): the list closes when focus leaves, a failed pick keeps its options. */
export function searchReducer(state: SearchState, event: SearchEvent): SearchState {
  switch (event.type) {
    case "type": {
      const query = event.text.trim();
      if (query.length < 2) return { ...IDLE, text: event.text };
      return query === state.text.trim() ? { ...state, text: event.text } : { ...state, text: event.text, options: [], active: -1, open: false, status: "searching" };
    }
    case "results": return { ...state, options: event.options, active: -1, open: event.options.length > 0, status: "shown" };
    case "failed": return { ...state, options: [], active: -1, open: false, status: "failed" };
    case "blur": case "escape": return { ...state, open: false };
    case "focus": return { ...state, open: state.options.length > 0 && state.status !== "picking" };
    case "move": {
      const count = state.options.length;
      if (!count) return state;
      // ArrowUp with no row active goes to the last row.
      const active = event.down ? (state.active + 1) % count : state.active < 0 ? count - 1 : (state.active - 1 + count) % count;
      return { ...state, open: true, active };
    }
    case "pick": return { ...state, open: false, status: "picking", picking: event.option };
    case "pickFailed": return { ...state, open: true, status: "pickFailed", picking: null };
    case "picked": return IDLE;
  }
}

/** The one polite live region's line. */
export function searchStatus(state: SearchState) {
  const count = state.options.length;
  return {
    idle: "", searching: "Suche …", picking: "Wird übernommen …",
    shown: count ? `${count} ${count === 1 ? "Vorschlag" : "Vorschläge"}` : "Nichts gefunden. Du kannst auch ohne Standort starten.",
    failed: "Die Suche klappt gerade nicht. Du kannst auch ohne Standort starten.",
    pickFailed: "Der Ort ließ sich gerade nicht übernehmen. Wähl ihn bitte noch einmal.",
  }[state.status];
}

/** Setup's shop search (ENG-323): a combobox over our own place routes; the browser never talks to Google. */
export function ShopSearch({ value, onChange, label = "Dein Geschäft", purpose }: { value: ShopPlace | null; onChange: (place: ShopPlace | null) => void; label?: string; purpose?: string }) {
  const [state, dispatch] = useReducer(searchReducer, IDLE);
  const token = useRef("");
  const query = state.text.trim();

  useEffect(() => {
    if (query.length < 2) return;
    let live = true; // a later keystroke wins over a slower earlier answer
    const timer = setTimeout(() => {
      token.current ||= crypto.randomUUID();
      postJson<{ suggestions: Suggestion[] }>("/api/merchant/place-search", { text: query, sessionToken: token.current }).then(
        ({ suggestions }) => { if (live) dispatch({ type: "results", options: suggestions }); },
        () => { if (live) dispatch({ type: "failed" }); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  async function choose(option: Suggestion) {
    dispatch({ type: "pick", option });
    const point = await postJson("/api/merchant/place-location", { placeId: option.id, sessionToken: token.current }).then(placeCoordinates, () => null);
    if (!point) { dispatch({ type: "pickFailed" }); return; } // the same session may try again
    token.current = ""; // the details call ends Google's session
    dispatch({ type: "picked" });
    onChange({ id: option.id, name: option.main, address: option.secondary, ...point });
    requestAnimationFrame(() => document.getElementById("su-place-picked")?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      dispatch({ type: "move", down: event.key === "ArrowDown" });
    } else if (event.key === "Enter") {
      event.preventDefault(); // Enter here picks a place, it never starts the programme
      if (state.open && state.active >= 0) void choose(state.options[state.active]);
    } else if (event.key === "Escape" && state.open) {
      event.preventDefault();
      dispatch({ type: "escape" });
    }
  }

  if (value) return <div className="ow-field">
    <span className="ow-label">{label}</span>
    <div id="su-place-picked" tabIndex={-1} className="ow-place-picked"><strong>{value.name}</strong>{value.address && <small>{value.address}</small>}<small>Google Maps</small></div>
    <button type="button" className="ow-btn ow-btn--secondary ow-place-change" onClick={() => { onChange(null); requestAnimationFrame(() => document.getElementById("su-place")?.focus()); }}>Ändern</button>
    {purpose && <p className="ow-hint">{purpose}</p>}
  </div>;
  const status = searchStatus(state), busy = state.status === "searching" || state.status === "picking";
  return <div className="ow-field">
    <label htmlFor="su-place">{label} (optional)</label>
    <input id="su-place" className="ow-input" role="combobox" aria-expanded={state.open} aria-controls="su-place-list" aria-autocomplete="list" aria-busy={busy}
      aria-activedescendant={state.open && state.active >= 0 ? `su-place-${state.active}` : undefined} aria-describedby={purpose ? "su-place-purpose su-place-legal" : "su-place-legal"}
      autoComplete="off" placeholder="Name oder Adresse" value={state.text} onChange={event => dispatch({ type: "type", text: event.target.value })} onKeyDown={onKeyDown}
      onBlur={() => dispatch({ type: "blur" })} onFocus={() => dispatch({ type: "focus" })} />
    <ul id="su-place-list" role="listbox" aria-label="Vorschläge" className="ow-options" hidden={!state.open}>
      {state.options.map((option, index) => <li key={option.id} id={`su-place-${index}`} role="option" aria-selected={index === state.active} onMouseDown={event => event.preventDefault()} onClick={() => void choose(option)}>
        <strong>{option.main}</strong>{option.secondary && <small>{option.secondary}</small>}
      </li>)}
      <li role="presentation" className="ow-options-by">Google Maps</li>
    </ul>
    {/* One polite region, always there, so each new line is announced. */}
    <p className="ow-hint ow-place-status" role="status" aria-live="polite">{status && <span key={status}>{state.status === "picking" && state.picking && <strong>{state.picking.main} </strong>}{status}</span>}</p>
    {purpose && <p id="su-place-purpose" className="ow-hint">{purpose}</p>}
    <p id="su-place-legal" className="ow-hint">Die Suche nutzt Google Maps. Es gelten die <a className="ow-link" href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Zusätzlichen Nutzungsbedingungen für Google Maps/Google Earth</a> und die <a className="ow-link" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Datenschutzerklärung von Google</a>.</p>
  </div>;
}
