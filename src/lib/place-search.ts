import { z } from "zod";

/**
 * The shop search in setup (ENG-323): Google Places API (New), called from our server only. Google gets the typed text
 * and the browser's session token, never the owner's IP, account or shop data. Offered only with GOOGLE_MAPS_API_KEY
 * (the "shopSearch" surface in lib/pilot-surfaces). null means Google failed; the caller says so calmly.
 */
type Env = Readonly<Record<string, string | undefined>>;
const PLACES = "https://places.googleapis.com/v1";

// A browser UUID; Google bills autocomplete and the one details call as one session.
export const sessionToken = z.string().regex(/^[A-Za-z0-9-]{16,36}$/);
export const placeId = z.string().regex(/^[A-Za-z0-9_-]{1,300}$/);

const text = z.object({ text: z.string() });
const suggestions = z.object({ suggestions: z.array(z.object({ placePrediction: z.object({ placeId, structuredFormat: z.object({ mainText: text, secondaryText: text.optional() }) }).optional() })).default([]) });
const location = z.object({ location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }) });

async function places(http: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  try {
    const response = await http(url, { ...init, signal: AbortSignal.timeout(5_000) });
    if (response.ok) return await response.json();
    console.warn(`Google Places answered ${response.status}`); // the status only: never the text or the user
  } catch { console.warn("Google Places unreachable"); }
  return null;
}

export async function placeSuggestions(input: string, token: string, env: Env = process.env, http: typeof fetch = fetch) {
  const body = await places(http, `${PLACES}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY ?? "", "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat" },
    body: JSON.stringify({ input, sessionToken: token, includedRegionCodes: ["de"], regionCode: "de", languageCode: "de" }),
  });
  const parsed = suggestions.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.suggestions.flatMap(({ placePrediction: p }) => p ? [{ id: p.placeId, main: p.structuredFormat.mainText.text, secondary: p.structuredFormat.secondaryText?.text ?? "" }] : []).slice(0, 5);
}

/** Place Details with the field mask `location` only: the cheapest SKU, and nothing about the place is kept but its point. */
export async function placeLocation(id: string, token: string | undefined, env: Env = process.env, http: typeof fetch = fetch) {
  const body = await places(http, `${PLACES}/places/${encodeURIComponent(id)}${token ? `?sessionToken=${encodeURIComponent(token)}` : ""}`, {
    headers: { "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY ?? "", "X-Goog-FieldMask": "location" },
  });
  const parsed = location.safeParse(body);
  return parsed.success ? parsed.data.location : null;
}
