import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import { MAX_REACTION_IMAGE_SIDE } from "../../contracts/reactions";
import type { FILE_PURPOSES } from "../../db/schema";
import { ValidationError } from "../../errors";

export type ImagePurpose = (typeof FILE_PURPOSES)[number];
export interface ProcessedImage {
  path: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
  variant: string | null;
}

// Every input is a fresh temp file read once, so libvips gains nothing from holding it open, and
// an open GIF cannot be deleted on Windows (the upload's clean-up failed with EBUSY).
sharp.cache({ files: 0 });

const MAX_PIXELS = 16_000_000;
/**
 * All frames of an animated picture together; each frame alone stays within `MAX_PIXELS`. An
 * animation is never enlarged, so what is written is at most what was read.
 */
const MAX_ANIMATED_PIXELS = 100_000_000;
/** Every frame costs its own encoding, however small: tiny frames by the thousand are refused. */
const MAX_FRAMES = 1000;
/**
 * Purposes whose main rendition keeps the animation of an animated GIF or WebP (as animated
 * WebP). Their smaller renditions (thumbnails, small avatars) are the first frame.
 */
const ANIMATED_PURPOSES: ReadonlySet<ImagePurpose> = new Set(["attachment", "avatar", "cover"]);
const inputTypes = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

interface Size {
  variant: string | null;
  width: number;
  height: number;
  fit: "cover" | "inside";
  mime: string;
  webp?: { quality: number; alphaQuality?: number; lossless?: boolean };
}
const WEBP_ART = { quality: 90, alphaQuality: 100 };
/** A reaction picture is a sprite sheet at times: its pixels must stay where the frames expect them. */
const WEBP_EXACT = { quality: 100, alphaQuality: 100, lossless: true };
/** Longest side of a reaction picture; nothing larger is accepted, so none is ever scaled. */
const REACTION_IMAGE_SIDE = MAX_REACTION_IMAGE_SIDE;
const insideWebp = (variant: string | null, width: number, height: number, webp?: Size["webp"]) =>
  ({ variant, width, height, fit: "inside", mime: "image/webp", webp }) satisfies Size;

/** The renditions stored for a purpose: the main image first, then its variants. */
function sizesFor(purpose: ImagePurpose, mime: string): Size[] {
  switch (purpose) {
    case "avatar":
    case "node_icon":
      return [
        { variant: null, width: 512, height: 512, fit: "cover", mime: "image/webp" },
        { variant: "square_256", width: 256, height: 256, fit: "cover", mime: "image/webp" },
        { variant: "square_128", width: 128, height: 128, fit: "cover", mime: "image/webp" },
        { variant: "square_64", width: 64, height: 64, fit: "cover", mime: "image/webp" },
      ];
    case "cover":
    case "node_cover":
    case "cover_preset":
    case "thread_cover":
      return [insideWebp(null, 1600, 600), insideWebp("cover_small", 800, 300)];
    case "frame":
      return [insideWebp(null, 512, 512, WEBP_ART), insideWebp("frame_256", 256, 256, WEBP_ART)];
    case "award_image":
    case "shop_image":
      return [insideWebp(null, 960, 540), insideWebp("art_small", 480, 270)];
    case "reaction_image":
      return [insideWebp(null, REACTION_IMAGE_SIDE, REACTION_IMAGE_SIDE, WEBP_EXACT)];
    case "site_logo":
      return [insideWebp(null, 640, 160, WEBP_ART)];
    case "site_icon":
      return [
        { variant: null, width: 512, height: 512, fit: "cover", mime: "image/png" },
        { variant: "icon_192", width: 192, height: 192, fit: "cover", mime: "image/png" },
        { variant: "icon_48", width: 48, height: 48, fit: "cover", mime: "image/png" },
      ];
    case "site_backdrop":
      return [insideWebp(null, 2560, 1440), insideWebp("backdrop_small", 1280, 720)];
    case "attachment":
      return [
        {
          variant: null,
          width: 2048,
          height: 2048,
          fit: "inside",
          mime: mime === "image/gif" ? "image/png" : mime,
        },
        insideWebp("thumbnail", 320, 320),
      ];
  }
}

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
  if (
    purpose === "reaction_image" &&
    (metadata.width > REACTION_IMAGE_SIDE || metadata.height > REACTION_IMAGE_SIDE)
  )
    throw new ValidationError(
      `Reaction pictures are at most ${REACTION_IMAGE_SIDE} pixels on a side.`,
    );
  const pages = metadata.pages ?? 1;
  if (pages > 1 && !ANIMATED_PURPOSES.has(purpose))
    throw new ValidationError("Animated images are not supported.");
  if (pages > MAX_FRAMES || metadata.width * metadata.height * pages > MAX_ANIMATED_PIXELS)
    throw new ValidationError("The animation has too many frames.");
  const { width: frameWidth, height: frameHeight } = metadata;

  const output: ProcessedImage[] = [];
  const paths: string[] = [];
  const sizes = sizesFor(purpose, mime);

  try {
    for (const size of sizes) {
      const path = join(tempDir, `sermo-image-${randomUUID()}`);
      paths.push(path);
      const animated = pages > 1 && size.variant === null;
      // A cover crop enlarges a small picture to fill the box; an animation is cropped at the
      // largest box of that shape it holds instead, so it keeps its shape and is never enlarged.
      const scale =
        animated && size.fit === "cover"
          ? Math.min(1, frameWidth / size.width, frameHeight / size.height)
          : 1;
      const pipeline = sharp(inputPath, {
        limitInputPixels: animated ? MAX_ANIMATED_PIXELS : MAX_PIXELS,
        failOn: "error",
        animated,
      })
        .autoOrient()
        .resize(
          Math.max(1, Math.round(size.width * scale)),
          Math.max(1, Math.round(size.height * scale)),
          { fit: size.fit, withoutEnlargement: size.fit === "inside" || animated },
        );
      // Only WebP of the formats stored keeps the frames (a still GIF attachment stays PNG).
      const mime = animated ? "image/webp" : size.mime;
      if (mime === "image/jpeg") pipeline.jpeg({ quality: 85 });
      else if (mime === "image/png") pipeline.png();
      else pipeline.webp(size.webp ?? { quality: 82 });
      const info = await pipeline.toFile(path);
      output.push({
        path,
        contentType: mime,
        width: info.width,
        // An animation is written as its frames stacked; one frame is what is shown.
        height: info.pageHeight ?? info.height,
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
