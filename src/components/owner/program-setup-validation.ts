import { z } from "zod";
import type { ShopPlace } from "./shop-search";

type ReviewFields = { programName: string; date: string };

/** Validate review fields before posting them to the existing merchant API. */
export function setupReviewValidation(input: ReviewFields) {
  const name = input.programName.trim();
  return {
    problems: {
      programName: name.length >= 2 && name.length <= 180 ? "" : "Bitte einen Programmnamen mit 2 bis 180 Zeichen eingeben.",
      date: z.iso.date().safeParse(input.date).success ? "" : "Bitte ein gültiges Startdatum eingeben.",
    },
  };
}

/** The location part of the setup payload. The name is the owner's own; from a shop-search pick only the place id and the point
 *  go along, never Google's name or address (Google's terms, P-4). */
export function setupLocation(f: { city: string; locationName: string; place: ShopPlace | null }, draft: { city?: string } | null, placeOffered: boolean) {
  // One shop names its location after the city; a second location is named where it is added (ENG-322).
  const locationName = (f.city.trim() === (draft?.city ?? "").trim() && f.locationName.trim()) || f.city.trim();
  return { locationName, ...(placeOffered && f.place ? { latitude: f.place.latitude, longitude: f.place.longitude, googlePlaceId: f.place.id } : {}) };
}
