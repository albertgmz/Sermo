import { nodesGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { apiUrl } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import {
  callWith,
  forwardFromHeaders,
  forwardHeaders,
  sermoCookies,
} from "@/lib/sermo/transport";

const failure = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

// Takes one file for a post in the forum whose id is in the address (the segment is called id like
// its siblings, but here it names a forum) and hands it on to the backend as the visitor, without
// reading it: a file does not go through a server action, whose body the app would have to
// allow at a large size. The answer is the id the backend stored the file under, which the post
// then names when it is saved. The forum is only there to ask whether the visitor may attach.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = await getTranslations("threads.uploads");
  const nodeId = parseId((await params).id);
  if (nodeId === null) return failure(t("notFound"), 404);
  const forward = forwardFromHeaders(request.headers);
  if (!sermoCookies(forward.cookie)) return failure(t("signIn"), 401);
  const type = request.headers.get("content-type");
  if (!request.body || !type?.startsWith("multipart/form-data")) {
    return failure(t("noFile"), 400);
  }
  try {
    const { resolvedPermissions } = await callWith(forward, nodesGet, {
      nodeId,
    });
    if (!resolvedPermissions["forum.uploadAttachments"]) {
      return failure(t("notAllowed"), 403);
    }
    const headers = forwardHeaders(forward, false);
    headers.set("content-type", type);
    const response = await fetch(
      `${apiUrl()}/api/v1/files?purpose=attachment`,
      {
        method: "POST",
        headers,
        body: request.body,
        duplex: "half",
        cache: "no-store",
        redirect: "manual",
      } as RequestInit,
    );
    const payload: unknown = await response.json().catch(() => null);
    const stored = (payload as { id?: unknown } | null)?.id;
    if (response.ok && typeof stored === "number") {
      return Response.json(
        { id: stored },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const refusal = (payload as { error?: { message?: unknown } } | null)?.error
      ?.message;
    return failure(
      typeof refusal === "string" ? refusal : t("failed"),
      response.ok ? 502 : response.status,
    );
  } catch (error) {
    if (error instanceof SermoError && error.code !== "internal") {
      return failure(error.message, error.status);
    }
    console.error("An attachment could not be uploaded", error);
    return failure(t("failed"), 502);
  }
}
