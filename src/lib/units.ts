/** Stamps are "stamp" in the database and on owner screens, "stamps" on the card and at the counter. */
export type UnitKind = "stamp" | "stamps" | "points";

// [one, other, other in the dative]. The nominative forms also serve the accusative („für 1 Punkt“, „für 2 Punkte“).
const WORDS = {
  de: { points: ["Punkt", "Punkte", "Punkten"], stamps: ["Stempel", "Stempel", "Stempeln"] },
  fr: { points: ["point", "points", "points"], stamps: ["tampon", "tampons", "tampons"] },
} as const;
// Each language's plural rules decide; French takes the singular for 0 and 1 (« 0 point »).
const RULES = { de: new Intl.PluralRules("de"), fr: new Intl.PluralRules("fr") };

/** The word after a count of stamps or points: „1 Punkt“, „2 Punkte“, „ab 10 Punkten“ (dative), « 0 point ». */
export function unitWord(n: number, kind: UnitKind, locale: "de" | "fr" = "de", grammaticalCase: "nom" | "dat" = "nom") {
  const [one, other, dative] = WORDS[locale][kind === "points" ? "points" : "stamps"];
  return RULES[locale].select(n) === "one" ? one : grammaticalCase === "dat" ? dative : other;
}

/** Keeps every figure on one line with the word after it (the Kasse, Design 18 Nov): „6\u00a0von 8\u00a0Stempeln“. */
export const keepUnits = (text: string) => text.replace(/(\d) /g, "$1\u00a0");

/** The count and its word: „1 Punkt“, „10 Stempeln“, « 1 tampon ». */
export const withUnit = (n: number, kind: UnitKind, locale: "de" | "fr" = "de", grammaticalCase: "nom" | "dat" = "nom") =>
  `${n} ${unitWord(n, kind, locale, grammaticalCase)}`;
