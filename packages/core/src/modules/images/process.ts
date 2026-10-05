import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import { ValidationError } from "../../errors";

export type ImagePurpose = "attachment" | "avatar" | "cover" | "node_icon" | "node_cover";
export interface ProcessedImage {
  path: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
  variant: string | null;
}

const MAX_PIXELS = 16_000_000;
const inputTypes = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** The only image decode/encode entry point. All outputs are fresh pixels without input metadata. */
export async function processImage(
  inputPath: string,
  mime: string,
  purpose: ImagePurpose,
  tempDir: string,
): Promise<ProcessedImage[]> {
  const expectedFormat = inputTypes.get(mime);
  if (!expectedFormat) throw new ValidationError("Unsupported image format.");
  let metadata: Metadata;
  try {
    metadata = await sharp(inputPath, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new ValidationError("Image could not be decoded.");
  }
  if (metadata.format !== expectedFormat)
    throw new ValidationError("Image type does not match its content.");
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS)
    throw new ValidationError("Image dimensions exceed the limit.");
  if ((metadata.pages ?? 1) > 1) throw new ValidationError("Animated images are not supported.");

  const output: ProcessedImage[] = [];
  const paths: string[] = [];
  const sizes: {
    variant: string | null;
    width: number | null;
    height: number | null;
    fit: "cover" | "inside";
    mime: string;
  }[] =
    purpose === "avatar" || purpose === "node_icon"
      ? [
          { variant: null, width: 512, height: 512, fit: "cover", mime: "image/webp" },
          { variant: "square_256", width: 256, height: 256, fit: "cover", mime: "image/webp" },
          { variant: "square_128", width: 128, height: 128, fit: "cover", mime: "image/webp" },
          { variant: "square_64", width: 64, height: 64, fit: "cover", mime: "image/webp" },
        ]
      : purpose === "cover" || purpose === "node_cover"
        ? [
            { variant: null, width: 1600, height: 600, fit: "inside", mime: "image/webp" },
            { variant: "cover_small", width: 800, height: 300, fit: "inside", mime: "image/webp" },
          ]
        : [
            {
              variant: null,
              width: 2048,
              height: 2048,
              fit: "inside",
              mime: mime === "image/gif" ? "image/png" : mime,
            },
            { variant: "thumbnail", width: 320, height: 320, fit: "inside", mime: "image/webp" },
          ];

  try {
    for (const size of sizes) {
      const path = join(tempDir, `sermo-image-${randomUUID()}`);
      paths.push(path);
      const pipeline = sharp(inputPath, { limitInputPixels: MAX_PIXELS, failOn: "error" })
        .autoOrient()
        .resize(size.width!, size.height!, {
          fit: size.fit,
          withoutEnlargement: size.fit === "inside",
        });
      if (size.mime === "image/jpeg") pipeline.jpeg({ quality: 85 });
      else if (size.mime === "image/png") pipeline.png();
      else pipeline.webp({ quality: 82 });
      const info = await pipeline.toFile(path);
      output.push({
        path,
        contentType: size.mime,
        width: info.width,
        height: info.height,
        byteSize: info.size,
        variant: size.variant,
      });
    }
    return output;
  } catch {
    for (const path of paths) await rm(path, { force: true, maxRetries: 5, retryDelay: 50 });
    throw new ValidationError("Image could not be processed.");
  }
}
