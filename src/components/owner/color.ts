export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(index => { const c = parseInt(hex.slice(index, index + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast of white text on the colour, which is what the Apple pass generator always uses. */
export function whiteContrast(hex: string) { return HEX_COLOR.test(hex) ? 1.05 / (luminance(hex) + 0.05) : 21; }
/** Same rule as the customer browser card: white text when it reaches 4.5:1, otherwise black. */
export function readableInk(hex: string) {
  if (!HEX_COLOR.test(hex)) return "#ffffff";
  return whiteContrast(hex) >= 4.5 ? "#ffffff" : "#000000";
}
