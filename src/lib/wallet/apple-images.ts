import { crc32, deflateSync } from "node:zlib";

// The Apple pass images (ENG-119), drawn in points and written by the small PNG encoder below: no image library, no
// fonts, no text. No customer data enters an image; the strip only repeats the balance the text fields state.

type Rgb = readonly number[];
/** A bounding box in points and a signed distance in points: positive inside the shape, negative outside. */
type Shape = { box: readonly number[]; inside: (x: number, y: number) => number };
type Layer = readonly [Rgb, Shape];

const PAPER: Rgb = [0xf4, 0xf5, 0xf3], CORAL: Rgb = [0xe9, 0x89, 0x5f], CORAL_EDGE: Rgb = [0xc9, 0x66, 0x3c];
const OPEN: Rgb = [0x8c, 0x96, 0x91], TRACK: Rgb = [0xdc, 0xe1, 0xde], WHITE: Rgb = [255, 255, 255];

const disk = (cx: number, cy: number, r: number): Shape => ({
  box: [cx - r, cy - r, cx + r, cy + r], inside: (x, y) => r - Math.sqrt((x - cx) ** 2 + (y - cy) ** 2),
});

/** A ring of `width` centred on radius r; with `dashes`, that many dashes, each filling half of its step. */
function ring(cx: number, cy: number, r: number, width: number, dashes = 0): Shape {
  const half = width / 2, step = (2 * Math.PI) / dashes;
  return {
    box: [cx - r - half, cy - r - half, cx + r + half, cy + r + half],
    inside: (x, y) => {
      const band = half - Math.abs(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r);
      if (!dashes) return band;
      const turn = Math.atan2(y - cy, x - cx) / step;
      return Math.min(band, (step / 4 - Math.abs(turn - Math.round(turn)) * step) * r);
    },
  };
}

/** A line from a to b with round ends of radius r: the bar, its fill and the strokes of the check. */
function capsule(ax: number, ay: number, bx: number, by: number, r: number): Shape {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy || 1;
  return {
    box: [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r],
    inside: (x, y) => {
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / length));
      return r - Math.sqrt((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2);
    },
  };
}

/** The pressed stamp's white check, in the mock-up's proportions (design/2026-10-28-native-apple-pass/gen_pass.py). */
function check(cx: number, cy: number, r: number): Shape {
  const half = Math.max(2, r * 0.16) / 2, mx = cx - 0.12 * r, my = cy + 0.28 * r;
  const a = capsule(cx - 0.38 * r, cy + 0.02 * r, mx, my, half), b = capsule(mx, my, cx + 0.38 * r, cy - 0.24 * r, half);
  return { box: a.box.map((value, i) => (i < 2 ? Math.min : Math.max)(value, b.box[i])), inside: (x, y) => Math.max(a.inside(x, y), b.inside(x, y)) };
}

const stamp = (cx: number, cy: number, r: number): Layer[] => [[CORAL, disk(cx, cy, r)], [CORAL_EDGE, ring(cx, cy, r, 1.5)], [WHITE, check(cx, cy, r)]];
// A 2 pt dashed ring inside the slot, in whole dashes of about 3.2 pt so the circle shows no seam.
const slot = (cx: number, cy: number, r: number): Layer[] => [[OPEN, ring(cx, cy, r - 1, 2, Math.max(4, Math.round((2 * Math.PI * (r - 1)) / 6.4)))]];

/** Paints the layers in order on a background, visiting only each shape's box, with one pixel of edge coverage. */
function render(width: number, height: number, scale: number, background: Rgb, layers: Layer[]): Buffer {
  const w = width * scale, h = height * scale, stride = w * 4 + 1;
  const pixels = Buffer.alloc(stride * h);
  for (let x = 0; x < w; x++) pixels.set([...background, 255], 1 + x * 4);
  for (let y = 1; y < h; y++) pixels.copyWithin(y * stride, 0, stride);
  for (const [color, { box, inside }] of layers) {
    const left = Math.max(0, Math.floor(box[0] * scale) - 1), right = Math.min(w, Math.ceil(box[2] * scale) + 1);
    for (let py = Math.max(0, Math.floor(box[1] * scale) - 1); py < Math.min(h, Math.ceil(box[3] * scale) + 1); py++) {
      for (let px = left; px < right; px++) {
        const alpha = Math.min(1, Math.max(0, inside((px + 0.5) / scale, (py + 0.5) / scale) * scale + 0.5));
        if (!alpha) continue;
        const offset = py * stride + 1 + px * 4;
        for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(pixels[offset + c] + (color[c] - pixels[offset + c]) * alpha);
      }
    }
  }
  return png(w, h, pixels);
}

