/**
 * Where a decorative avatar frame goes around the avatar picture.
 *
 * A frame is a PNG with a transparent opening. The picture must sit centred in
 * that opening, so the opening is measured first (centre and radius, from the
 * pixels) and the placement is derived from the measurement and the image size.
 * Both steps are pure: decoding the PNG is the caller's job.
 */

/**
 * The transparent opening of a frame. `centerX` and `radius` are fractions of
 * the image width, `centerY` a fraction of its height. Centres are in pixel
 * index coordinates (the first pixel is at 0, not 0.5). `reach` is the largest
 * distance, as a fraction of the width, from the centre to the edge of the
 * frame's visible content, padded by two pixels.
 */
export interface FrameOpening {
  centerX: number;
  centerY: number;
  radius: number;
  reach: number;
}

/** Placement relative to the avatar box, in percent: frame width, left, top, and avatar scale. */
export interface FrameGeometry {
  width: number;
  left: number;
  top: number;
  scale: number;
}

/** Alpha below this is the opening; alpha at or above it stops a ray. */
const OPAQUE = 96;
/** Alpha at or above this counts as visible content when measuring how far the frame reaches. */
const VISIBLE = 25;
const REACH_PADDING = 2;
const RAYS = 360;
const RAY_STEP = 0.5;
const MAX_ITERATIONS = 40;
/** The picture is drawn slightly larger than the median ray so it tucks under the frame. */
const OVERLAP = 1.05;
/** The frame may reach this many percent of the box past each side of it. */
const OVERHANG = 25;
const MIN_SCALE = 70;
const MAX_SCALE = 100;

/**
 * Finds the opening in RGBA pixels (4 bytes per pixel, row-major). Null when
 * the image has none: the middle pixel is not transparent, or nothing is
 * visible.
 *
 * The centre starts at the middle of the image and is moved to the mean of the
 * points where rays cast around it first meet the frame, until it settles; the
 * radius is the median ray length, enlarged a little.
 */
export function measureFrameOpening(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): FrameOpening | null {
  const alphaAt = (x: number, y: number) => pixels[(y * width + x) * 4 + 3] ?? 0;
  if (alphaAt(Math.floor(width / 2), Math.floor(height / 2)) >= OPAQUE) return null;

  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) < VISIBLE) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;

  const cast = (cx: number, cy: number) => {
    const lengths: number[] = [];
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < RAYS; i++) {
      const angle = (i / RAYS) * 2 * Math.PI;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let d = 0;
      for (;;) {
        const x = Math.round(cx + d * dx);
        const y = Math.round(cy + d * dy);
        if (x < 0 || y < 0 || x >= width || y >= height || alphaAt(x, y) >= OPAQUE) break;
        d += RAY_STEP;
      }
      lengths.push(d);
      sumX += cx + d * dx;
      sumY += cy + d * dy;
    }
    return { lengths, x: sumX / RAYS, y: sumY / RAYS };
  };

  let cx = width / 2;
  let cy = height / 2;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = cast(cx, cy);
    const moved = Math.hypot(next.x - cx, next.y - cy);
    cx = next.x;
    cy = next.y;
    if (moved < 0.005) break;
  }

  const lengths = cast(cx, cy).lengths.sort((a, b) => a - b);
  const median = ((lengths[RAYS / 2 - 1] ?? 0) + (lengths[RAYS / 2] ?? 0)) / 2;
  if (median <= 0) return null;

  const reach = Math.max(cx - left, right - cx, cy - top, bottom - cy) + REACH_PADDING;
  return {
    centerX: cx / width,
    centerY: cy / height,
    radius: (OVERLAP * median) / width,
    reach: reach / width,
  };
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The placement for an opening in an image of the given size: the opening's
 * centre lands on the box centre and its diameter matches the scaled picture.
 * The picture is as large as possible (at most 100%) while the frame reaches no
 * further than a quarter of the box past it, but never below 70%.
 */
export function frameGeometry(opening: FrameOpening, width: number, height: number): FrameGeometry {
  const diameter = 2 * opening.radius;
  let frameWidth = MAX_SCALE / diameter;
  let scale = MAX_SCALE;
  const widest = (50 + OVERHANG) / opening.reach;
  if (widest < frameWidth) {
    scale = Math.floor(diameter * widest);
    if (scale < MIN_SCALE) scale = MIN_SCALE;
    frameWidth = scale / diameter;
  }
  return {
    width: tenth(frameWidth),
    left: tenth(50 - opening.centerX * frameWidth),
    top: tenth(50 - opening.centerY * frameWidth * (height / width)),
    scale,
  };
}
