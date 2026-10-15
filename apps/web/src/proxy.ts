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
import {
  isStaffPath,
  isStyleguidePath,
  mayOpenPath,
  mayOpenStyleguide,
} from "@/app/[locale]/(staff)/registry";
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import {
  fromAcceptLanguage,
  isLocale,
  LOCALES,
  type Locale,
  negotiateLocale,
} from "@/i18n/locales";
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
import { siteDefaultLanguage } from "@/lib/sermo/default-language";
import { SermoError } from "@/lib/sermo/errors";
import { parseId, parsePageId } from "@/lib/sermo/ids";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
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
      callWith(forward, seoThread, {
        threadId,
        requestedPath,
        page,
        pageSize: POSTS_PER_PAGE,
      }),
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

// The language of this visitor: their cookie, else their browser's, else English. Every page
// request is answered in it, and the answer depends on both.
// The site's default is asked for only when neither names a supported language.
async function localeOf(request: NextRequest): Promise<Locale> {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const accepted = request.headers.get("accept-language");
  const own = isLocale(cookie) || fromAcceptLanguage(accepted) !== undefined;
  return negotiateLocale(
    cookie,
    accepted,
    own ? undefined : await siteDefaultLanguage(),
  );
}

// The page of a language is served from `app/[locale]`; the visitor's address never carries the
// segment, so the request is rewritten to it inside the server.
function inLocale(request: NextRequest, locale: Locale, pathname?: string) {
  const target = request.nextUrl.clone();
  const path = pathname ?? request.nextUrl.pathname;
  target.pathname = path === "/" ? `/${locale}` : `/${locale}${path}`;
  return target;
}

// Lets the request go on to a page, in the visitor's language. Only a read of the page (GET,
// HEAD) carries the path; an action's POST does not. Whatever the client sent under that name
// never survives.
function toPage(request: NextRequest, locale: Locale) {
  const headers = new Headers(request.headers);
  if (request.method === "GET" || request.method === "HEAD") {
    headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  } else {
    headers.delete(PATH_HEADER);
  }
  const response = NextResponse.rewrite(inLocale(request, locale), {
    request: { headers },
  });
  return response;
}

// An address that names the hidden segment (`/es/threads/1`) is no address of the site: it goes
// to the one without it, so a page has a single address whatever its language.
function localePrefixRedirect(request: NextRequest) {
  const { pathname } = request.nextUrl;
  for (const locale of LOCALES) {
    if (pathname !== `/${locale}` && !pathname.startsWith(`/${locale}/`))
      continue;
    const target = request.nextUrl.clone();
    target.pathname = pathname.slice(locale.length + 1) || "/";
    return NextResponse.redirect(target, 307);
  }
  return undefined;
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

// What the placeholder of a blocked picture address says, in the visitor's language.
const PLACEHOLDER_LABEL: Record<Locale, string> = {
  en: "DATA SAVER",
  es: "AHORRO DE DATOS",
};

function notFound(request: NextRequest, locale: Locale) {
  const response = NextResponse.rewrite(
    new URL(`/${locale}/not-found`, request.url),
    { status: 404 },
  );
  return response;
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

// The Data saver's page used to be called LITE mode, and its addresses said so. The query is
// kept, and an address that names a language (`/es/lite`) goes straight to the new one without
// it, as the prefix redirect would have done.
const DATA_SAVER_ADDRESSES: Record<string, string> = {
  "/lite": "/data-saver",
  "/account/lite": "/account/data-saver",
};

function dataSaverRedirect(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const { pathname } = request.nextUrl;
  const locale = LOCALES.find((code) => pathname.startsWith(`/${code}/`));
  const current =
    DATA_SAVER_ADDRESSES[locale ? pathname.slice(locale.length + 1) : pathname];
  if (!current) return undefined;
  const target = request.nextUrl.clone();
  target.pathname = current;
  return NextResponse.redirect(target, 308);
}

// The viewer for a gate: null for a guest, undefined when the backend could not be asked.
async function visitorOf(request: NextRequest, hasSession: boolean) {
  if (!hasSession) return null;
  try {
    return await viewerOf(request.headers);
  } catch (error) {
    if (error instanceof SermoError) return undefined;
    throw error;
  }
}

async function handleRequest(request: NextRequest) {
  // The API is served by the rewrite in next.config.ts; nothing here applies to it.
  if (request.nextUrl.pathname.startsWith("/api/")) return;
  const renamed = dataSaverRedirect(request);
  if (renamed) return renamed;
  const prefixed = localePrefixRedirect(request);
  if (prefixed) return prefixed;
  const locale = await localeOf(request);
  const lite = parseLiteCookieHeader(request.headers.get("cookie") ?? "");
  if (blocksImageRequest(lite, request.nextUrl.pathname)) {
    return new NextResponse(
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><text x="80" y="45" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="var(--muted-foreground, currentColor)">${PLACEHOLDER_LABEL[locale]}</text></svg>`,
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
    // The site's icon is a route of its own, outside the language segment, and Next's own
    // picture addresses (`/_next/image`, `/_next/static/media`) are not pages: both go on as
    // they are. Any other address that looks like a picture is no page and gets the 404 of the
    // visitor's language.
    const { pathname } = request.nextUrl;
    if (pathname === "/favicon.ico" || pathname.startsWith("/_next/")) {
      const response = NextResponse.next();
      response.headers.set("Vary", "Cookie");
      return response;
    }
    const response = NextResponse.rewrite(inLocale(request, locale));
    return response;
  }
  if (request.nextUrl.pathname.startsWith("/_next/")) return;
  const legacy = legacyForumRedirect(request);
  if (legacy) return legacy;
  if (isUnknownUnsafePath(request.nextUrl.pathname))
    return notFound(request, locale);
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    // An address that cannot be decoded names no page of the panel or the styleguide either.
    if (staffRequest || isStyleguidePath(request.nextUrl.pathname))
      return notFound(request, locale);
    return toPage(request, locale);
  }
  const [, section, id, action] = pathname.split("/");
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  // The panel does not advertise itself: whoever may not open an address of it, a guest included,
  // gets the 404 of an address that does not exist. One `auth.me` read decides, and only for a
  // visitor with a session. When that read fails the backend has not said they may not, so the
  // panel's page is let through: each of its reads is the backend's own to refuse.
  if (staffRequest || isStaffPath(pathname)) {
    const viewer = await visitorOf(request, hasSession);
    if (viewer !== undefined && (!viewer || !mayOpenPath(viewer, pathname)))
      return notFound(request, locale);
  }
  // The styleguide is for the panel's people: the same one read decides, and without it the
  // answer is no.
  if (isStyleguidePath(pathname)) {
    const viewer = await visitorOf(request, hasSession);
    if (!viewer || !mayOpenStyleguide(viewer)) return notFound(request, locale);
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
    return notFound(request, locale);
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
      return notFound(request, locale);
    }
  }
  const find =
    isPage && id && !(section === "conversations" && id === "new")
      ? CONTENT[section]
      : undefined;
  if (find) {
    const found = await find(id, action, request);
    if (found instanceof NextResponse) return found;
    if (!found) return notFound(request, locale);
  }
  return toPage(request, locale);
}

// Match before decoding, including image optimizer requests and file aliases.
// Non-image Next internals return before the existing page access rules. The four upload routes
// are left out: the proxy would copy their body, and each checks the session before reading any.
export const config = {
  matcher: [
    "/((?!account/picture$|threads/[0-9]+/uploads$|attachments$|admin/uploads$).*)",
  ],
};
