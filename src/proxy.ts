import { type NextRequest, NextResponse } from "next/server";
import {
  getAward,
  getConversation,
  getForum,
  getThread,
  getUserById,
} from "@/lib/db";
import { blocksImageRequest, isImageRequest } from "@/lib/lite-images";
import { LITE_COOKIE, parseLiteCookie } from "@/lib/lite-preferences";
import { COOKIE } from "@/lib/session";

type Finder = (id: string, viewerId: number) => Promise<unknown>;

const numeric =
  <T>(find: (id: number, viewerId: number) => Promise<T>): Finder =>
  async (id, viewerId) =>
    /^[1-9]\d*$/.test(id) &&
    Number.isSafeInteger(Number(id)) &&
    find(Number(id), viewerId);

const CONTENT: Record<string, Finder> = {
  members: numeric(getUserById),
  forums: numeric(getForum),
  awards: numeric(getAward),
  threads: numeric(getThread),
  conversations: numeric(getConversation),
};

const MEMBERS_ONLY = ["account", "notifications", "conversations"];

export async function proxy(request: NextRequest) {
  const response = await handleRequest(request);
  // Old installations set an HttpOnly preference. Replace it so tab sync can
  // observe changes without treating an invisible legacy cookie as a mismatch.
  if (
    request.cookies.get(LITE_COOKIE)?.value === "1" &&
    request.method === "GET"
  ) {
    const migrated = response ?? NextResponse.next();
    migrated.cookies.set(LITE_COOKIE, "all", {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return migrated;
  }
  return response;
}

async function handleRequest(request: NextRequest) {
  const lite = parseLiteCookie(request.cookies.get(LITE_COOKIE)?.value);
  if (blocksImageRequest(lite, request.nextUrl.pathname)) {
    return new NextResponse(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><text x="80" y="45" text-anchor="middle" dominant-baseline="middle" fill="var(--muted-foreground, currentColor)">LITE MODE</text></svg>',
      {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  if (isImageRequest(request.nextUrl.pathname)) return;
  if (request.nextUrl.pathname.startsWith("/_next/")) return;
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return;
  }
  const [, section, id, action] = pathname.split("/");
  const viewer = request.cookies.get(COOKIE)?.value;
  if (section === "admin") {
    const user = viewer ? await getUserById(Number(viewer)) : null;
    if (user?.role !== "admin") {
      return NextResponse.rewrite(new URL("/not-found", request.url), {
        status: 404,
      });
    }
  }
  const membersOnly = MEMBERS_ONLY.includes(section) || action === "new";
  if (membersOnly && !viewer) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const find =
    id && !(section === "conversations" && id === "new")
      ? CONTENT[section]
      : undefined;
  if (find && !(await find(id, Number(viewer)))) {
    return NextResponse.rewrite(new URL("/not-found", request.url), {
      status: 404,
    });
  }
}

// Match before decoding, including image optimizer requests and file aliases.
// Non-image Next internals return before the existing page access rules.
export const config = {
  matcher: ["/:path*"],
};
