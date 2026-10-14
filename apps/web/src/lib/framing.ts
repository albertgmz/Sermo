// The maths of framing a picture before it is uploaded: which part of the chosen image the frame
// shows, from a zoom and a centre. Pure, so the dialog and its tests share it. All sizes are in
// pixels of the source image.

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

// The framed area: `zoom` 1 shows the most the shape allows, more shows a smaller part; `cx` and
// `cy` are the centre of the area in the image.
export type Framing = { zoom: number; cx: number; cy: number };

export type Shape = "avatar" | "cover";

// The frame's width over its height, and the widest picture that is made from it. The backend
// keeps an avatar square and fits a cover inside 1600x600, so a cover keeps the 5:2 of the site's
// own covers.
export const SHAPES: Record<Shape, { aspect: number; width: number }> = {
  avatar: { aspect: 1, width: 512 },
  cover: { aspect: 5 / 2, width: 1600 },
};

export const MAX_ZOOM = 4;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export const clampZoom = (zoom: number) =>
  Number.isFinite(zoom) ? clamp(zoom, 1, MAX_ZOOM) : 1;

// The area shown at a zoom: the largest rectangle of the shape that fits in the image, divided by
// the zoom.
export function cropSize(
  image: Size,
  aspect: number,
  zoom: number,
): { width: number; height: number } {
  const wide = image.width / image.height > aspect;
  const width = wide ? image.height * aspect : image.width;
  const height = wide ? image.height : image.width / aspect;
  const z = clampZoom(zoom);
  return { width: width / z, height: height / z };
}

// Where the frame sits in the image. The area never leaves the image, whatever the centre says.
export function cropRect(image: Size, aspect: number, framing: Framing): Rect {
  const size = cropSize(image, aspect, framing.zoom);
  return {
    x: clamp(framing.cx - size.width / 2, 0, image.width - size.width),
    y: clamp(framing.cy - size.height / 2, 0, image.height - size.height),
    ...size,
  };
}

export const centred = (image: Size): Framing => ({
  zoom: 1,
  cx: image.width / 2,
  cy: image.height / 2,
});

// The same framing with its centre brought back inside the image.
function settled(image: Size, aspect: number, framing: Framing): Framing {
  const rect = cropRect(image, aspect, framing);
  return {
    zoom: clampZoom(framing.zoom),
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
  };
}

export function zoomTo(
  image: Size,
  aspect: number,
  framing: Framing,
  zoom: number,
): Framing {
  return settled(image, aspect, { ...framing, zoom });
}

// A drag of the picture by `dx`, `dy` pixels on screen, where the frame is `viewWidth` pixels
// wide: the picture follows the pointer, so the area moves the other way.
export function dragBy(
  image: Size,
  aspect: number,
  framing: Framing,
  dx: number,
  dy: number,
  viewWidth: number,
): Framing {
  const rect = cropRect(image, aspect, framing);
  const perPixel = viewWidth > 0 ? rect.width / viewWidth : 0;
  return settled(image, aspect, {
    ...framing,
    cx: framing.cx - dx * perPixel,
    cy: framing.cy - dy * perPixel,
  });
}

// The size of the picture that is made: no larger than the shape allows and never above what the
// framed area holds, so a small image is not stretched.
export function outputSize(shape: Shape, rect: Rect): Size {
  const { aspect, width: widest } = SHAPES[shape];
  const width = Math.max(1, Math.min(widest, Math.floor(rect.width)));
  return { width, height: Math.max(1, Math.round(width / aspect)) };
}

// The format the framed picture keeps: JPEG, WebP and PNG stay as they are, anything else (a GIF
// is a single still here) becomes PNG.
export function outputType(mime: string): { type: string; quality?: number } {
  if (mime === "image/jpeg") return { type: "image/jpeg", quality: 0.92 };
  if (mime === "image/webp") return { type: "image/webp", quality: 0.92 };
  return { type: "image/png" };
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/png": "png",
};

export function outputName(original: string, type: string): string {
  const stem = original.replace(/\.[^./\\]*$/, "") || "picture";
  return `${stem}.${EXTENSIONS[type] ?? "png"}`;
}

// Encodes with the requested format and answers what the browser really made: Safari cannot write
// WebP and falls back to PNG, which for a photo is far larger. A WebP request that did not come
// back as WebP is made again as JPEG. The caller names the file after the blob's own type.
export async function encodeFramed(
  encode: (type: string, quality?: number) => Promise<Blob | null>,
  requested: { type: string; quality?: number },
): Promise<Blob | null> {
  const blob = await encode(requested.type, requested.quality);
  if (blob && blob.type !== requested.type && requested.type === "image/webp") {
    return (await encode("image/jpeg", 0.92)) ?? blob;
  }
  return blob;
}
