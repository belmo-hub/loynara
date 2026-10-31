/** The characters the generated initial can draw (Manrope ExtraBold outlines in logo-initial.ts). */
export const INITIAL_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789";

/**
 * The shop's initial, the same for Google's circle and the studio preview: the first drawable letter (an accent folds to
 * its base letter unless the letter is drawn as it is), else the first digit, else "" when nothing can be drawn.
 */
export function initialOf(name: string): string {
  const drawable = Array.from(name.toUpperCase(), c => INITIAL_CHARACTERS.includes(c) ? c : c.normalize("NFD").charAt(0))
    .filter(c => INITIAL_CHARACTERS.includes(c));
  return drawable.find(c => /\D/.test(c)) ?? drawable[0] ?? "";
}
