/** The card's QR image URL. One builder for the server's first paint (card-first-paint.ts) and the card itself, so both
 *  draw the very same image and the swap from placeholder to card shows no change. */
export const cardQrSrc = (scanCode: string) => `/api/qr?value=${encodeURIComponent(scanCode)}`;
