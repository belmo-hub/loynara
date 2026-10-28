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
// The track's centre line runs from 33 to 339 pt; a value sits there at value ÷ highest cost.
const along = (value: number, highest: number) => 33 + (306 * value) / highest;

describe("Apple strip image (ENG-119)", () => {
  it("is a valid PNG of 375 x 144 pt at each density", () => {
    for (const scale of [1, 2, 3] as const) {
      const image = decode(stripPng("stamp", 3, [10], scale), scale);
      expect([image.width, image.height]).toEqual([375 * scale, 144 * scale]);
      expect(image.pixel(0, 0)).toEqual(PAPER); // the paper band runs edge to edge
      expect(image.pixel(image.width - 1, image.height - 1)).toEqual(PAPER);
    }
  });

  it("draws collected stamps as coral with an ink check and open slots as a dashed grey ring on paper", () => {
    const image = decode(stripPng("stamp", 3, [10], 2), 2);
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
    const one = decode(stripPng("stamp", 5, [5], 1), 1), two = decode(stripPng("stamp", 20, [20], 1), 1);
    expect(one.at(187.5, 62)).toEqual(CORAL); // the middle one of five 40 pt stamps on the centre line
    expect(two.at(187.5, 62)).toEqual(PAPER); // between the columns of two rows of ten
    expect(two.at(187.5, 72)).toEqual(PAPER); // between the rows
    expect(two.at(32.25, 48.5)).toEqual(CORAL); // the first of ten 24.5 pt stamps in the upper row
  });

  it("fills the track to the balance, at least its round end, and fills the reward ring once reached", () => {
    const fill = (balance: number, cost: number) => {
      const image = decode(stripPng("points", balance, [cost], 1), 1);
      let coral = 0; // pixels at least half covered by the fill: green below the midpoint of coral (137) and track (225)
      for (let x = 0; x < 300; x++) if (image.pixel(x, 72)[1] < 181) coral++;
      return coral;
    };
    expect(Math.abs(fill(21, 100) - (along(21, 100) + 9 - 24))).toBeLessThanOrEqual(1);
    expect(Math.abs(fill(50, 100) - (along(50, 100) + 9 - 24))).toBeLessThanOrEqual(1);
    expect(Math.abs(fill(1, 500) - 18)).toBeLessThanOrEqual(1);
    expect(fill(0, 100)).toBe(0);
    const open = decode(stripPng("points", 21, [100], 2), 2), ready = decode(stripPng("points", 312, [300], 2), 2);
    expect(open.at(150, 72)).toEqual(TRACK);
    expect(open.at(339, 72)).toEqual(PAPER); // the open ring at the track's end sits on paper
    expect(open.at(339 + 15, 72)).toEqual(OPEN); // radius 16: the next reward's ring
    expect(ready.at(150, 72)).toEqual(CORAL);
    expect(ready.at(339, 72 - 7)).toEqual(CORAL);
    expect(ready.at(339 + 1.7, 72 + 0.3)).toEqual(CHECK); // the reached ring carries the stamp's check
  });

  it("puts a ring per reward at cost ÷ highest cost, the next unreached one larger (ENG-116)", () => {
    const two = decode(stripPng("points", 21, [100, 200], 2), 2);
    expect(two.at(along(100, 200), 72)).toEqual(PAPER);
    expect(two.at(along(100, 200) + 15, 72)).toEqual(OPEN); // radius 16: the next reward
    expect(two.at(339 + 15, 72)).toEqual(PAPER); // radius 13: a later reward
    const reachedOne = decode(stripPng("points", 150, [100, 200], 2), 2);
    expect(reachedOne.at(along(100, 200), 72 - 7)).toEqual(CORAL); // reached: the pressed stamp
    expect(reachedOne.at(339 + 15, 72)).toEqual(OPEN); // the next one, now at the end, is the larger ring
    const three = decode(stripPng("points", 150, [100, 200, 300], 2), 2);
    expect(three.at(along(100, 300), 72 - 7)).toEqual(CORAL);
    expect(three.at(along(100, 300) + 1.7, 72 + 0.3)).toEqual(CHECK);
    expect(three.at(along(150, 300) - 6, 72)).toEqual(CORAL); // the fill runs to the balance
    expect(three.at(along(200, 300), 72)).toEqual(PAPER);
    expect(three.at(along(200, 300) + 15, 72)).toEqual(OPEN);
    expect(stripPng("points", 21, [100], 1)).not.toBe(stripPng("points", 21, [100, 200], 1)); // the key holds every cost
  });

  it("keeps rings 4 pt apart by moving the later one right, and the last one at the end", () => {
    const close = decode(stripPng("points", 50, [100, 120, 250], 2), 2);
    const first = along(100, 250), second = first + 16 + 13 + 4; // 120 would sit at along(120, 250), inside the first ring
    expect(close.at(second, 72)).toEqual(PAPER);
    expect(close.at(second + 12, 72)).toEqual(OPEN);
    expect(close.at(first + 18, 72)).toEqual(TRACK); // the 4 pt gap between them
    expect(close.at(339, 72)).toEqual(PAPER);
  });

  it("draws the five cheapest rewards and runs the track to the fifth", () => {
    const capped = decode(stripPng("points", 120, [300, 50, 100, 150, 200, 250], 2), 2);
    expect(capped.at(339, 72)).toEqual(PAPER); // 250, the fifth, sits at the end
    expect(capped.at(along(200, 250), 72)).toEqual(PAPER);
    expect(capped.at(along(120, 250) - 4, 72)).toEqual(CORAL);
    expect(capped.at(along(120, 250) + 12, 72)).toEqual(TRACK);
    expect(stripPng("points", 120, [300, 50, 100, 150, 200, 250], 1)).toBe(stripPng("points", 120, [50, 100, 150, 200, 250], 1));
  });

  it("runs the stamp grid to the highest reward and rings an open threshold slot in coral", () => {
    const grid = decode(stripPng("stamp", 3, [5, 10], 2), 2);
    const [fx, fy] = slotCentre(4), [lx, ly] = slotCentre(9), [ox, oy] = slotCentre(3);
    expect(grid.at(fx + 18.75, fy)).toEqual(CORAL); // a solid 2.5 pt coral ring for 5 stamps
    expect(grid.at(lx + 18.75, ly)).toEqual(CORAL); // and for 10
    expect(grid.at(fx, fy)).toEqual(PAPER);
    expect(grid.at(ox + 19, oy)).toEqual(OPEN); // an ordinary open slot stays dashed grey
    const reached = decode(stripPng("stamp", 6, [5, 10], 2), 2);
    expect(reached.at(fx, fy - 10)).toEqual(CORAL); // once reached it is the pressed stamp
    expect(reached.at(fx + 2.6, fy + 0.4)).toEqual(CHECK);
  });

  it("switches a stamp reward above 20 to the bar", () => {
    const image = decode(stripPng("stamp", 5, [25], 1), 1);
    expect(image.at(150, 72)).toEqual(TRACK);
    expect(stripPng("stamp", 5, [25], 1)).toBe(stripPng("points", 5, [25], 1));
    expect(stripPng("stamp", 5, [10, 25], 1)).toBe(stripPng("points", 5, [10, 25], 1));
  });

  it("renders a card state once and serves it from the cache after", () => {
    const first = stripPng("stamp", 4, [9], 3);
    expect(stripPng("stamp", 4, [9], 3)).toBe(first);
    expect(stripPng("stamp", 4, [9], 2)).not.toBe(first);
    expect(stripPng("stamp", 12, [10], 1)).toBe(stripPng("stamp", 10, [10], 1)); // beyond the cost every strip is the full card
  });

  it("keeps at most 300 states and drops the oldest first", () => {
    const first = Array.from({ length: 300 }, (_, i) => stripPng("points", i + 1, [1000], 1));
    expect(stripPng("points", 1, [1000], 1)).toBe(first[0]); // all 300 cached; a hit does not reorder
    stripPng("points", 301, [1000], 1);
    expect(stripPng("points", 2, [1000], 1)).toBe(first[1]);
    expect(stripPng("points", 1, [1000], 1)).not.toBe(first[0]); // the oldest was dropped and is drawn again
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
