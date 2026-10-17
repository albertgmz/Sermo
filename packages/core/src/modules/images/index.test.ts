import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ValidationError } from "../../errors";
import { processImage } from "./index";

sharp.cache(false);

describe("image processing", () => {
  test("strips GPS metadata and applies EXIF orientation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-images-"));
    try {
      const photo = await sharp({
        create: { width: 2, height: 1, channels: 3, background: { r: 200, g: 30, b: 20 } },
      })
        .jpeg()
        .withExif({
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 3230/100" },
        })
        .withMetadata({ orientation: 6 })
        .toBuffer();
      const input = join(dir, "photo.jpg");
      await writeFile(input, photo);
      const original = await sharp(input).metadata();
      expect(original.exif).toBeDefined();
      expect(original.orientation).toBe(6);
      const processed = await processImage(input, "image/jpeg", "attachment", dir);
      expect(processed).toHaveLength(2);
      expect(processed[0]?.contentType).toBe("image/jpeg");
      expect(processed[0]?.width).toBe(1);
      expect(processed[0]?.height).toBe(2);
      expect(processed[1]?.variant).toBe("thumbnail");
      expect((await sharp(processed[0]!.path).metadata()).exif).toBeUndefined();
      expect((await sharp(processed[1]!.path).metadata()).exif).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("rejects oversized images before decoding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-images-"));
    try {
      const input = join(dir, "large.png");
      await sharp({
        create: { width: 4001, height: 4000, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toFile(input);
      await expect(processImage(input, "image/png", "attachment", dir)).rejects.toThrow(
        ValidationError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("accepts a static GIF as PNG and keeps an animated GIF moving", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-images-"));
    try {
      const staticGif = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .gif()
        .toBuffer();
      const staticPath = join(dir, "static.gif");
      await writeFile(staticPath, staticGif);
      const output = await processImage(staticPath, "image/gif", "attachment", dir);
      expect(output[0]?.contentType).toBe("image/png");
      expect((await sharp(output[0]!.path).metadata()).format).toBe("png");
      const frameStart = staticGif.indexOf(Buffer.from([0x21, 0xf9, 0x04]));
      expect(frameStart).toBeGreaterThan(0);
      const animated = Buffer.concat([
        staticGif.subarray(0, -1),
        staticGif.subarray(frameStart, -1),
        Buffer.from([0x3b]),
      ]);
      expect((await sharp(animated).metadata()).pages).toBe(2);
      const animatedPath = join(dir, "animated.gif");
      await writeFile(animatedPath, animated);
      // Its two frames are the same picture, which the encoder keeps as one: the frames of a
      // real animation are checked below.
      const [main] = await processImage(animatedPath, "image/gif", "attachment", dir);
      expect(main?.contentType).toBe("image/webp");
      // A catalog picture is never animated.
      await expect(processImage(animatedPath, "image/gif", "frame", dir)).rejects.toThrow(
        "Animated images are not supported",
      );
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  // Four frames of 300x200, each its own colour.
  async function animation(format: "gif" | "webp", width = 300, height = 200, frames = 4) {
    const pixels = await Promise.all(
      Array.from({ length: frames }, (_, index) =>
        sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: (index * 60) % 256, g: 255 - ((index * 60) % 256), b: 40, alpha: 1 },
          },
        })
          .raw()
          .toBuffer(),
      ),
    );
    const strip = sharp(Buffer.concat(pixels), {
      raw: { width, height: height * frames, channels: 4, pageHeight: height },
    });
    return format === "gif"
      ? strip.gif({ delay: Array(frames).fill(100) }).toBuffer()
      : strip.webp({ delay: Array(frames).fill(100) }).toBuffer();
  }

  test("an animated attachment, avatar or cover moves at full size and is still in its small renditions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-images-"));
    try {
      for (const format of ["gif", "webp"] as const) {
        const input = join(dir, `animated.${format}`);
        await writeFile(input, await animation(format));
        const attachment = await processImage(input, `image/${format}`, "attachment", dir);
        expect(attachment.map((item) => [item.variant, item.contentType])).toEqual([
          [null, "image/webp"],
          ["thumbnail", "image/webp"],
        ]);
        expect((await sharp(attachment[0]!.path).metadata()).pages).toBe(4);
        expect((await sharp(attachment[1]!.path).metadata()).pages).toBeUndefined();
        expect([attachment[0]!.width, attachment[0]!.height]).toEqual([300, 200]);
        const avatar = await processImage(input, `image/${format}`, "avatar", dir);
        expect(avatar.map((item) => item.variant)).toEqual([
          null,
          "square_256",
          "square_128",
          "square_64",
        ]);
        for (const item of avatar) {
          const meta = await sharp(item.path, { animated: true }).metadata();
          expect(item.contentType).toBe("image/webp");
          expect(meta.pages, `${format} avatar ${item.variant}`).toBe(
            item.variant === null ? 4 : undefined,
          );
          // The size recorded is one frame's.
          expect([item.width, item.height]).toEqual([meta.width, meta.pageHeight ?? meta.height]);
        }
        // Square like any avatar, but cut from the frames as they are: an animation is never enlarged.
        expect([avatar[0]!.width, avatar[0]!.height]).toEqual([200, 200]);
        expect([avatar[1]!.width, avatar[1]!.height]).toEqual([256, 256]);
        const cover = await processImage(input, `image/${format}`, "cover", dir);
        expect(cover.map((item) => item.variant)).toEqual([null, "cover_small"]);
        expect((await sharp(cover[0]!.path).metadata()).pages).toBe(4);
        expect((await sharp(cover[1]!.path).metadata()).pages).toBeUndefined();
        expect([cover[0]!.width, cover[0]!.height]).toEqual([300, 200]);
        // The frames keep their own pictures: the second frame is not the first.
        const frames = await Promise.all(
          [0, 1].map((page) => sharp(avatar[0]!.path, { page }).raw().toBuffer()),
        );
        expect(frames[0]!.equals(frames[1]!)).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("an animation with too many pixels or frames is refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-images-"));
    try {
      // 1000x1000 x 101 frames: each frame is small enough, all of them are not.
      const input = join(dir, "long.gif");
      await writeFile(input, await animation("gif", 1000, 1000, 101));
      await expect(processImage(input, "image/gif", "attachment", dir)).rejects.toThrow(
        "The animation has too many frames.",
      );
      // 1001 frames of 2x2: few pixels, but too many frames to encode.
      const tiny = join(dir, "tiny.gif");
      await writeFile(tiny, await animation("gif", 2, 2, 1001));
      await expect(processImage(tiny, "image/gif", "avatar", dir)).rejects.toThrow(
        "The animation has too many frames.",
      );
      // 1000 frames are taken, and a tiny animated avatar stays tiny instead of 512x512.
      await writeFile(tiny, await animation("gif", 2, 2, 1000));
      const [main] = await processImage(tiny, "image/gif", "avatar", dir);
      expect([main!.width, main!.height]).toEqual([2, 2]);
      expect((await sharp(main!.path).metadata()).pages).toBe(1000);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20_000);
});
