import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  conversationsGet,
  nodesGet,
  PageSlug,
  pagesGet,
  postsList,
} from "@sermo/core/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { getAward, getUserById } from "@/lib/db";
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
import { SermoError } from "@/lib/sermo/errors";
import {
  callWith,
  type Forward,
  forwardFromHeaders,
} from "@/lib/sermo/transport";
import { viewerOf } from "@/lib/sermo/viewer";

type Finder = (
  id: string,
  viewerId: number,
  request: NextRequest,
) => Promise<unknown>;

const isId = (id: string) =>
  /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

const numeric =
  <T>(find: (id: number, viewerId: number) => Promise<T>): Finder =>
  async (id, viewerId) =>
    isId(id) && find(Number(id), viewerId);

// Asks the backend as the visitor. Only its "not found" is a missing record; any other answer,
// an outage included, lets the request through so the page can show its own error.
async function exists(
  request: NextRequest,
  ask: (forward: Forward) => Promise<unknown>,
) {
  try {
    await ask(forwardFromHeaders(request.headers));
    return true;
  } catch (error) {
    return !(error instanceof SermoError && error.code === "not_found");
  }
}

const backend =
  (ask: (id: number, forward: Forward) => Promise<unknown>): Finder =>
  async (id, _viewerId, request) =>
    isId(id) && exists(request, (forward) => ask(Number(id), forward));

const CONTENT: Record<string, Finder> = {
  members: numeric(getUserById),
  forums: backend((nodeId, forward) => callWith(forward, nodesGet, { nodeId })),
  awards: numeric(getAward),
  // `threads.get` would count a view; one post of the thread proves the viewer can open it.
  threads: backend((threadId, forward) =>
    callWith(forward, postsList, { threadId, limit: 1 }),
  ),
  // A conversation the visitor is not part of is "not found" for them.
  conversations: backend((conversationId, forward) =>
    callWith(forward, conversationsGet, { conversationId }),
  ),
};

const STATIC_PAGES = ["terms", "privacy", "legal", "contact"];

// The slug of the static page this path asks for, if it is one.
function staticSlug(section: string, id: string | undefined, action?: string) {
  if (STATIC_PAGES.includes(section) && !id) return section;
  if (section === "pages" && id && !action) return id;
  return undefined;
}

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
  const slug = staticSlug(section, id, action);
  if (slug !== undefined) {
    const parsed = PageSlug.safeParse(slug);
    if (
      !parsed.success ||
      !(await exists(request, (forward) =>
        callWith(forward, pagesGet, { slug: parsed.data }),
      ))
    ) {
      return notFound(request);
    }
  }
  const find =
    id && !(section === "conversations" && id === "new")
      ? CONTENT[section]
      : undefined;
  if (find) {
    if (!(await find(id, Number.NaN, request))) return notFound(request);
  }
  return toPage(request);
}

// Match before decoding, including image optimizer requests and file aliases.
// Non-image Next internals return before the existing page access rules.
export const config = {
  matcher: ["/:path*"],
};
