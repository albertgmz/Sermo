import { type NextRequest, NextResponse } from "next/server";
import {
  getAward,
  getConversation,
  getForum,
  getThread,
  getUserById,
} from "@/lib/db";
import { LITE_COOKIE } from "@/lib/lite-mode";
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
  const image =
    /^\/(?:avatars|frames|covers|thread-covers|forums|awards|shop)\/.+\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(
      request.nextUrl.pathname,
    ) || ["/logo.svg", "/icon.svg"].includes(request.nextUrl.pathname);
  if (image) {
    if (request.cookies.get(LITE_COOKIE)?.value === "1") {
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
    return;
  }
  const [, section, id, action] = request.nextUrl.pathname.split("/");
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

export const config = {
  matcher: [
    "/avatars/:path*",
    "/frames/:path*",
    "/covers/:path*",
    "/thread-covers/:path*",
    "/shop/:path*",
    "/logo.svg",
    "/icon.svg",
    "/account/:path*",
    "/admin/:path*",
    "/notifications",
    "/conversations/:path*",
    "/members/:id",
    // Picture requests bypass the content rules when LITE mode is off.
    "/forums/:image(.+\\.(?:avif|gif|ico|jpe?g|png|svg|webp))",
    "/forums/:id((?!.*\\.jpg$).+)",
    "/forums/:id/new",
    "/threads/:id",
    "/awards/:image(.+\\.(?:avif|gif|ico|jpe?g|png|svg|webp))",
    "/awards/:id((?!.*\\.svg$).+)",
  ],
};
