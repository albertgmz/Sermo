import {
  awardsGet,
  conversationsGet,
  PageSlug,
  pagesGet,
  seoNode,
  seoProfile,
  seoThread,
} from "@sermo/core/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { isStaffPath, mayOpenPath } from "@/app/(staff)/registry";
import {
  blocksImageRequest,
  isImageRequest,
  isUnknownUnsafePath,
  normalizeImagePath,
} from "@/lib/lite-images";
import {
  LITE_COOKIE,
  parseLiteCookieHeader,
  serializeLiteCookie,
} from "@/lib/lite-preferences";
import {
  canonicalPathOf,
  FORUM_PREFIX,
  LEGACY_FORUM_PREFIX,
  toBackendPath,
} from "@/lib/sermo/addresses";
import { SermoError } from "@/lib/sermo/errors";
import { parseId, parsePageId } from "@/lib/sermo/ids";
import {
  callWith,
  type Forward,
  forwardFromHeaders,
} from "@/lib/sermo/transport";
import { viewerOf } from "@/lib/sermo/viewer";

// Falsy: there is no such record. A response: answer with it. Anything else: let the page render.
type Finder = (
  id: string,
  action: string | undefined,
  request: NextRequest,
) => Promise<unknown>;

const isId = (id: string) => parseId(id) !== null;

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
  async (id, _action, request) =>
    isId(id) && exists(request, (forward) => ask(Number(id), forward));

// The page of a thread the address asks for; anything but a whole number from 2 up is page 1.
function pageOf(request: NextRequest) {
  const page = request.nextUrl.searchParams.get("page") ?? "";
  return /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1;
}

type Seo = { canonical: string; redirect: boolean };

// The three public page kinds have one address each, `/<kind>/<id>-<slug>`, and the backend says
// which: its SEO read takes the address that was asked for and answers with the canonical one
// and whether to go there. The same read proves the record exists and the visitor may open it,
// so a page load costs the one backend read it cost before. A merged thread is a redirect to the
// thread that took its place, whatever slug the address carries.
function seoPage(
  ask: (
    id: number,
    requestedPath: string,
    page: number,
    forward: Forward,
  ) => Promise<Seo>,
  paged = false,
): Finder {
  return async (raw, action, request) => {
    const id = parsePageId(raw);
    if (id === null) return false;
    // A sub-route (`/forums/3/new`) is served under whatever slug it carries: only the page
    // itself is held to the canonical address.
    const page = paged && action === undefined ? pageOf(request) : 1;
    const requestedPath =
      action === undefined
        ? toBackendPath(request.nextUrl.pathname) +
          (page > 1 ? `?page=${page}` : "")
        : "";
    try {
      const seo = await ask(
        id,
        requestedPath,
        page,
        forwardFromHeaders(request.headers),
      );
      if (!seo.redirect) return true;
      const target = new URL(canonicalPathOf(seo.canonical), request.url);
      if (action === undefined) target.search = request.nextUrl.search;
      return NextResponse.redirect(target, 308);
    } catch (error) {
      return !(error instanceof SermoError && error.code === "not_found");
    }
  };
}

