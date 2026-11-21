"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { postJson } from "@/components/client-api";

// name and address only show the pick before submit; only the id and the point are sent (Google's terms, P-4).
export type ShopPlace = { id: string; name: string; address: string; latitude: number; longitude: number };
type Suggestion = { id: string; main: string; secondary: string };

/** The picked place's point as the onboarding payload takes it, or null for anything else. */
export function placeCoordinates(body: unknown): { latitude: number; longitude: number } | null {
  const { latitude, longitude } = (body ?? {}) as Record<string, unknown>;
  return typeof latitude === "number" && typeof longitude === "number" && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

/** The console's point fields (ENG-331): a pick fills in its point; a hand edit drops the pick, so it is never saved as Google's with the clock. */
export const pickedPoint = (place: ShopPlace | null) => ({ place, coordinates: place ? `${place.latitude.toFixed(7)}, ${place.longitude.toFixed(7)}` : "" });
export const handTypedPoint = (coordinates: string) => ({ place: null, coordinates });

/** Setup's shop search (ENG-323): a combobox over our own place routes; the browser never talks to Google. */
export function ShopSearch({ value, onChange, label = "Dein Geschäft" }: { value: ShopPlace | null; onChange: (place: ShopPlace | null) => void; label?: string }) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);
  const token = useRef("");
  const open = options.length > 0;

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) return;
    let live = true; // a later keystroke wins over a slower earlier answer
    const timer = setTimeout(() => {
      token.current ||= crypto.randomUUID();
      postJson<{ suggestions: Suggestion[] }>("/api/merchant/place-search", { text: query, sessionToken: token.current }).then(
        ({ suggestions }) => { if (live) { setOptions(suggestions); setActive(-1); setFailed(false); } },
        () => { if (live) { setOptions([]); setFailed(true); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);

  async function choose(option: Suggestion) {
    setOptions([]);
    const point = await postJson("/api/merchant/place-location", { placeId: option.id, sessionToken: token.current }).then(placeCoordinates, () => null);
    token.current = ""; // the details call ends Google's session
    setFailed(!point);
    if (point) { setText(""); onChange({ id: option.id, name: option.main, address: option.secondary, ...point }); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && open) {
      event.preventDefault();
      setActive(index => (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault(); // Enter here picks a place, it never starts the programme
      if (open && active >= 0) void choose(options[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOptions([]);
    }
  }

  if (value) return <div className="ow-field"><span className="ow-label">{label}</span>
    <p><strong>{value.name}</strong>{value.address && <><br />{value.address}</>}</p>
    <button type="button" className="ow-btn ow-btn--secondary" onClick={() => { onChange(null); requestAnimationFrame(() => document.getElementById("su-place")?.focus()); }}>Ändern</button>
  </div>;
  return <div className="ow-field">
    <label htmlFor="su-place">{label} (optional)</label>
    <input id="su-place" className="ow-input" role="combobox" aria-expanded={open} aria-controls="su-place-list" aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `su-place-${active}` : undefined}
      autoComplete="off" placeholder="Name oder Adresse" value={text} onChange={event => { setText(event.target.value); if (event.target.value.trim().length < 2) setOptions([]); }} onKeyDown={onKeyDown} />
    <ul id="su-place-list" role="listbox" aria-label="Vorschläge" className="ow-options" hidden={!open}>
      {options.map((option, index) => <li key={option.id} id={`su-place-${index}`} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onClick={() => void choose(option)}>
        <strong>{option.main}</strong>{option.secondary && <small>{option.secondary}</small>}
      </li>)}
      <li role="presentation" className="ow-options-by">Google Maps</li>
    </ul>
    {failed && <p className="ow-hint" role="status">Die Suche klappt gerade nicht. Du kannst auch ohne Standort starten.</p>}
    <p className="ow-hint">Die Suche nutzt Google Maps. Es gelten die <a className="ow-link" href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Zusätzlichen Nutzungsbedingungen für Google Maps/Google Earth</a> und die <a className="ow-link" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Datenschutzerklärung von Google</a>.</p>
  </div>;
}
