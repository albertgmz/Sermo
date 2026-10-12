import "server-only";

import { visitorForward } from "./client";
import { apiUrl } from "./config";
import { SermoError } from "./errors";
import { type Forward, forwardHeaders } from "./transport";

export type UploadPurpose = "avatar" | "cover";

// Sends one file to the backend as the visitor and answers the id the file was stored under,
// which an operation (images.setAvatar, images.setCover) then attaches. An upload is not an
// operation: it is a multipart POST, and the runtime sets the content type with its boundary.
export async function uploadWith(
  forward: Forward,
  purpose: UploadPurpose,
  file: Blob,
  filename: string,
): Promise<number> {
  const body = new FormData();
  body.append("file", file, filename);
  let response: Response;
  try {
    response = await fetch(
      `${apiUrl()}/api/v1/files?purpose=${encodeURIComponent(purpose)}`,
      {
        method: "POST",
        headers: forwardHeaders(forward, false),
        body,
        cache: "no-store",
        redirect: "manual",
      },
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

export async function upload(
  purpose: UploadPurpose,
  file: File,
): Promise<number> {
  return uploadWith(await visitorForward(), purpose, file, file.name);
}
