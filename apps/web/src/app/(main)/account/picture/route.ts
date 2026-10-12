import { imagesSetAvatar, imagesSetCover } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { failedPath } from "@/app/(main)/account/notice";
import { errorMessage } from "@/lib/sermo/client";
import { publicUrl } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import {
  callWith,
  forwardFromHeaders,
  hasSessionCookie,
} from "@/lib/sermo/transport";
import { isUploadPurpose, uploadWith } from "@/lib/sermo/upload";

const ACCOUNT = "/account";

const see = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });

// The browser says where the form was posted from; only this site's own pages may post here.
function fromThisSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const { host } = new URL(origin);
    return (
      host === request.headers.get("x-forwarded-host") ||
      host === request.headers.get("host") ||
      origin === new URL(publicUrl()).origin
    );
  } catch {
    return false;
  }
}

// A picture of a size the site allows is far larger than a server action takes, so it does not
// travel as one: the body is handed on to the backend as it arrives, never read or held here, and
// the backend says whether the picture is acceptable. Without a session cookie nothing is read.
// The proxy skips this path (its matcher) so that it does not buffer the body either.
export async function POST(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  if (!isUploadPurpose(kind)) return new Response(null, { status: 400 });
  if (!hasSessionCookie(request.headers.get("cookie") ?? undefined)) {
    return see(`/login?next=${encodeURIComponent(ACCOUNT)}`);
  }
  if (!fromThisSite(request)) return new Response(null, { status: 403 });
  const forward = forwardFromHeaders(request.headers);
  try {
    const fileId = await uploadWith(forward, kind, {
      body: request.body,
      contentType: request.headers.get("content-type"),
    });
    await callWith(
      forward,
      kind === "avatar" ? imagesSetAvatar : imagesSetCover,
      {
        fileId,
      },
    );
  } catch (error) {
    if (error instanceof SermoError && error.code === "unauthenticated") {
      return see(`/login?next=${encodeURIComponent(ACCOUNT)}`);
    }
    return see(failedPath(ACCOUNT, kind, await errorMessage(error)));
  }
  revalidatePath("/", "layout");
  return see(`${ACCOUNT}?notice=${kind}#${kind}`);
}
