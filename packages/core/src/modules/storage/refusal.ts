import { ValidationError } from "../../errors";

/**
 * Why an upload was refused, carried as the `upload` issue of the refusal so that a client words
 * it in the member's language instead of showing the English message:
 *   type        the site does not take files of this type here
 *   heic        a HEIC/HEIF photo, which the image library cannot read
 *   empty       the file has no bytes
 *   size        over the size limit; the issue's path carries the limit in bytes
 *   quota       over the member's storage quota
 *   unreadable  the bytes are not what the file claims, or the picture cannot be read
 *   dimensions  a picture too large in pixels to read safely
 *   animation   an animation this purpose does not take, or with too many frames or pixels
 *   reaction    a reaction picture over its largest side
 */
export const UPLOAD_REFUSALS = [
  "type",
  "heic",
  "empty",
  "size",
  "quota",
  "unreadable",
  "dimensions",
  "animation",
  "reaction",
] as const;
export type UploadRefusalReason = (typeof UPLOAD_REFUSALS)[number];

/** The `path` of the issue that names why an upload was refused. */
export const UPLOAD_REFUSAL_PATH = "upload";

/** A refusal of an upload: the English `message`, and the reason (and, for `size`, the limit) as its issue. */
export const uploadRefusal = (reason: UploadRefusalReason, message: string, limit?: number) =>
  new ValidationError(message, [
    {
      path: limit === undefined ? [UPLOAD_REFUSAL_PATH] : [UPLOAD_REFUSAL_PATH, limit],
      message: reason,
    },
  ]);
