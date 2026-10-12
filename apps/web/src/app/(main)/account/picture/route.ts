import { imagesSetAvatar, imagesSetCover } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { failedPath } from "@/app/(main)/account/notice";
import { errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { callWith, forwardFromHeaders } from "@/lib/sermo/transport";
import { isPicturePurpose, receiveUpload } from "@/lib/sermo/upload";

const ACCOUNT = "/account";

const see = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });

const signIn = () => see(`/login?next=${encodeURIComponent(ACCOUNT)}`);

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
      received.message ?? (await getTranslations("lib.errors"))("generic");
    return see(failedPath(ACCOUNT, kind, message));
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
    return see(failedPath(ACCOUNT, kind, await errorMessage(error)));
  }
  revalidatePath("/", "layout");
  return see(`${ACCOUNT}?notice=${kind}#${kind}`);
}
