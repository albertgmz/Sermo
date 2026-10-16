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
});
