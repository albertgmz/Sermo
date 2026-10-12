import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import {
  getAward,
  getConversation,
  getForum,
  getThread,
  getUser,
  getUserById,
} from "@/lib/db";
import {
  blocksImageRequest,
  isImageRequest,
  isUnknownUnsafePath,
  pictureInPageFolder,
} from "@/lib/lite-images";
import {
  LITE_COOKIE,
  parseLiteCookieHeader,
  serializeLiteCookie,
} from "@/lib/lite-preferences";
import { viewerOf } from "@/lib/sermo/viewer";

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

const SESSION_COOKIES = ["sermo.session_token", "__Secure-sermo.session_token"];

const MEMBERS_ONLY = ["account", "notifications", "conversations"];

// Carries the path and query a visitor asked for to the page that renders it: a Server
// Component does not know its own URL (`read()` in lib/sermo/client.ts reads it).
const PATH_HEADER = "x-sermo-path";

// Lets the request go on to a page. Only a read of the page (GET, HEAD) carries the path; an
// action's POST does not. Whatever the client sent under that name never survives.
function toPage(request: NextRequest) {
  const headers = new Headers(request.headers);
  if (request.method === "GET" || request.method === "HEAD") {
    headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  } else {
    headers.delete(PATH_HEADER);
  }
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  const response = await handleRequest(request);
  // Old installations set an HttpOnly preference. Replace it so tab sync can
  // observe changes without treating an invisible legacy cookie as a mismatch.
  if (
    request.cookies.get(LITE_COOKIE)?.value === "1" &&
    request.method === "GET"
  ) {
    const migrated = response ?? NextResponse.next();
    migrated.cookies.set(
      LITE_COOKIE,
      serializeLiteCookie(
        parseLiteCookieHeader(request.headers.get("cookie") ?? ""),
      ),
      {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      },
    );
    return migrated;
  }
  return response;
}

function notFound(request: NextRequest) {
  return NextResponse.rewrite(new URL("/not-found", request.url), {
    status: 404,
  });
}

// The proxy runs on Node, so the public folder can be read directly. Names are
// compared lower-cased because the request path is.
function publicFileExists([folder, name]: [string, string]) {
  try {
    return readdirSync(join(process.cwd(), "public", folder)).some(
      (file) => file.toLowerCase() === name,
    );
  } catch {
    return false;
  }
}

async function handleRequest(request: NextRequest) {
  // The API is served by the rewrite in next.config.ts; nothing here applies to it.
  if (request.nextUrl.pathname.startsWith("/api/")) return;
  // Folders that are also page namespaces hold pictures only under the names
  // of real files; anything else there is an unknown page.
  const shared = pictureInPageFolder(request.nextUrl.pathname);
  if (shared && !publicFileExists(shared)) return notFound(request);
  const lite = parseLiteCookieHeader(request.headers.get("cookie") ?? "");
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
  if (isImageRequest(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    response.headers.set("Vary", "Cookie");
    return response;
  }
  if (request.nextUrl.pathname.startsWith("/_next/")) return;
  if (isUnknownUnsafePath(request.nextUrl.pathname)) return notFound(request);
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return toPage(request);
  }
  const [, section, id, action] = pathname.split("/");
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (section === "admin") {
    const viewer = hasSession ? await viewerOf(request.headers) : null;
    if (!viewer?.permissions.isAdmin) return notFound(request);
  }
  const membersOnly = MEMBERS_ONLY.includes(section) || action === "new";
  if (membersOnly && !hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.redirect(login);
  }
  const find =
    id && !(section === "conversations" && id === "new")
      ? CONTENT[section]
      : undefined;
  if (find) {
    let viewerId = Number.NaN;
    if (section === "conversations") {
      // The conversations still live in the JSON data, under the JSON twin of the account.
      const account = (await viewerOf(request.headers))?.user;
      const twin = account ? await getUser(account.username) : null;
      if (!twin) return notFound(request);
      viewerId = twin.id;
    }
    if (!(await find(id, viewerId))) return notFound(request);
  }
  return toPage(request);
}

// Match before decoding, including image optimizer requests and file aliases.
// Non-image Next internals return before the existing page access rules.
export const config = {
  matcher: ["/:path*"],
};
