import { nodesGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { apiUrl, publicUrl } from "@/lib/sermo/config";
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
// its siblings, but here it names a forum) and hands it on to the backend as the visitor. A file
// does not go through a server action, whose body the app would have to allow at a large size.
// The answer is the id the backend stored the file under, which the post then names when it is
// saved. The forum is only there to ask whether the visitor may attach.
//
// The proxy buffers the body of every request up to a limit and passes on only that much of a
// larger one, as if the visitor had sent no more. A file cut short that way would reach the
// backend as a broken form and be refused with a message that says nothing, so the length the
// visitor declared is compared with what arrived first.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = await getTranslations("threads.uploads");
  const nodeId = parseId((await params).id);
  if (nodeId === null) return failure(t("notFound"), 404);
  const forward = forwardFromHeaders(request.headers);
  if (!sermoCookies(forward.cookie)) return failure(t("signIn"), 401);
  // Only this site posts here: the backend is told the request came from it.
  const origin = request.headers.get("origin");
  if (origin === null || origin !== new URL(publicUrl()).origin) {
    return failure(t("notAllowed"), 403);
  }
  const type = request.headers.get("content-type");
  if (!request.body || !type?.startsWith("multipart/form-data")) {
    return failure(t("noFile"), 400);
  }
  const body = await request.arrayBuffer();
  const declared = Number(request.headers.get("content-length"));
  if (!(declared > 0)) return failure(t("noFile"), 411);
  if (declared > body.byteLength) {
    return failure(t("tooLarge"), 413);
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
        body,
        cache: "no-store",
        redirect: "manual",
      },
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
