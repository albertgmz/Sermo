import * as z from "zod";
import { Id } from "./common";

export const AttachmentIds = z.array(Id).max(30).optional();

export const Attachment = z.object({
  fileId: Id,
  url: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** The name the file was uploaded with; null for a file that has none. */
  filename: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  /**
   * Smaller WebP copies of a still picture wider than 640 pixels, narrowest first: its thumbnail
   * and the copies 640 and 1280 pixels wide that it is wider than. With the file itself they make
   * a `srcset`. Empty for anything else: other files, narrower pictures, animations (whose
   * thumbnail is a still) and pictures stored before the copies were made.
   */
  widths: z.array(z.object({ url: z.string(), width: z.number().int().positive() })),
});
