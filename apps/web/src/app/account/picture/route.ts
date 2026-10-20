import { imagesSetAvatar, imagesSetCover } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { callWith, forwardFromHeaders } from "@/lib/sermo/transport";
import { isPicturePurpose, receiveUpload } from "@/lib/sermo/upload";
import { megabytes } from "@/lib/sermo/upload-limit";
import { refusalWords } from "@/lib/sermo/upload-refusal";

const NO_STORE = { "cache-control": "no-store" };

// Always JSON: only the framing dialog posts here. A 401 tells the page to send the member to sign
// in (it knows the address to come back to).
const signIn = () =>
  Response.json({ error: "" }, { status: 401, headers: NO_STORE });

const failure = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: NO_STORE });

// A picture of a size the site allows is far larger than a server action takes, so it does not
// travel as one: `receiveUpload` hands the body on to the backend as it arrives, never read or
// held here, and the backend says whether the picture is acceptable. The checks that need no
// body (session cookie, origin, content type, declared length) run before anything is read.
// The proxy skips this path (its matcher) so that it does not buffer the body either.
export async function POST(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  if (!isPicturePurpose(kind)) return new Response(null, { status: 400 });
  const received = await receiveUpload(request, kind);
  if (!received.ok) {
    if (received.reason === "session") return signIn();
    if (received.reason === "origin")
      return new Response(null, { status: 403 });
    const message =
      (received.reason === "refused"
        ? await refusalWords(received)
        : undefined) ??
      (received.reason === "size" && received.limit !== undefined
        ? (await getTranslations("account.pictures"))("overLimit", {
            size: megabytes(received.limit),
          })
        : (await getTranslations("lib.errors"))("generic"));
    return failure(message, received.status);
  }
  try {
    await callWith(
      forwardFromHeaders(request.headers),
      kind === "avatar" ? imagesSetAvatar : imagesSetCover,
      { fileId: received.fileId },
    );
  } catch (error) {
    if (error instanceof SermoError && error.code === "unauthenticated") {
      return signIn();
    }
    return failure(
      await errorMessage(error),
      error instanceof SermoError ? error.status : 500,
    );
  }
  revalidatePath("/", "layout");
  return Response.json({ ok: true }, { headers: NO_STORE });
}
