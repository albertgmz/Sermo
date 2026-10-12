import "server-only";

import { apiUrl } from "./config";
import { SermoError } from "./errors";
import { type Forward, forwardHeaders } from "./transport";

// The pictures this app uploads: each is then attached by its own operation (images.setAvatar,
// images.setCover). The backend knows more purposes; a member's client never asks for them here.
export const UPLOAD_PURPOSES = ["avatar", "cover"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const isUploadPurpose = (value: unknown): value is UploadPurpose =>
  typeof value === "string" && UPLOAD_PURPOSES.some((p) => p === value);

// The part of an incoming request that is passed on: its body is never read here, only handed on
// as a stream, so the size of a picture is not a size this app holds in memory.
export type UploadSource = {
  body: ReadableStream<Uint8Array> | null;
  contentType: string | null;
};

// Sends the visitor's multipart body to the backend as the visitor and answers the id the file
// was stored under, which an operation then attaches. An upload is not an operation: the
// content type is the visitor's own, with the boundary its body was written with.
export async function uploadWith(
  forward: Forward,
  purpose: UploadPurpose,
  source: UploadSource,
): Promise<number> {
  if (!isUploadPurpose(purpose)) {
    throw new SermoError("validation", 422, "Not a purpose of upload.");
  }
  if (!source.body || !source.contentType) {
    throw new SermoError("validation", 422, "A file is required.");
  }
  const headers = forwardHeaders(forward, false);
  headers.set("content-type", source.contentType);
  let response: Response;
  try {
    response = await fetch(
      `${apiUrl()}/api/v1/files?purpose=${encodeURIComponent(purpose)}`,
      {
        method: "POST",
        headers,
        body: source.body,
        duplex: "half",
        cache: "no-store",
        redirect: "manual",
      } as RequestInit,
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new SermoError(
      "internal",
      500,
      `The API could not be reached: ${error.message}`,
    );
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new SermoError(
      "internal",
      response.status,
      "The API answered with something that is not JSON.",
    );
  }
  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)
      ?.error;
    throw new SermoError(
      typeof error?.code === "string" ? error.code : "internal",
      response.status,
      typeof error?.message === "string"
        ? error.message
        : `The API answered ${response.status}.`,
      Array.isArray(error?.issues) ? error.issues : undefined,
    );
  }
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== "number") {
    throw new SermoError(
      "internal",
      500,
      "The answer of the upload does not carry a file id.",
    );
  }
  return id;
}
