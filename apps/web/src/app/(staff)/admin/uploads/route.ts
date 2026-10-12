import { FileMetadata } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { apiUrl, publicUrl } from "@/lib/sermo/config";
import {
  forwardFromHeaders,
  forwardHeaders,
  hasSessionCookie,
} from "@/lib/sermo/transport";

// The purposes the panel uploads for: every purpose of the backend except the ones a member
// uploads for (`lib/sermo/upload.ts` and the attachment route have those).
const MEMBER_PURPOSES: readonly string[] = ["attachment", "avatar", "cover"];
const PANEL_PURPOSES = FileMetadata.shape.purpose.options.filter(
  (purpose) => !MEMBER_PURPOSES.includes(purpose),
);

const answer = (body: { id: number } | { error: string }, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// The panel's picture upload: `POST /admin/uploads?purpose=<purpose>` with a multipart body that
// holds one file. The body is handed on to the backend as it arrives, as the visitor, and never
// read here; the backend checks the permission the purpose needs, and the type and the size of
// the file. The answer is `{ id }`, the id the file was stored under, which the form then names
// in the action that attaches it, or `{ error }` with the backend's own message and status.
//
// The proxy skips this path (its matcher), because it would copy the body and cut it short, so
// the proxy's gate for the panel does not run: a visitor without a session cookie gets a 404
// before anything is read, like every other address of the panel.
export async function POST(request: Request) {
  if (!hasSessionCookie(request.headers.get("cookie") ?? undefined)) {
    return new Response(null, { status: 404 });
  }
  const t = await getTranslations("adminForums.uploads");
  const origin = request.headers.get("origin");
  if (origin === null || origin !== new URL(publicUrl()).origin) {
    return answer({ error: t("notAllowed") }, 403);
  }
  const purpose = new URL(request.url).searchParams.get("purpose");
  if (!PANEL_PURPOSES.some((allowed) => allowed === purpose)) {
    return answer({ error: t("purpose") }, 400);
  }
  const type = request.headers.get("content-type");
  if (!request.body || !type?.startsWith("multipart/form-data")) {
    return answer({ error: t("noFile") }, 400);
  }
  const headers = forwardHeaders(forwardFromHeaders(request.headers), false);
  headers.set("content-type", type);
  let response: Response;
  try {
    response = await fetch(
      `${apiUrl()}/api/v1/files?purpose=${encodeURIComponent(String(purpose))}`,
      {
        method: "POST",
        headers,
        body: request.body,
        duplex: "half",
        cache: "no-store",
        redirect: "manual",
      } as RequestInit,
    );
  } catch {
    return answer({ error: t("unreachable") }, 502);
  }
  const payload: unknown = await response.json().catch(() => null);
  const id = (payload as { id?: unknown } | null)?.id;
  if (response.ok && typeof id === "number") return answer({ id });
  const refusal = (payload as { error?: { message?: unknown } } | null)?.error
    ?.message;
  return answer(
    { error: typeof refusal === "string" ? refusal : t("failed") },
    response.ok ? 502 : response.status,
  );
}
