import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import sharp from "sharp";
import { frameGeometry, measureFrameOpening } from "./frame-geometry";

sharp.cache(false);

const FIXTURES = join(import.meta.dir, "fixtures", "frames");

// The rows of the placement table the web app used before frames became data:
// [frame width, left, top, avatar scale], in percent of the avatar box.
const EXPECTED: Record<string, [number, number, number, number]> = {
  // Scale 100: the opening is the limit, the frame stays well inside the reach limit.
  "598": [188.6, -40.7, -38.7, 100],
  "571": [186.7, -40.7, -36.9, 100],
  // Scale 70: the reach limit would shrink the picture below the floor.
  "626": [185.2, -41.5, -51, 70],
  "635": [146.5, -19.2, -15.2, 70],
  // In between: the reach limit sets the scale.
  "569": [167.6, -31.2, -29.9, 97],
  "596": [164.6, -25.1, -27.2, 82],
  // Opening well above and left of the middle of the image.
  "572": [178.7, -38.5, -28, 87],
  // The narrowest frame of the whole table.
  "647": [141.3, -16.9, -14.7, 75],
};

// The width, left and top of a row are rounded to a tenth of a percent, and the
// opening is measured with rays that advance half a pixel, which is about
// 0.25% of the frame width at these sizes. Half a percent covers both; the
// scale is an integer and must be exact.
const TOLERANCE = 0.5;

async function decode(path: string) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

/** Opaque ring between two radii around (cx, cy); everything else is transparent. */
function ring(size: number, cx: number, cy: number, inner: number, outer: number) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance < inner || distance > outer) continue;
      pixels.set([200, 100, 50, 255], (y * size + x) * 4);
    }
  }
  return pixels;
}

describe("frame geometry", () => {
  for (const [key, [width, left, top, scale]] of Object.entries(EXPECTED)) {
    test(`frame ${key} is placed as the table says`, async () => {
      const image = await decode(join(FIXTURES, `${key}.png`));
      const opening = measureFrameOpening(image.pixels, image.width, image.height);
      expect(opening).not.toBeNull();
      if (!opening) return;
      const geometry = frameGeometry(opening, image.width, image.height);
      expect(geometry.scale).toBe(scale);
      expect(Math.abs(geometry.width - width)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(geometry.left - left)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(geometry.top - top)).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  test("a ring with a centred opening puts the opening on the box centre", () => {
    // Opening radius 40, ring out to 60, on a 200 px canvas. The picture is
    // 1.05 x the opening, so its diameter is 84 px = 0.42 of the width, which
    // gives a frame 100 / 0.42 = 238.1% wide; the ring reaches (60 + 2) / 200 =
    // 0.31 of the width from the centre, 75 / 0.31 = 241.9% would be allowed.
    const pixels = ring(200, 100, 100, 40, 60);
    const opening = measureFrameOpening(pixels, 200, 200);
    expect(opening).not.toBeNull();
    if (!opening) return;
    expect(opening.centerX).toBeCloseTo(0.5, 2);
    expect(opening.centerY).toBeCloseTo(0.5, 2);
    expect(opening.radius).toBeCloseTo(0.21, 2);
    const geometry = frameGeometry(opening, 200, 200);
    expect(geometry.scale).toBe(100);
    expect(Math.abs(geometry.width - 238.1)).toBeLessThanOrEqual(1);
    expect(geometry.left).toBeCloseTo(50 - geometry.width / 2, 1);
    expect(geometry.top).toBeCloseTo(50 - geometry.width / 2, 1);
  });

  test("a frame that reaches far shrinks the picture", () => {
    // Ring out to 80: reach (80 + 2) / 200 = 0.41, so the frame may be 75 / 0.41
    // = 182.9% wide, and the picture 0.42 x 182.9 = 76.8%, rounded down.
    const opening = measureFrameOpening(ring(200, 100, 100, 40, 80), 200, 200);
    expect(opening).not.toBeNull();
    if (!opening) return;
    expect(frameGeometry(opening, 200, 200).scale).toBe(76);
  });

  test("the picture never shrinks below 70%", () => {
    // Ring out to 95 would call for about 66%.
    const opening = measureFrameOpening(ring(200, 100, 100, 40, 95), 200, 200);
    expect(opening).not.toBeNull();
    if (!opening) return;
    const geometry = frameGeometry(opening, 200, 200);
    expect(geometry.scale).toBe(70);
    expect(geometry.width).toBeCloseTo(70 / (2 * opening.radius), 0);
  });

  test("an off-centre opening is found where it is and the frame is shifted to match", () => {
    // Opening radius 30 centred at (80, 110); the middle of the image is inside it.
    const pixels = ring(200, 80, 110, 30, 50);
    const opening = measureFrameOpening(pixels, 200, 200);
    expect(opening).not.toBeNull();
    if (!opening) return;
    expect(opening.centerX).toBeCloseTo(0.4, 2);
    expect(opening.centerY).toBeCloseTo(0.55, 2);
    const geometry = frameGeometry(opening, 200, 200);
    expect(geometry.left).toBeCloseTo(50 - 0.4 * geometry.width, 0);
    expect(geometry.top).toBeCloseTo(50 - 0.55 * geometry.width, 0);
  });

  test("the top offset follows the image height, not its width", () => {
    const opening = { centerX: 0.5, centerY: 0.5, radius: 0.25, reach: 0.3 };
    const square = frameGeometry(opening, 200, 200);
    const tall = frameGeometry(opening, 200, 400);
    expect(tall.width).toBe(square.width);
    expect(tall.left).toBe(square.left);
    expect(tall.top).toBeCloseTo(50 - 0.5 * tall.width * 2, 1);
  });

  test("a fully opaque image has no opening", () => {
    const pixels = new Uint8Array(100 * 100 * 4).fill(255);
    expect(measureFrameOpening(pixels, 100, 100)).toBeNull();
  });

  test("a fully transparent image has no opening", () => {
    expect(measureFrameOpening(new Uint8Array(100 * 100 * 4), 100, 100)).toBeNull();
  });

  test("an image whose middle is solid has no opening", () => {
    // A solid disc over the middle, transparent all around it.
    const disc = ring(200, 100, 100, 0, 30);
    expect(measureFrameOpening(disc, 200, 200)).toBeNull();
  });
});
