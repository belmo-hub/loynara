import { z } from "zod";

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