/** An 8-bit RGBA PNG from scanlines that each start with filter byte 0. */
function png(width: number, height: number, scanlines: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const label = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
    return Buffer.concat([length, label, data, checksum]);
  };
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}

// Apple's store-card strip is 375 x 144 pt. Geometry from the mock-up: 20 pt side padding, stamps of at most 40 pt with
// 10 pt gaps, an 18 pt bar ending in a reward ring of 26 pt radius.
const STRIP = { width: 375, height: 144, pad: 20 } as const;
const strips = new Map<string, Buffer>();
const STRIP_CACHE_MAX = 300;

/**
 * The progress strip: a paper band with one slot per stamp (stamp programmes up to 20), otherwise a bar filled by
 * balance ÷ cost that ends in the reward ring. Every balance from the cost up looks the same, so the key clamps it.
 */
export function stripPng(kind: "stamp" | "points", balance: number, cost: number, scale: 1 | 2 | 3): Buffer {
  const bar = kind === "points" || cost > 20, shown = Math.max(0, Math.min(balance, cost));
  const key = `${bar ? "bar" : "stamps"}:${shown}:${cost}:${shown === cost}:${scale}`;
  const cached = strips.get(key);
  if (cached) return cached;
  const { width, height, pad } = STRIP, layers: Layer[] = [];
  if (bar) {
    const r = 26, x0 = pad + 4, x1 = width - pad - 2 * r - 12, cy = height / 2;
    layers.push([TRACK, capsule(x0 + 9, cy, x1 - 9, cy, 9)]);
    // Once anything is collected the fill shows at least its round end.
    if (shown > 0) layers.push([CORAL, capsule(x0 + 9, cy, x0 + Math.max(18, ((x1 - x0) * shown) / cost) - 9, cy, 9)]);
    layers.push(...(shown === cost ? stamp : slot)(width - pad - r, cy, r));
  } else {
    const rows = cost <= 5 ? 1 : 2, perRow = Math.ceil(cost / rows), gap = 10;
    const d = Math.min(40, (width - 2 * pad - (perRow - 1) * gap) / perRow);
    const left = (width - perRow * d - (perRow - 1) * gap) / 2, top = (height - rows * d - (rows - 1) * gap) / 2;
    for (let i = 0; i < cost; i++) {
      layers.push(...(i < shown ? stamp : slot)(left + (i % perRow) * (d + gap) + d / 2, top + Math.floor(i / perRow) * (d + gap) + d / 2, d / 2));
    }
  }
  const image = render(width, height, scale, PAPER, layers);
  // shortcut: drops the oldest state, not the least used one; fine while a shop has a few hundred states, upgrade if hit rates suffer.
  if (strips.size >= STRIP_CACHE_MAX) strips.delete(strips.keys().next().value!);
  strips.set(key, image);
  return image;
}

/** CIELAB (D65) of an sRGB colour, to tell when a brand colour is close to coral. */
function lab(color: Rgb) {
  const [r, g, b] = color.map(value => value / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const CORAL_LAB = lab(CORAL);

/**
 * The lock-screen and notification icon (29 pt): the brand colour with a coral stamp across 60 % of it and a white
 * check. A brand colour close to coral (CIE76 ΔE under 25: terracotta, salmon, orange) gets a 1 pt white ring around it.
 */
export function iconPng(scale: 1 | 2 | 3, brandColor: string): Buffer {
  const brand = [1, 3, 5].map(i => parseInt(brandColor.slice(i, i + 2), 16));
  const size = 29, c = size / 2, r = size * 0.3;
  const layers: Layer[] = [[CORAL, disk(c, c, r)], [WHITE, check(c, c, r)]];
  if (Math.hypot(...lab(brand).map((value, i) => value - CORAL_LAB[i])) < 25) layers.push([WHITE, ring(c, c, r + 0.5, 1)]);
  return render(size, size, scale, brand, layers);
}
