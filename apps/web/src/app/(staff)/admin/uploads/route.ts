import { getTranslations } from "next-intl/server";
import { hasSessionCookie } from "@/lib/sermo/transport";
import {
  PANEL_PURPOSES,
  receiveUpload,
  type UploadPurpose,
  type UploadRefusal,
} from "@/lib/sermo/upload";
import { megabytes } from "@/lib/sermo/upload-limit";
import { viewerOf } from "@/lib/sermo/viewer";

const answer = (body: { id: number } | { error: string }, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const absent = () => new Response(null, { status: 404 });

const isPanelPurpose = (value: string | null): value is UploadPurpose =>
  PANEL_PURPOSES.some((allowed) => allowed === value);

// The panel's picture upload: `POST /admin/uploads?purpose=<purpose>` with a multipart body that
// holds one file. `receiveUpload` hands the body on to the backend as it arrives, as the visitor,
// and never reads it here; the backend checks the permission the purpose needs, and the type and
// the size of the file. The answer is `{ id }`, the id the file was stored under, which the form
// then names in the action that attaches it, or `{ error }` with the backend's own message and
// status.
//
// The proxy skips this path (its matcher), because it would copy the body and cut it short, so
// the proxy's gate for the panel does not run and this route decides itself: whoever is not
// allowed in the panel gets the 404 of an address that does not exist, for every method, before
// anything is read. One `auth.me` read decides.
export async function POST(request: Request) {
  if (!(await mayUsePanel(request))) return absent();
  const t = await getTranslations("adminForums.uploads");
  const purpose = new URL(request.url).searchParams.get("purpose");
  if (!isPanelPurpose(purpose)) return answer({ error: t("purpose") }, 400);
  const received = await receiveUpload(request, purpose);
  if (received.ok) return answer({ id: received.fileId });
  if (received.reason === "session") return absent();
  const words: Record<UploadRefusal, string> = {
    session: "",
    origin: t("notAllowed"),
    type: t("noFile"),
    length: t("noFile"),
    size:
      received.limit === undefined
        ? t("tooLarge")
        : t("overLimit", { size: megabytes(received.limit) }),
    refused: received.message ?? t("failed"),
    failed: t("failed"),
  };
  return answer({ error: words[received.reason] }, received.status);
}

async function mayUsePanel(request: Request) {
  if (!hasSessionCookie(request.headers.get("cookie") ?? undefined)) {
    return false;
  }
  // An API that cannot be reached cannot take the file either: the answer is the same.
  try {
    return (await viewerOf(request.headers))?.staff.panel === true;
  } catch {
    return false;
  }
}

// There is no page here: every other method is the 404 of an address that does not exist.
export const GET = absent;
export const HEAD = absent;
export const PUT = absent;
export const PATCH = absent;
export const DELETE = absent;
export const OPTIONS = absent;
