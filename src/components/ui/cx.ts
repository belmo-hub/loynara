/** Joins class names, skipping empty values. */
export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
