import { imagesSetAvatar, imagesSetCover } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { failedPath } from "@/app/[locale]/(main)/account/notice";
import { errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { callWith, forwardFromHeaders } from "@/lib/sermo/transport";
import { isPicturePurpose, receiveUpload } from "@/lib/sermo/upload";
import { megabytes } from "@/lib/sermo/upload-limit";

const ACCOUNT = "/account";

const see = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });

// The framing dialog posts the picture from a script and asks for JSON; a plain form post is
// answered with a redirect back to the page.
const NO_STORE = { "cache-control": "no-store" };
const wantsJson = (request: Request) =>
  request.headers.get("accept")?.includes("application/json") ?? false;

const signIn = (json: boolean) =>
  json
    ? Response.json({ error: "" }, { status: 401, headers: NO_STORE })
    : see(`/login?next=${encodeURIComponent(ACCOUNT)}`);

const failure = (
  json: boolean,
  kind: string,
  message: string,
  status: number,
) =>
  json
    ? Response.json({ error: message }, { status, headers: NO_STORE })
    : see(failedPath(ACCOUNT, kind, message));

// A picture of a size the site allows is far larger than a server action takes, so it does not
// travel as one: `receiveUpload` hands the body on to the backend as it arrives, never read or
// held here, and the backend says whether the picture is acceptable. The checks that need no
// body (session cookie, origin, content type, declared length) run before anything is read.
// The proxy skips this path (its matcher) so that it does not buffer the body either.
export async function POST(request: NextRequest) {
  const json = wantsJson(request);
  const kind = request.nextUrl.searchParams.get("kind");
  if (!isPicturePurpose(kind)) return new Response(null, { status: 400 });
  const received = await receiveUpload(request, kind);
  if (!received.ok) {
    if (received.reason === "session") return signIn(json);
    if (received.reason === "origin")
      return new Response(null, { status: 403 });
    const message =
      received.message ??
      (received.reason === "size" && received.limit !== undefined
        ? (await getTranslations("account.pictures"))("overLimit", {
            size: megabytes(received.limit),
          })
        : (await getTranslations("lib.errors"))("generic"));
    return failure(json, kind, message, received.status);
  }
  try {
    await callWith(
      forwardFromHeaders(request.headers),
      kind === "avatar" ? imagesSetAvatar : imagesSetCover,
      { fileId: received.fileId },
    );
  } catch (error) {
    if (error instanceof SermoError && error.code === "unauthenticated") {
      return signIn(json);
    }
    return failure(
      json,
      kind,
      await errorMessage(error),
      error instanceof SermoError ? error.status : 500,
    );
  }
  revalidatePath("/", "layout");
  if (json) return Response.json({ ok: true }, { headers: NO_STORE });
  return see(`${ACCOUNT}?notice=${kind}#${kind}`);
}
