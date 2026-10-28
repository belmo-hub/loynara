import { crc32, deflateSync } from "node:zlib";

// The Apple pass images (ENG-119), drawn in points and written by the small PNG encoder below: no image library, no
// fonts, no text. No customer data enters an image; the strip only repeats the balance the text fields state.

type Rgb = readonly number[];
/** A bounding box in points and a signed distance in points: positive inside the shape, negative outside. */
type Shape = { box: readonly number[]; inside: (x: number, y: number) => number };
type Layer = readonly [Rgb, Shape];

const PAPER: Rgb = [0xf4, 0xf5, 0xf3], CORAL: Rgb = [0xe9, 0x89, 0x5f], CORAL_EDGE: Rgb = [0xc9, 0x66, 0x3c];
const TRACK: Rgb = [0xdc, 0xe1, 0xde], WHITE: Rgb = [255, 255, 255];
// The app's tokens: --color-on-stamp for the check (5.98:1 on coral), --color-line-strong for open slots (3.47:1 on paper).
const ON_STAMP: Rgb = [0x17, 0x29, 0x1f], OPEN: Rgb = [0x7a, 0x86, 0x7d];

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

/** The pressed stamp's check, in the mock-up's proportions (design/2026-10-28-native-apple-pass/gen_pass.py). */
function check(cx: number, cy: number, r: number): Shape {
  const half = Math.max(2, r * 0.16) / 2, mx = cx - 0.12 * r, my = cy + 0.28 * r;
  const a = capsule(cx - 0.38 * r, cy + 0.02 * r, mx, my, half), b = capsule(mx, my, cx + 0.38 * r, cy - 0.24 * r, half);
  return { box: a.box.map((value, i) => (i < 2 ? Math.min : Math.max)(value, b.box[i])), inside: (x, y) => Math.max(a.inside(x, y), b.inside(x, y)) };
}

const stamp = (cx: number, cy: number, r: number): Layer[] => [[CORAL, disk(cx, cy, r)], [CORAL_EDGE, ring(cx, cy, r, 1.5)], [ON_STAMP, check(cx, cy, r)]];
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

// A reward's threshold slot while still open: a solid 2 pt ink ring instead of the dashed grey one; coral is only for
// earned stamps (Design, ENG-116).
const threshold = (cx: number, cy: number, r: number): Layer[] => [[ON_STAMP, ring(cx, cy, r - 1, 2)]];
// Space between two rings' centres for 4 pt of clear track between their drawn edges: a stamp's 0.75 pt edge ring and the
// half-pixel antialiasing of each edge count as part of the ring.
const RING_GAP = 4 + 2 * (0.75 + 0.5);

// Apple's store-card strip is 375 x 144 pt. Geometry from the mock-up: 20 pt side padding, stamps of at most 40 pt with
// 10 pt gaps, an 18 pt track carrying a ring per reward.
const STRIP = { width: 375, height: 144, pad: 20 } as const;
const strips = new Map<string, Buffer>();
const STRIP_CACHE_MAX = 300;

/**
 * The progress strip: a paper band with one slot per stamp up to the highest reward (stamp programmes up to 20), otherwise
 * a track filled to the balance with a ring per reward at cost ÷ highest cost. One mark per distinct cost, the five cheapest;
 * every balance from the highest of them up looks the same, so the key clamps it (Design, ENG-116).
 */
export function stripPng(kind: "stamp" | "points", balance: number, costs: number[], scale: 1 | 2 | 3): Buffer {
  const marks = [...new Set(costs)].sort((a, b) => a - b).slice(0, 5), highest = marks[marks.length - 1];
  const bar = kind === "points" || highest > 20, shown = Math.max(0, Math.min(balance, highest));
  const key = `${bar ? "bar" : "stamps"}:${shown}:${marks.join(",")}:${scale}`;
  const cached = strips.get(key);
  if (cached) return cached;
  const { width, height, pad } = STRIP, layers: Layer[] = [];
  if (bar) {
    // The track's round ends sit at start and end; the last ring is centred on the end, so the largest ring stays in the band.
    const cy = height / 2, start = pad + 13, end = width - pad - 16, at = (value: number) => start + ((end - start) * value) / highest;
    layers.push([TRACK, capsule(start, cy, end, cy, 9)]);
    // Once anything is collected the fill shows at least its round end; it runs under the rings.
    if (shown > 0) layers.push([CORAL, capsule(start, cy, at(shown), cy, 9)]);
    // The next unreached reward gets the larger ring. Rings keep 4 pt of track between their edges: a later one moves right, the last stays at the end.
    const next = marks.find(cost => cost > shown);
    const rings = marks.map(cost => ({ cost, r: cost === next ? 16 : 13, x: at(cost) }));
    for (let i = 1; i < rings.length; i++) rings[i].x = Math.max(rings[i].x, rings[i - 1].x + rings[i - 1].r + rings[i].r + RING_GAP);
    rings[rings.length - 1].x = end;
    for (let i = rings.length - 2; i >= 0; i--) rings[i].x = Math.min(rings[i].x, rings[i + 1].x - rings[i + 1].r - rings[i].r - RING_GAP);
    // An open ring sits on a paper disc, so neither the track nor the fill shows through its dashes.
    for (const { cost, r, x } of rings) layers.push(...(cost <= shown ? stamp(x, cy, r) : [[PAPER, disk(x, cy, r)] as const, ...slot(x, cy, r)]));
  } else {
    const rows = highest <= 5 ? 1 : 2, perRow = Math.ceil(highest / rows), gap = 10;
    const d = Math.min(40, (width - 2 * pad - (perRow - 1) * gap) / perRow);
    const left = (width - perRow * d - (perRow - 1) * gap) / 2, top = (height - rows * d - (rows - 1) * gap) / 2;
    for (let i = 0; i < highest; i++) {
      layers.push(...(i < shown ? stamp : marks.includes(i + 1) ? threshold : slot)(left + (i % perRow) * (d + gap) + d / 2, top + Math.floor(i / perRow) * (d + gap) + d / 2, d / 2));
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
 * The lock-screen and notification icon (29 pt): the brand colour with a coral stamp across 60 % of it and the stamp's
 * check. A brand colour close to coral (CIE76 ΔE under 25: terracotta, salmon, orange) gets a 1 pt white ring around it.
 */
export function iconPng(scale: 1 | 2 | 3, brandColor: string): Buffer {
  const brand = [1, 3, 5].map(i => parseInt(brandColor.slice(i, i + 2), 16));
  const size = 29, c = size / 2, r = size * 0.3;
  const layers: Layer[] = [[CORAL, disk(c, c, r)], [ON_STAMP, check(c, c, r)]];
  if (Math.hypot(...lab(brand).map((value, i) => value - CORAL_LAB[i])) < 25) layers.push([WHITE, ring(c, c, r + 0.5, 1)]);
  return render(size, size, scale, brand, layers);
}
