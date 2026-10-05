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

  test("accepts a static GIF and rejects an animated GIF", async () => {
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
      await expect(processImage(animatedPath, "image/gif", "attachment", dir)).rejects.toThrow(
        "Animated images are not supported",
      );
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
