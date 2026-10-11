import { type NextRequest, NextResponse } from "next/server";
import {
  getAward,
  getConversation,
  getForum,
  getThread,
  getUser,
} from "@/lib/db";
import { COOKIE } from "@/lib/session";

type Finder = (id: string, viewerId: number) => Promise<unknown>;

const numeric =
  <T>(find: (id: number, viewerId: number) => Promise<T>): Finder =>
  async (id, viewerId) =>
    String(Number(id)) === id && find(Number(id), viewerId);

const CONTENT: Record<string, Finder> = {
  members: getUser,
  forums: getForum,
  awards: getAward,
  threads: numeric(getThread),
  conversations: numeric(getConversation),
};

const MEMBERS_ONLY = ["account", "notifications", "conversations"];

export async function proxy(request: NextRequest) {
  const [, section, id, action] = request.nextUrl.pathname.split("/");
  const viewer = request.cookies.get(COOKIE)?.value;
  const membersOnly = MEMBERS_ONLY.includes(section) || action === "new";
  if (membersOnly && !viewer) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const find = id && id !== "new" ? CONTENT[section] : undefined;
  if (find && !(await find(id, Number(viewer)))) {
    return NextResponse.rewrite(new URL("/not-found", request.url), {
      status: 404,
    });
  }
}

export const config = {
  matcher: [
    "/account",
    "/notifications",
    "/conversations/:path*",
    "/members/:username",
    // Not the pictures in /public/forums.
    "/forums/:slug((?!.*\\.jpg$).+)",
    "/forums/:slug/new",
    "/threads/:id",
    // Not the pictures in /public/awards.
    "/awards/:slug((?!.*\\.svg$).+)",
  ],
};
