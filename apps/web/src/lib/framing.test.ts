import { expect, test } from "bun:test";
import {
  centred,
  clampZoom,
  cropRect,
  dragBy,
  encodeFramed,
  isAnimated,
  MAX_ZOOM,
  outputName,
  outputSize,
  outputType,
  SHAPES,
  zoomTo,
} from "@/lib/framing";

const wide = { width: 4000, height: 2000 };
const tall = { width: 1000, height: 3000 };

test("an avatar frame shows the largest centred square at zoom 1", () => {
  expect(cropRect(wide, SHAPES.avatar.aspect, centred(wide))).toEqual({
    x: 1000,
    y: 0,
    width: 2000,
    height: 2000,
  });
  expect(cropRect(tall, SHAPES.avatar.aspect, centred(tall))).toEqual({
    x: 0,
    y: 1000,
    width: 1000,
    height: 1000,
  });
});

test("a cover frame is 5:2 and fills the width of a tall or a flat image", () => {
  const aspect = SHAPES.cover.aspect;
  expect(cropRect(wide, aspect, centred(wide))).toEqual({
    x: 0,
    y: 200,
    width: 4000,
    height: 1600,
  });
  const rect = cropRect(tall, aspect, centred(tall));
  expect(rect.width).toBe(1000);
  expect(rect.height).toBe(400);
  expect(rect.y).toBe(1300);
  // An image wider than 5:2 is filled in height.
  const panorama = { width: 6000, height: 1000 };
  expect(cropRect(panorama, aspect, centred(panorama))).toEqual({
    x: 1750,
    y: 0,
    width: 2500,
    height: 1000,
  });
});

test("zooming shrinks the area around the same centre", () => {
  const aspect = SHAPES.avatar.aspect;
  const framing = zoomTo(wide, aspect, centred(wide), 2);
  expect(cropRect(wide, aspect, framing)).toEqual({
    x: 1500,
    y: 500,
    width: 1000,
    height: 1000,
  });
});

test("the zoom is held between 1 and the maximum, and a bad number is 1", () => {
  expect(clampZoom(0.2)).toBe(1);
  expect(clampZoom(99)).toBe(MAX_ZOOM);
  expect(clampZoom(Number.NaN)).toBe(1);
  expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  expect(zoomTo(wide, 1, centred(wide), 99).zoom).toBe(MAX_ZOOM);
});

test("a framing whose centre is outside the image is clamped to the edge", () => {
  const aspect = SHAPES.avatar.aspect;
  const rect = cropRect(wide, aspect, { zoom: 2, cx: -500, cy: 99999 });
  expect(rect).toEqual({ x: 0, y: 1000, width: 1000, height: 1000 });
  const far = cropRect(wide, aspect, { zoom: 1, cx: 99999, cy: 0 });
  expect(far.x).toBe(2000);
  expect(far.y).toBe(0);
});

test("dragging moves the picture with the pointer and stops at the edges", () => {
  const aspect = SHAPES.avatar.aspect;
  const zoomed = zoomTo(wide, aspect, centred(wide), 2);
  // The frame is 500 px wide on screen and shows 1000 source pixels: 2 source pixels per pixel.
  // The picture follows the pointer, so the area moves the other way.
  const moved = dragBy(wide, aspect, zoomed, 100, 50, 500);
  const rect = cropRect(wide, aspect, moved);
  expect(rect.x).toBe(1300);
  expect(rect.y).toBe(400);
  // A long drag cannot take the area out of the image.
  const far = dragBy(wide, aspect, zoomed, -100000, 100000, 500);
  const edge = cropRect(wide, aspect, far);
  expect(edge.x).toBe(3000);
  expect(edge.y).toBe(0);
  expect(far.cx).toBe(3500);
  // There is nothing to drag along the side the frame already fills.
  const still = dragBy(wide, aspect, centred(wide), 0, 300, 500);
  expect(cropRect(wide, aspect, still).y).toBe(0);
  // A frame with no width on screen does not move or divide by zero.
  expect(dragBy(wide, aspect, zoomed, 10, 10, 0)).toEqual(zoomed);
});

