import { z } from "zod";

type ReviewFields = { programName: string; date: string; latitude: string; longitude: string };

/** Validate review fields before posting numbers/dates to the existing merchant API. */
export function setupReviewValidation(input: ReviewFields) {
  const name = input.programName.trim();
  const parseCoordinate = (raw: string) => {
    const text = raw.trim();
    if (!text) return undefined;
    if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return NaN;
    return Number(text.replace(",", "."));
  };
  const latitude = parseCoordinate(input.latitude);
  const longitude = parseCoordinate(input.longitude);
  const problems = {
    programName: name.length >= 2 && name.length <= 180 ? "" : "Bitte einen Programmnamen mit 2 bis 180 Zeichen eingeben.",
    date: z.iso.date().safeParse(input.date).success ? "" : "Bitte ein gültiges Startdatum eingeben.",
    latitude: latitude === undefined || (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) ? "" : "Bitte einen Breitengrad zwischen −90 und 90 eingeben.",
    longitude: longitude === undefined || (Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) ? "" : "Bitte einen Längengrad zwischen −180 und 180 eingeben.",
  };
  if (latitude === undefined && longitude !== undefined) problems.latitude = "Bitte beide Koordinaten eingeben oder beide freilassen.";
  if (longitude === undefined && latitude !== undefined) problems.longitude = "Bitte beide Koordinaten eingeben oder beide freilassen.";
  const coordinates: { latitude?: number; longitude?: number } = {};
  if (!problems.latitude && !problems.longitude && latitude !== undefined && longitude !== undefined) {
    coordinates.latitude = latitude;
    coordinates.longitude = longitude;
  }
  return { problems, coordinates };
}
