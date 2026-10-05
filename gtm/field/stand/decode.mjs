// Decodes the QR code in an artwork PNG with zxing, at full resolution and at degraded "camera" resolutions (simulation, not a phone test).
// Usage: node decode.mjs <png> <pxPerMm of the png> <expectedPayload>
import sharp from '../../../node_modules/sharp/dist/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType, BarcodeFormat } = require('../../../node_modules/@zxing/library/cjs/index.js');
const [file, ppm, expected] = process.argv.slice(2);
const reader = new MultiFormatReader();
reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]], [DecodeHintType.TRY_HARDER, true]]));
async function tryDecode(pxPerMm, blur) {
  let img = sharp(file).flatten({ background: '#fff' }).greyscale();
  const meta = await sharp(file).metadata();
  const scale = pxPerMm / Number(ppm);
  img = img.resize(Math.max(8, Math.round(meta.width * scale)), null, { kernel: 'linear' });
  if (blur > 0) img = img.blur(blur);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const lum = new Uint8ClampedArray(info.width * info.height); for (let i = 0; i < lum.length; i++) lum[i] = data[i * info.channels];
  try { const r = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, info.width, info.height)))); return r.getText(); } catch { return null; }
}
const out = [];
for (const [ppmTest, blur] of [[Number(ppm), 0], [6, 0.8], [4, 0.9], [3, 1.0], [2.5, 1.0], [2, 1.0], [1.5, 1.0]]) {
  const t = await tryDecode(ppmTest, blur);
  out.push({ pxPerMm: ppmTest, blur, ok: t === expected });
}
console.log(JSON.stringify(out));