test("the picture made is 512 square for an avatar and 1600 by 640 for a cover, never enlarged", () => {
  const big = { x: 0, y: 0, width: 3000, height: 3000 };
  expect(outputSize("avatar", big)).toEqual({ width: 512, height: 512 });
  expect(outputSize("cover", { ...big, height: 1200 })).toEqual({
    width: 1600,
    height: 640,
  });
  expect(outputSize("avatar", { ...big, width: 300, height: 300 })).toEqual({
    width: 300,
    height: 300,
  });
  expect(outputSize("cover", { ...big, width: 1000, height: 400 })).toEqual({
    width: 1000,
    height: 400,
  });
  expect(outputSize("avatar", { ...big, width: 0.4, height: 0.4 })).toEqual({
    width: 1,
    height: 1,
  });
});

test("JPEG, WebP and PNG keep their format; anything else becomes PNG", () => {
  expect(outputType("image/jpeg").type).toBe("image/jpeg");
  expect(outputType("image/webp").type).toBe("image/webp");
  expect(outputType("image/png")).toEqual({ type: "image/png" });
  expect(outputType("image/gif")).toEqual({ type: "image/png" });
  expect(outputType("")).toEqual({ type: "image/png" });
  expect(outputName("holiday.final.gif", "image/png")).toBe(
    "holiday.final.png",
  );
  expect(outputName("me.JPEG", "image/jpeg")).toBe("me.jpg");
  expect(outputName("", "image/webp")).toBe("picture.webp");
});

test("a WebP request that comes back as PNG is made again as JPEG", async () => {
  const asked: string[] = [];
  const encode = (answers: Record<string, string>) => async (type: string) => {
    asked.push(type);
    return new Blob(["x"], { type: answers[type] ?? type });
  };
  // A browser that cannot write WebP.
  const safari = await encodeFramed(encode({ "image/webp": "image/png" }), {
    type: "image/webp",
    quality: 0.92,
  });
  expect(safari?.type).toBe("image/jpeg");
  expect(asked).toEqual(["image/webp", "image/jpeg"]);

  asked.length = 0;
  expect((await encodeFramed(encode({}), { type: "image/webp" }))?.type).toBe(
    "image/webp",
  );
  expect(asked).toEqual(["image/webp"]);

  // A PNG or JPEG request is taken as it comes back, and the file is named after it.
  asked.length = 0;
  const png = await encodeFramed(encode({}), { type: "image/png" });
  expect(outputName("a.gif", png?.type ?? "")).toBe("a.png");
  expect(asked).toEqual(["image/png"]);

  // A canvas that cannot encode at all.
  expect(await encodeFramed(async () => null, { type: "image/webp" })).toBe(
    null,
  );
});

test("a GIF or WebP of several frames is told from a still one", () => {
  // A 1x1 GIF with a two-colour table and the given number of frames, each after its extension.
  const gif = (frames: number) =>
    new Uint8Array([
      ...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0],
      ...[255, 0, 0, 0, 0, 255],
      ...Array.from({ length: frames }, () => [
        ...[0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00],
        ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
        ...[0x02, 0x02, 0x44, 0x01, 0x00],
      ]).flat(),
      0x3b,
    ]);
  expect(isAnimated(gif(1))).toBe(false);
  expect(isAnimated(gif(2))).toBe(true);
  // A local colour table is skipped as well.
  const local = gif(2);
  local[13 + 6 + 8 + 9] = 0x80;
  const withTable = new Uint8Array([
    ...local.subarray(0, 13 + 6 + 8 + 10),
    255,
    255,
    255,
    0,
    0,
    0,
    ...local.subarray(13 + 6 + 8 + 10),
  ]);
  expect(isAnimated(withTable)).toBe(true);
  const webp = (flags: number) =>
    new Uint8Array([
      ...[0x52, 0x49, 0x46, 0x46, 30, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      ...[0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, flags, 0, 0, 0],
    ]);
  expect(isAnimated(webp(0x02))).toBe(true);
  expect(isAnimated(webp(0x10))).toBe(false);
  expect(isAnimated(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
});
