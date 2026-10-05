import * as z from "zod";
import { FILE_PURPOSES, FILE_VISIBILITIES } from "../db/schema";
import { defineContract } from "../operation";
import { Id, Timestamp } from "./common";

export const FileMetadata = z.object({
  id: Id,
  url: z.string(),
  byteSize: z.number().int().nonnegative(),
  contentType: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  purpose: z.enum(FILE_PURPOSES),
  visibility: z.enum(FILE_VISIBILITIES),
  createdAt: Timestamp,
});

export const filesGet = defineContract({
  name: "files.get",
  summary: "Get file metadata after checking the file or attached content's visibility.",
  kind: "read",
  input: z.object({ fileId: Id }),
  output: FileMetadata,
});
