import { type NextRequest, NextResponse } from "next/server";
import {
  getAward,
  getConversation,
  getForum,
  getThread,
  getUserById,
} from "@/lib/db";
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
    "/account/:path*",
    "/admin/:path*",
    "/notifications",
    "/conversations/:path*",
    "/members/:id",
    // Not the pictures in /public/forums.
    "/forums/:id((?!.*\\.jpg$).+)",
    "/forums/:id/new",
    "/threads/:id",
    // Not the pictures in /public/awards.
    "/awards/:id((?!.*\\.svg$).+)",
  ],
};
