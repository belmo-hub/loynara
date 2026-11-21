"use client";

import { useEffect, useReducer, useRef, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
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
      // The shown options stay until the next answer swaps them: the list never collapses while typing.
      return query === state.text.trim() ? { ...state, text: event.text } : { ...state, text: event.text, active: -1, status: "searching" };
    }
    case "results": return { ...state, options: event.options, active: -1, open: event.options.length > 0, status: "shown" };
    case "failed": return { ...state, options: [], active: -1, open: false, status: "failed" };
    case "blur": return { ...state, open: false };
    case "escape": return { ...state, open: false, active: -1 };
    case "focus": return { ...state, open: state.options.length > 0 && state.status !== "picking" };
    case "move": {
      const count = state.options.length;
      if (!count) return state;
      // ArrowUp with no row active goes to the last row.
      const active = event.down ? (state.active + 1) % count : state.active < 0 ? count - 1 : (state.active - 1 + count) % count;
      return { ...state, open: true, active };
    }
    case "pick": return { ...state, open: false, status: "picking", picking: event.option };
    case "pickFailed": return { ...state, open: true, active: -1, status: "pickFailed", picking: null };
    case "picked": return IDLE;
  }
}

/** The one polite live region's line. `fallback` is the caller's way on when the search gives nothing. A count is only
 *  said while the list is open. */
export function searchStatus(state: SearchState, fallback = "Du kannst auch ohne Standort starten.") {
  const count = state.options.length;
  return {
    idle: "", searching: "Suche …", picking: `${state.picking?.main ?? ""} wird übernommen …`.trim(),
    shown: !count ? `Nichts gefunden. ${fallback}` : state.open ? `${count} ${count === 1 ? "Vorschlag" : "Vorschläge"}` : "",
    failed: `Die Suche klappt gerade nicht. ${fallback}`,
    pickFailed: "Der Ort ließ sich gerade nicht übernehmen. Wähl ihn bitte noch einmal.",
  }[state.status];
}

/** Only the latest search or pick may land (Design: a late answer must not reach another shop's sheet). */
export function latestOnly() {
  let current = 0;
  return { next: () => { const mine = ++current; return () => mine === current; }, cancel: () => { current++; } };
}

/** Setup's shop search (ENG-323): a combobox over our own place routes; the browser never talks to Google. */
export function ShopSearch({ value, onChange, label, pickedLabel = label, purpose, fallback, inputClassName = "ow-input" }: {
  value: ShopPlace | null; onChange: (place: ShopPlace | null) => void; label: string; pickedLabel?: string; purpose?: string; fallback?: string; inputClassName?: string;
}) {
  const [state, dispatch] = useReducer(searchReducer, IDLE);
  const token = useRef("");
  const latest = useRef(latestOnly());
  const query = state.text.trim();

  useEffect(() => {
    if (query.length < 2) return;
    const live = latest.current.next(); // a later keystroke or pick wins over a slower earlier answer
    const timer = setTimeout(() => {
      token.current ||= crypto.randomUUID();
      postJson<{ suggestions: Suggestion[] }>("/api/merchant/place-search", { text: query, sessionToken: token.current }).then(
        ({ suggestions }) => { if (live()) dispatch({ type: "results", options: suggestions }); },
        () => { if (live()) dispatch({ type: "failed" }); });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { const searches = latest.current; return () => searches.cancel(); }, []); // nothing lands after unmount
  useEffect(() => { if (state.active >= 0) document.getElementById(`su-place-${state.active}`)?.scrollIntoView({ block: "nearest" }); }, [state.active]);

  async function choose(option: Suggestion) {
    const live = latest.current.next();
    dispatch({ type: "pick", option });
    const point = await postJson("/api/merchant/place-location", { placeId: option.id, sessionToken: token.current }).then(placeCoordinates, () => null);
    if (!live()) return;
    if (!point) { dispatch({ type: "pickFailed" }); return; } // the same session may try again
    token.current = ""; // the details call ends Google's session
    // Committed now, so the picked block exists to take focus (WebKit ran a frame callback before the commit).
    flushSync(() => { dispatch({ type: "picked" }); onChange({ id: option.id, name: option.main, address: option.secondary, ...point }); });
    document.getElementById("su-place-picked")?.focus();
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
    <span className="ow-label">{pickedLabel}</span>
    <div id="su-place-picked" tabIndex={-1} className="ow-place-picked"><strong>{value.name}</strong>{value.address && <small>{value.address}</small>}<small>Google Maps</small></div>
    {purpose && <p className="ow-hint">{purpose}</p>}
    <button type="button" className="ow-btn ow-btn--secondary ow-place-change" onClick={() => { onChange(null); requestAnimationFrame(() => document.getElementById("su-place")?.focus()); }}>Ändern</button>
  </div>;
  const status = searchStatus(state, fallback), busy = state.status === "searching" || state.status === "picking";
  return <div className="ow-field">
    <label htmlFor="su-place">{label}</label>
    <input id="su-place" className={inputClassName} role="combobox" aria-expanded={state.open} aria-controls="su-place-list" aria-autocomplete="list" aria-busy={busy}
      aria-activedescendant={state.open && state.active >= 0 ? `su-place-${state.active}` : undefined} aria-describedby={purpose ? "su-place-purpose su-place-legal" : "su-place-legal"}
      autoComplete="off" placeholder="Name oder Adresse" value={state.text} onChange={event => dispatch({ type: "type", text: event.target.value })} onKeyDown={onKeyDown}
      onBlur={() => dispatch({ type: "blur" })} onFocus={() => dispatch({ type: "focus" })} />
    {/* A press anywhere in the box keeps focus in the field; Google's attribution stays outside the scrolling list (P-2). */}
    <div className="ow-options" hidden={!state.open} onMouseDown={event => event.preventDefault()}>
      <ul id="su-place-list" role="listbox" aria-label="Vorschläge" tabIndex={-1}>
        {state.options.map((option, index) => <li key={option.id} id={`su-place-${index}`} role="option" aria-selected={index === state.active} onClick={() => void choose(option)}>
          <strong>{option.main}</strong>{option.secondary && <small>{option.secondary}</small>}
        </li>)}
      </ul>
      <p className="ow-options-by">Google Maps</p>
    </div>
    {/* One polite region, always there, so each new line is announced; the count is for screen readers only. */}
    <p className="ow-hint ow-place-status" role="status" aria-live="polite">{status && <span key={status} className={state.status === "shown" && state.open ? "ow-sr" : undefined} data-alert={state.status === "failed" || state.status === "pickFailed" || undefined}>{status}</span>}</p>
    {purpose && <p id="su-place-purpose" className="ow-hint">{purpose}</p>}
    <p id="su-place-legal" className="ow-hint">Die Suche nutzt Google Maps. Es gelten die <a className="ow-link" href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Zusätzlichen Nutzungsbedingungen für Google Maps/Google Earth</a> und die <a className="ow-link" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Datenschutzerklärung von Google</a>.</p>
  </div>;
}
