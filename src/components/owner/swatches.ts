/** The house brand colours with their names, for the card studio and the demo form. */
export const SWATCHES: Array<{ name: string; hex: string }> = [
  { name: "Waldgrün", hex: "#1F4A3A" }, { name: "Salbei", hex: "#2F6B58" }, { name: "Terrakotta", hex: "#A8492C" },
  { name: "Nachtblau", hex: "#2B4A66" }, { name: "Pflaume", hex: "#6B3A6F" }, { name: "Graphit", hex: "#23282B" }, { name: "Senf", hex: "#C99A2E" },
];

export const swatchName = (hex: string) => SWATCHES.find(swatch => swatch.hex.toLowerCase() === hex.toLowerCase())?.name;
