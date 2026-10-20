import "server-only";

import { MAX_REACTION_IMAGE_SIDE } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { APPROVAL_ISSUE_PATH, type SermoError } from "./errors";
import { megabytes } from "./upload-limit";

// Why the backend refused an upload, from the `upload` issue of its refusal: the backend's
// `UPLOAD_REFUSAL_PATH` and `UPLOAD_REFUSALS` (modules/storage/refusal.ts), written out here
// because the web app knows the backend only through its answers (a test holds them equal).
export const UPLOAD_ISSUE_PATH = "upload";
export const UPLOAD_REASONS = [
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

// What a refusal is worded by: the backend's reason, or for a refusal that names none, what its
// code says (the account waits for approval, the member may not upload this, too many uploads).
export type UploadCause =
  | (typeof UPLOAD_REASONS)[number]
  | "approval"
  | "forbidden"
  | "rateLimited";

const isReason = (value: unknown): value is (typeof UPLOAD_REASONS)[number] =>
  UPLOAD_REASONS.some((reason) => reason === value);

// The cause of a backend refusal and, for `size`, the limit it names in bytes. Undefined for a
// refusal it cannot word (a malformed request): the route says the upload failed.
export function refusalCause(
  error: SermoError,
): { cause: UploadCause; limit?: number } | undefined {
  for (const issue of error.issues ?? []) {
    if (!Array.isArray(issue.path)) continue;
    if (issue.path[0] === APPROVAL_ISSUE_PATH) return { cause: "approval" };
    if (issue.path[0] === UPLOAD_ISSUE_PATH && isReason(issue.message)) {
      const limit = issue.path[1];
      return {
        cause: issue.message,
        ...(typeof limit === "number" && { limit }),
      };
    }
  }
  if (error.code === "forbidden") return { cause: "forbidden" };
  if (error.code === "rate_limited") return { cause: "rateLimited" };
  return undefined;
}

// A size limit as members read it: megabytes from 1 MB, kilobytes below, bytes below 1 KB.
export function sizeOf(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${megabytes(bytes)} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// A refusal in the member's language, saying what to do; undefined when there is no cause to word.
export async function refusalWords(refused: {
  cause?: UploadCause;
  limit?: number;
}): Promise<string | undefined> {
  const { cause, limit } = refused;
  if (cause === undefined) return undefined;
  const t = await getTranslations("lib.uploadRefusals");
  if (cause === "size") {
    if (limit === undefined) return t("sizeUnknown");
    // A limit of 0 is a group that may upload no file at all.
    if (limit === 0) return t("forbidden");
    return t("size", { size: sizeOf(limit) });
  }
  if (cause === "reaction")
    return t("reaction", { side: MAX_REACTION_IMAGE_SIDE });
  return t(cause);
}
