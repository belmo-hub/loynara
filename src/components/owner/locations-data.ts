/** What /api/merchant/locations returns (lib/locations.ts listMerchantLocations), read by the Standorte pages. */
export type Location = {
  id: string; name: string; city: string; country: string; timezone: string; createdAt: string;
  programSlug: string | null; programName: string | null; programType: "stamp" | "points" | null;
  cards: number; awards: number; redemptions: number; activeStaff: number;
};
export type LocationList = { scope: "all_merchant_locations"; currency: "EUR" | "MAD"; totals: { locations: number; cards: number; awards: number; redemptions: number }; locations: Location[]; countingRule: string };

/** „Kaffeekarte · Stempel“: the location's programme as the list has always named it. */
export const programLine = (location: Pick<Location, "programName" | "programType">) =>
  `${location.programName || "Kein aktives Programm"}${location.programType ? ` · ${location.programType === "stamp" ? "Stempel" : "Punkte"}` : ""}`;