const CONTENT: Record<string, Finder> = {
  members: seoPage((userId, requestedPath, _page, forward) =>
    callWith(forward, seoProfile, { userId, requestedPath }),
  ),
  forums: seoPage((nodeId, requestedPath, _page, forward) =>
    callWith(forward, seoNode, { nodeId, requestedPath }),
  ),
  threads: seoPage(
    (threadId, requestedPath, page, forward) =>
      callWith(forward, seoThread, { threadId, requestedPath, page }),
    true,
  ),
  awards: backend((awardId, forward) =>
    callWith(forward, awardsGet, { awardId }),
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

// The pages that carry a slug after the id.
const PUBLIC_PAGES = ["threads", "forums", "members"];

const MEMBERS_ONLY = ["account", "notifications", "conversations"];

// Whether the browser is loading a page, as opposed to Next fetching one for a <Link> (a prefetch
// or a soft navigation) or posting an action. Those requests are answered by the page itself,
// which asks the backend anyway, so a record lookup here would only repeat it. Next removes its
// own request headers (rsc, next-router-prefetch) before the proxy runs; what stays is the
// next-action header and the fetch metadata the browser adds: a page load has mode "navigate",
// the fetch behind a <Link> does not. A document navigation stays one whatever sec-purpose says (a
// prerendered response becomes the page that is shown); sec-purpose only tells a speculative
// prefetch apart when the browser sent no mode.
function isDocumentRequest(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { headers } = request;
  if (headers.has("next-action")) return false;
  const mode = headers.get("sec-fetch-mode");
  if (mode !== null) return mode === "navigate";
  return !headers.get("sec-purpose")?.includes("prefetch");
}

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

// Forums used to live under another name; those addresses go to the same place under the
// current one.
function legacyForumRedirect(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const { pathname } = request.nextUrl;
  const prefix = `/${LEGACY_FORUM_PREFIX}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`))
    return undefined;
  const target = request.nextUrl.clone();
  target.pathname = `/${FORUM_PREFIX}${pathname.slice(prefix.length)}`;
  return NextResponse.redirect(target, 308);
}

async function handleRequest(request: NextRequest) {
  // The API is served by the rewrite in next.config.ts; nothing here applies to it.
  if (request.nextUrl.pathname.startsWith("/api/")) return;
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
  // The panel is told by the same normalised path as a picture is: decoded, lower-cased, dots
  // and spaces at the end of a name dropped. A spelling that reaches the panel on a file system
  // that ignores those differences is still the panel here.
  const staffRequest = isStaffPath(
    normalizeImagePath(request.nextUrl.pathname),
  );
  // A picture's address is let through as it is, except in the panel: there a file name is no
  // picture, and the gate below decides.
  if (isImageRequest(request.nextUrl.pathname) && !staffRequest) {
    const response = NextResponse.next();
    response.headers.set("Vary", "Cookie");
    return response;
  }
  if (request.nextUrl.pathname.startsWith("/_next/")) return;
  const legacy = legacyForumRedirect(request);
  if (legacy) return legacy;
  if (isUnknownUnsafePath(request.nextUrl.pathname)) return notFound(request);
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    // An address that cannot be decoded names no page of the panel either.
    if (staffRequest) return notFound(request);
    return toPage(request);
  }
  const [, section, id, action] = pathname.split("/");
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  // The panel does not advertise itself: whoever may not open an address of it, a guest included,
  // gets the 404 of an address that does not exist. One `auth.me` read decides, and only for a
  // visitor with a session.
  if (staffRequest || isStaffPath(pathname)) {
    const viewer = hasSession ? await viewerOf(request.headers) : null;
    if (!viewer || !mayOpenPath(viewer, pathname)) return notFound(request);
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
  // An id that is not a plain decimal number (for a public page, one followed by `-slug`) is no
  // record, whatever kind of request asks for it.
  if (
    id &&
    CONTENT[section] &&
    !(section === "conversations" && id === "new") &&
    !(PUBLIC_PAGES.includes(section) ? parsePageId(id) !== null : isId(id))
  ) {
    return notFound(request);
  }
  const isPage = isDocumentRequest(request);
  const slug = isPage ? staticSlug(section, id, action) : undefined;
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
    isPage && id && !(section === "conversations" && id === "new")
      ? CONTENT[section]
      : undefined;
  if (find) {
    const found = await find(id, action, request);
    if (found instanceof NextResponse) return found;
    if (!found) return notFound(request);
  }
  return toPage(request);
}

// Match before decoding, including image optimizer requests and file aliases.
// Non-image Next internals return before the existing page access rules. The three upload routes
// are left out: the proxy would copy their body, and each checks the session before reading any.
export const config = {
  matcher: ["/((?!account/picture$|threads/[0-9]+/uploads$|admin/uploads$).*)"],
};
