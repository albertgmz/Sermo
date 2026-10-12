import "server-only";

import { FileMetadata, SiteSettings } from "@sermo/core/contracts";
import { apiUrl, publicUrl } from "./config";
import { SermoError } from "./errors";
import {
  type Forward,
  forwardFromHeaders,
  forwardHeaders,
  hasSessionCookie,
} from "./transport";

// The pictures a member uploads for their own profile: each is then attached by its own operation
// (images.setAvatar, images.setCover).
export const PICTURE_PURPOSES = ["avatar", "cover"] as const;
export type PicturePurpose = (typeof PICTURE_PURPOSES)[number];

export const isPicturePurpose = (value: unknown): value is PicturePurpose =>
  typeof value === "string" && PICTURE_PURPOSES.some((p) => p === value);

// The purposes members upload for: the pictures above and the files of a post.
export const MEMBER_PURPOSES = ["attachment", ...PICTURE_PURPOSES] as const;

// The purposes the administration panel uploads for, as an explicit list. Every purpose of the
// backend is classified here or in `MEMBER_PURPOSES`; a test fails when the backend adds one that
// is in neither, so a new kind of upload is never allowed by accident.
export const PANEL_PURPOSES = [
  "node_icon",
  "node_cover",
  "frame",
  "cover_preset",
  "thread_cover",
  "award_image",
  "shop_image",
  "site_logo",
  "site_icon",
  "site_backdrop",
] as const;

export const UPLOAD_PURPOSES = [...MEMBER_PURPOSES, ...PANEL_PURPOSES] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const isUploadPurpose = (value: unknown): value is UploadPurpose =>
  typeof value === "string" && UPLOAD_PURPOSES.some((p) => p === value);

// Every purpose of the backend, for the test that checks the lists above are complete.
export const BACKEND_PURPOSES: readonly string[] =
  FileMetadata.shape.purpose.options;

// The most a request may declare before anything is read from it. A member cannot read the
// site's own limit (`settings.get` is for administrators), so this is a backstop, not the rule:
// the contract's highest value for that limit, plus room for the multipart framing. The backend
// holds the real limit and refuses a larger file itself while it reads.
export const DECLARED_LENGTH_CEILING =
  SiteSettings.shape.maxUploadBytes.maxValue + 1024 * 1024;

// The part of an incoming request that is passed on: its body is never read here, only handed on
// as a stream, so the size of a file is not a size this app holds in memory.
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

// Why an upload was not made. Each route words these its own way (a redirect, a JSON line).
//   session      No session cookie, or the backend no longer accepts it.
//   origin       The request does not come from this site's own pages.
//   type         The body is not a multipart form.
//   length       The request does not declare its length.
//   size         The declared length is above the ceiling.
//   refused      The backend refused; `message` is its own and `status` its status.
//   failed       The API could not be reached or answered something unreadable.
export type UploadRefusal =
  | "session"
  | "origin"
  | "type"
  | "length"
  | "size"
  | "refused"
  | "failed";

export type Received =
  | { ok: true; fileId: number }
  | { ok: false; reason: UploadRefusal; status: number; message?: string };

const refuse = (
  reason: UploadRefusal,
  status: number,
  message?: string,
): Received => ({ ok: false, reason, status, message });

const MULTIPART = /^multipart\/form-data\s*(?:;|$)/i;

// What an upload route does with a request, in one place so the three routes cannot differ: the
// checks that cost nothing and need no body (a session cookie, this site's origin, a multipart
// content type, a declared length within the ceiling), then the body is streamed to the backend as
// the visitor and the stored file's id is answered. Nothing is read before the checks pass, and
// the body is never buffered. The caller has already checked that the purpose is one it allows.
//
// Whether the visitor may upload this purpose is the backend's to say; so is the size of the file.
export async function receiveUpload(
  request: Request,
  purpose: UploadPurpose,
): Promise<Received> {
  if (!hasSessionCookie(request.headers.get("cookie") ?? undefined)) {
    return refuse("session", 401);
  }
  const origin = request.headers.get("origin");
  if (origin === null || origin !== new URL(publicUrl()).origin) {
    return refuse("origin", 403);
  }
  const contentType = request.headers.get("content-type");
  if (!request.body || !contentType || !MULTIPART.test(contentType)) {
    return refuse("type", 400);
  }
  const declared = request.headers.get("content-length");
  if (
    declared === null ||
    !/^\d{1,16}$/.test(declared) ||
    Number(declared) < 1
  ) {
    return refuse("length", 411);
  }
  if (Number(declared) > DECLARED_LENGTH_CEILING) return refuse("size", 413);
  try {
    const fileId = await uploadWith(
      forwardFromHeaders(request.headers),
      purpose,
      { body: request.body, contentType },
    );
    return { ok: true, fileId };
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    if (error.code === "unauthenticated") return refuse("session", 401);
    if (error.code === "internal") {
      console.error("An upload could not be made", error);
      return refuse("failed", 502);
    }
    return refuse("refused", error.status, error.message);
  }
}
