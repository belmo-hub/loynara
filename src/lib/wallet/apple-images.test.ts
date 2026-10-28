import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { iconPng, stripPng } from "./apple-images";

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const PAPER = rgb("#F4F5F3"), CORAL = rgb("#E9895F"), TRACK = rgb("#DCE1DE"), WHITE = rgb("#FFFFFF");
const CHECK = rgb("#17291F"), OPEN = rgb("#7A867D"); // the app's --color-on-stamp and --color-line-strong

/** Checks the PNG structure (signature, chunk CRCs, 8-bit RGBA, unfiltered rows) and reads pixels by point. */
function decode(png: Buffer, scale: number) {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const chunks: Array<[string, Buffer]> = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString("latin1", offset + 4, offset + 8);
    expect(png.readUInt32BE(offset + 8 + length), type).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
    chunks.push([type, png.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  expect(chunks.map(([type]) => type)).toEqual(["IHDR", "IDAT", "IEND"]);
  const header = chunks[0][1], width = header.readUInt32BE(0), height = header.readUInt32BE(4), stride = width * 4 + 1;
  expect([header[8], header[9]]).toEqual([8, 6]);
  const rows = inflateSync(chunks[1][1]);
  expect(rows.length).toBe(stride * height);
  for (let y = 0; y < height; y++) expect(rows[y * stride]).toBe(0);
  const pixel = (x: number, y: number) => [...rows.subarray(y * stride + 1 + x * 4, y * stride + 4 + x * 4)];
  return { width, height, pixel, at: (x: number, y: number) => pixel(Math.floor(x * scale), Math.floor(y * scale)) };
}

// The mock-up's geometry in points: 10 stamps sit in two rows of five 40 pt slots, 10 pt apart, centred in 375 x 144.
const slotCentre = (i: number) => [67.5 + (i % 5) * 50 + 20, 27 + Math.floor(i / 5) * 50 + 20] as const;

describe("Apple strip image (ENG-119)", () => {
  it("is a valid PNG of 375 x 144 pt at each density", () => {
    for (const scale of [1, 2, 3] as const) {
      const image = decode(stripPng("stamp", 3, 10, scale), scale);
      expect([image.width, image.height]).toEqual([375 * scale, 144 * scale]);
      expect(image.pixel(0, 0)).toEqual(PAPER); // the paper band runs edge to edge
      expect(image.pixel(image.width - 1, image.height - 1)).toEqual(PAPER);
    }
  });

  it("draws collected stamps as coral with an ink check and open slots as a dashed grey ring on paper", () => {
    const image = decode(stripPng("stamp", 3, 10, 2), 2);
    for (let i = 0; i < 10; i++) {
      const [x, y] = slotCentre(i);
      expect(image.at(x, y - 10), `slot ${i}`).toEqual(i < 3 ? CORAL : PAPER);
    }
    const [x, y] = slotCentre(0), [ox, oy] = slotCentre(3);
    expect(image.at(x + 2.6, y + 0.4)).toEqual(CHECK); // on the check's long stroke
    expect(image.at(ox, oy)).toEqual(PAPER);
    expect(image.at(ox + 19, oy)).toEqual(OPEN); // a dash of the ring
    // Dashed, not solid: around the ring the grey comes and goes.
    const around = Array.from({ length: 72 }, (_, k) => image.at(ox + 19 * Math.cos(k * Math.PI / 36), oy + 19 * Math.sin(k * Math.PI / 36)).join());
    expect(around.filter(value => value === OPEN.join()).length).toBeGreaterThan(20);
    expect(around.filter(value => value === PAPER.join()).length).toBeGreaterThan(20);
  });

  it("lays out up to 5 stamps in one row and 6 to 20 in two", () => {
    const one = decode(stripPng("stamp", 5, 5, 1), 1), two = decode(stripPng("stamp", 20, 20, 1), 1);
    expect(one.at(187.5, 62)).toEqual(CORAL); // the middle one of five 40 pt stamps on the centre line
    expect(two.at(187.5, 62)).toEqual(PAPER); // between the columns of two rows of ten
    expect(two.at(187.5, 72)).toEqual(PAPER); // between the rows
    expect(two.at(32.25, 48.5)).toEqual(CORAL); // the first of ten 24.5 pt stamps in the upper row
  });

  it("fills the bar by balance ÷ cost, at least its round end, and fills the reward ring once ready", () => {
    const fill = (balance: number, cost: number) => {
      const image = decode(stripPng("points", balance, cost, 1), 1);
      let coral = 0; // pixels at least half covered by the fill: green below the midpoint of coral (137) and track (225)
      for (let x = 0; x < 300; x++) if (image.pixel(x, 72)[1] < 181) coral++;
      return coral;
    };
    expect(Math.abs(fill(21, 100) - 267 * 0.21)).toBeLessThanOrEqual(1);
    expect(Math.abs(fill(50, 100) - 267 * 0.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(fill(1, 500) - 18)).toBeLessThanOrEqual(1);
    expect(fill(0, 100)).toBe(0);
    const open = decode(stripPng("points", 21, 100, 1), 1), ready = decode(stripPng("points", 312, 300, 1), 1);
    expect(open.at(150, 72)).toEqual(TRACK);
    expect(open.at(329, 72 - 15)).toEqual(PAPER);
    expect(open.at(329 + 24.5, 72)).toEqual(OPEN);
    expect(ready.at(150, 72)).toEqual(CORAL);
    expect(ready.at(329, 72 - 15)).toEqual(CORAL);
    expect(ready.at(329 + 3.4, 72 + 0.5)).toEqual(CHECK); // the ready ring carries the stamp's check
  });

  it("switches a stamp reward above 20 to the bar", () => {
    const image = decode(stripPng("stamp", 5, 25, 1), 1);
    expect(image.at(150, 72)).toEqual(TRACK);
    expect(stripPng("stamp", 5, 25, 1)).toBe(stripPng("points", 5, 25, 1));
  });

  it("renders a card state once and serves it from the cache after", () => {
    const first = stripPng("stamp", 4, 9, 3);
    expect(stripPng("stamp", 4, 9, 3)).toBe(first);
    expect(stripPng("stamp", 4, 9, 2)).not.toBe(first);
    expect(stripPng("stamp", 12, 10, 1)).toBe(stripPng("stamp", 10, 10, 1)); // beyond the cost every strip is the full card
  });
});

describe("Apple pass icon (ENG-119)", () => {
  it("is the brand colour with a coral stamp and its ink check at 29, 58 and 87 px", () => {
    for (const scale of [1, 2, 3] as const) {
      const image = decode(iconPng(scale, "#264C45"), scale);
      expect([image.width, image.height]).toEqual([29 * scale, 29 * scale]);
      expect(image.at(1, 1)).toEqual(rgb("#264C45"));
      expect(image.at(14.5, 9)).toEqual(CORAL); // the stamp spans 60 % of the icon
      expect(image.at(14.5 + 1.1, 14.5 + 0.2)).toEqual(CHECK);
    }
  });

  it("rings the stamp in white only on a brand colour close to coral", () => {
    const ring = (color: string) => decode(iconPng(3, color), 3).at(14.5, 14.5 - 9.2);
    expect(ring("#E2725B")).toEqual(WHITE);
    for (const color of ["#264C45", "#F2C14E", "#8A3B2E"]) expect(ring(color), color).toEqual(rgb(color));
  });
});
