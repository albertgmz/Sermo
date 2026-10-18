import {
  awardsGet,
  conversationsGet,
  PageSlug,
  pagesGet,
  postsGet,
  seoNode,
  seoProfile,
  seoThread,
  tagsGet,
} from "@sermo/core/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
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
import { CONSENT_COOKIE, REFERRAL_COOKIE } from "@/lib/consent/inventory";
import { consentOf, mayStoreReferral } from "@/lib/consent/state";
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
import { isPageRoute } from "@/lib/page-routes";
import { isPwaPath } from "@/lib/pwa";
import { REFERRAL_MAX_AGE, referralStep } from "@/lib/referral/cookie";
import { REFERRAL_PARAM } from "@/lib/referral/link";
import {
  contentSecurityPolicy,
  NONCE_HEADER,
  newNonce,
  type PageSecurity,
  securityHeaders,
} from "@/lib/security-headers";
import {
  canonicalPathOf,
  FORUM_PREFIX,
  LEGACY_FORUM_PREFIX,
  toBackendPath,
} from "@/lib/sermo/addresses";
import { bannerAppliesOrUnknown } from "@/lib/sermo/banner";
import { publicUrl } from "@/lib/sermo/config";
import {
  siteAnalytics,
  siteConsentFacts,
  siteDefaultLanguage,
} from "@/lib/sermo/default-language";
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
// an outage included, lets the request through so the page can show its own error (under the
// status `lookupFailure` gives a throttled visitor or a failing backend).
async function exists(
  request: NextRequest,
  ask: (forward: Forward) => Promise<unknown>,
) {
  try {
    await ask(forwardFromHeaders(request.headers));
    return true;
  } catch (error) {
    return lookupFailure(error, (refusal) => refusal.code === "not_found");
  }
}

// The backend could not say whether the record exists: the page goes on, under this status.
type Unavailable = { unavailable: 429 | 503 };

const isUnavailable = (found: unknown): found is Unavailable =>
  typeof found === "object" && found !== null && "unavailable" in found;

// What a failed lookup means: false for a missing record, the status for a backend that throttles
// the visitor (429) or fails (5xx; one that cannot be reached is a 500 too), true for anything else
// (the page shows its own refusal).
function lookupFailure(
  error: unknown,
  missing: (refusal: SermoError) => boolean,
): boolean | Unavailable {
  if (!(error instanceof SermoError)) return true;
  if (missing(error)) return false;
  if (error.status === 429) return { unavailable: 429 };
  if (error.status >= 500) return { unavailable: 503 };
  return true;
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
      return lookupFailure(error, (refusal) => refusal.code === "not_found");
    }
  };
}

// A post's address goes to the page of its thread that holds it, at its anchor. The backend's
// read of the post is the visibility check: a post the visitor may not see ("not found", or
// "forbidden" for a forum whose posts are closed to them) is a 404, the same as an id that was
// never used. A visitor who must sign in first goes on to the page, as for any record.
const postPage: Finder = async (raw, action, request) => {
  const postId = parseId(raw);
  if (postId === null) return false;
  // Nothing is served under a post's address; the router answers those with its own 404.
  if (action !== undefined) return true;
  try {
    const post = await callWith(forwardFromHeaders(request.headers), postsGet, {
      postId,
    });
    // Temporary and private: a split or a move changes the post's thread, and the answer depends
    // on who asks.
    const response = NextResponse.redirect(
      new URL(threadHref(post.threadId, post.position, post.id), request.url),
      307,
    );
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return lookupFailure(
      error,
      (refusal) => refusal.code === "not_found" || refusal.code === "forbidden",
    );
  }
};

const CONTENT: Record<string, Finder> = {
  posts: postPage,
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

// A tag is addressed by its name, not by an id. The backend's read says whether the tag exists for
// this visitor (one with no thread they may open does not) and whether the name asked for is an
// old name, in which case the address goes to the current one.
async function tagPage(name: string, request: NextRequest) {
  try {
    const tag = await callWith(forwardFromHeaders(request.headers), tagsGet, {
      name,
      requestedPath: request.nextUrl.pathname,
    });
    if (!tag.redirect) return true;
    const target = new URL(canonicalPathOf(tag.seo.canonical), request.url);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 308);
  } catch (error) {
    return lookupFailure(error, (refusal) => refusal.code === "not_found");
  }
}

const STATIC_PAGES = ["terms", "rules", "privacy", "legal", "contact"];

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

// Whether the request reached the app over https: the scheme the proxy in front of it reports, else
// its own.
function isHttps(request: NextRequest) {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwarded
    ? forwarded === "https"
    : request.nextUrl.protocol === "https:";
}

// What the answer to a request is secured with: a nonce of its own and what the policy names.
async function pageSecurity(request: NextRequest): Promise<PageSecurity> {
  return {
    nonce: newNonce(),
    https: isHttps(request),
    publicUrl: publicUrl(),
    analytics: await siteAnalytics(),
    development: process.env.NODE_ENV === "development",
  };
}

// The request headers a page is rendered with: Next takes the nonce of its own scripts from the
// policy, and the layouts take it from NONCE_HEADER for theirs. Whatever the client sent under
// those names, or under the path's, never survives.
function pageHeaders(request: NextRequest, security: PageSecurity) {
  const headers = new Headers(request.headers);
  headers.delete(PATH_HEADER);
  headers.set("content-security-policy", contentSecurityPolicy(security));
  headers.set(NONCE_HEADER, security.nonce);
  return headers;
}

// Lets the request go on to a page, in the visitor's language. Only a read of the page (GET,
// HEAD) carries the path; an action's POST does not.
function toPage(request: NextRequest, locale: Locale, security: PageSecurity) {
  const response = NextResponse.rewrite(inLocale(request, locale), {
    request: { headers: pageRequestHeaders(request, security) },
  });
  return response;
}

function pageRequestHeaders(request: NextRequest, security: PageSecurity) {
  const headers = pageHeaders(request, security);
  if (request.method === "GET" || request.method === "HEAD")
    headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return headers;
}

// A page whose record the backend could not look up: it throttles the visitor (429) or fails
// (5xx; a backend that cannot be reached is a 500 too). The page is still drawn, with its own
// error where its reads fail, but a page load is answered with the status that says so: 429 for
// the visitor's throttling, 503 for the rest, so a crawler comes back instead of taking an error
// screen for the page.
async function unavailable(
  request: NextRequest,
  locale: Locale,
  security: PageSecurity,
  status: 429 | 503,
) {
  const target = inLocale(request, locale);
  return (
    (await ownAnswer(
      request,
      target.pathname + target.search,
      pageRequestHeaders(request, security),
      status,
    )) ?? toPage(request, locale, security)
  );
}

// An address that names the hidden segment (`/es/threads/1`) is no address of the site: it goes
// to the one without it for good, so a page has a single address whatever its language. A 308
// keeps the method, as a 307 does.
function localePrefixRedirect(request: NextRequest) {
  const { pathname } = request.nextUrl;
  for (const locale of LOCALES) {
    if (pathname !== `/${locale}` && !pathname.startsWith(`/${locale}/`))
      continue;
    const target = request.nextUrl.clone();
    target.pathname = pathname.slice(locale.length + 1) || "/";
    return NextResponse.redirect(target, 308);
  }
  return undefined;
}

// Whether the visitor accepts referrals under the cookie policy version the site has now, which
// the proxy learns from the site facts it keeps for a minute (no request of its own per page); null
// while the site has not been read, or while the backend cannot say whether the banner applies. A
// visitor the banner is not shown to counts as accepting; the backend is asked about that only for
// a request that carries a referral or a referral cookie, and its answer is kept a minute per
// country (see `bannerAppliesOrUnknown`), so no request waits on it each time.
async function referralsAccepted(request: NextRequest) {
  const { cookiePolicyVersion, bannerOutsideEu } = await siteConsentFacts();
  if (cookiePolicyVersion === null) return null;
  let unknown = false;
  const consent = await consentOf(
    request.cookies.get(CONSENT_COOKIE)?.value,
    { version: cookiePolicyVersion, bannerOutsideEu },
    SESSION_COOKIES.some((name) => request.cookies.has(name)),
    async () => {
      const shown = await bannerAppliesOrUnknown(
        forwardFromHeaders(request.headers),
      );
      unknown = shown === null;
      return shown ?? true;
    },
  );
  return unknown ? null : mayStoreReferral(consent);
}

// What a request does to the referral cookie (see `referralStep`). The canonical address of a
// page reached through `?ref=` needs nothing here: the pages that have one take it from the
// backend (`seoMetadata`) or build it without the query (the home page, `homeAddress`), and
// none carries a query.
async function withReferral(
  request: NextRequest,
  response: NextResponse | undefined,
) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/"))
    return response;
  const referral = request.cookies.get(REFERRAL_COOKIE)?.value;
  // Nothing to set and nothing to remove: no need to know what the visitor accepts.
  if (
    referral === undefined &&
    !request.nextUrl.searchParams.has(REFERRAL_PARAM)
  )
    return response;
  const step = referralStep(
    request.nextUrl,
    { referral },
    isDocumentRequest(request),
    SESSION_COOKIES.some((name) => request.cookies.has(name)),
    await referralsAccepted(request),
  );
  if (step.set === null && !step.clear) return response;
  const answer = response ?? NextResponse.next();
  if (step.set !== null) {
    answer.cookies.set(REFERRAL_COOKIE, String(step.set), {
      httpOnly: true,
      sameSite: "lax",
      secure: publicUrl().startsWith("https:"),
      path: "/",
      maxAge: REFERRAL_MAX_AGE,
    });
  } else if (step.clear) {
    answer.cookies.delete(REFERRAL_COOKIE);
  }
  return answer;
}

export async function proxy(request: NextRequest) {
  const own = ownRender(request);
  if (own) return own;
  const response = await withReferral(request, await handleRequest(request));
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

// The 404 page of the visitor's language. Every page is built as a partial prerender whose stored
// answer says 200, and Next serves a page with that status whatever a rewrite asked for; only an
// answer the proxy writes itself keeps its status (see `ownAnswer`). Any other request (a router
// fetch, which keeps the rewrite's status, or an action's POST) is rewritten to the page; so is a
// page load when this server cannot be asked.
async function notFound(
  request: NextRequest,
  locale: Locale,
  security: PageSecurity,
) {
  const headers = pageHeaders(request, security);
  return (
    (await ownAnswer(request, `/${locale}/not-found`, headers, 404)) ??
    NextResponse.rewrite(new URL(`/${locale}/not-found`, request.url), {
      status: 404,
      request: { headers },
    })
  );
}

// A page load (the answer a visitor, a crawler or a checker reads) answered with a status of the
// proxy's own: the page is asked of this server as the visitor, with this response's nonce, and
// passed on under that status. Undefined for any other request, or when this server cannot be
// asked.
async function ownAnswer(
  request: NextRequest,
  path: string,
  headers: Headers,
  status: number,
) {
  if (!isDocumentRequest(request)) return undefined;
  const origin = process.env.__NEXT_PRIVATE_ORIGIN;
  if (!origin) {
    if (process.env.NODE_ENV === "production")
      warnUnreachable("the server's own address is not set");
    return undefined;
  }
  const page = await ownPage(new URL(path, origin), headers, request.signal);
  if (!page) return undefined;
  if (request.method === "HEAD") await discard(page);
  return new NextResponse(request.method === "HEAD" ? null : page.body, {
    status,
    headers: {
      "content-type":
        page.headers.get("content-type") ?? "text/html; charset=utf-8",
      // Drawn for this visitor: their session and their language.
      "cache-control": "private, no-store",
    },
  });
}

// The proxy's own request for a page carries this secret of the server process; nothing else can
// know it, so a client that sends the header is answered as any other request.
const OWN_REQUEST_HEADER = "x-sermo-own-request";
const OWN_REQUEST_SECRET = crypto.randomUUID();

// How long the proxy waits for its own request's answer to begin. The page's first bytes come as
// soon as the root layout has the site (kept in a shared cache), the messages and the nonce:
// milliseconds when the server is well. Five seconds means the server is stuck, and the visitor
// is better served by the fallback than by a longer wait. Once the page streams, only the
// visitor's leaving stops it.
const OWN_REQUEST_TIMEOUT_MS = 5_000;

// Headers that describe one connection, not the request: the server's own fetch sets its own (it
// also asks for its own encoding and decodes the answer).
const HOP_HEADERS = [
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
];

async function ownPage(url: URL, forwarded: Headers, visitor: AbortSignal) {
  const headers = new Headers(forwarded);
  for (const name of HOP_HEADERS) headers.delete(name);
  headers.set(OWN_REQUEST_HEADER, OWN_REQUEST_SECRET);
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error("no answer in time")),
    OWN_REQUEST_TIMEOUT_MS,
  );
  try {
    const page = await fetch(url, {
      headers,
      redirect: "manual",
      cache: "no-store",
      // A visitor who leaves stops the page drawn for them.
      signal: AbortSignal.any([visitor, timeout.signal]),
    });
    // Next answers the page with the 200 it stored, or with a 404 where it has nothing stored.
    if (page.ok || page.status === 404) return page;
    await discard(page);
    return undefined;
  } catch (error) {
    if (!visitor.aborted)
      warnUnreachable(
        `${url.origin} did not answer: ${timeout.signal.aborted ? "no answer in time" : error instanceof Error ? error.name : "error"}`,
      );
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// An answer that is not passed on still holds its connection until its body is read or cancelled.
async function discard(page: Response) {
  await page.body?.cancel().catch(() => {});
}

// Said once per server process: from then on a missing page is answered with the 200 Next stored.
let warnedUnreachable = false;
function warnUnreachable(reason: string) {
  if (warnedUnreachable) return;
  warnedUnreachable = true;
  console.warn(
    `The proxy could not ask this server for its own pages (${reason}); missing and unavailable pages are answered with a 200 while it cannot.`,
  );
}

// The proxy's own request for a page goes straight to it, with the nonce and the policy it was
// sent with (those of the answer that will carry the page).
function ownRender(request: NextRequest) {
  if (request.headers.get(OWN_REQUEST_HEADER) !== OWN_REQUEST_SECRET)
    return undefined;
  const headers = new Headers(request.headers);
  headers.delete(OWN_REQUEST_HEADER);
  return NextResponse.next({ request: { headers } });
}

// Whether a page answers the address as it was asked for; one that cannot be decoded names none.
function isKnownPage(pathname: string) {
  try {
    return isPageRoute(decodeURIComponent(pathname));
  } catch {
    return false;
  }
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
  // The manifest, the service worker and the offline page are files of the installed app, not
  // pages of a language: they are served as they are.
  if (isPwaPath(request.nextUrl.pathname)) return;
  // Every answer from here on carries the security headers; a page is also rendered with its nonce.
  const security = await pageSecurity(request);
  const response = await pageResponse(request, security);
  for (const [name, value] of securityHeaders(security))
    response?.headers.set(name, value);
  return response;
}

async function pageResponse(request: NextRequest, security: PageSecurity) {
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
    // they are. Any other address that looks like a picture gets the 404 of the visitor's
    // language, unless a page answers it (a tag may be named `logo.png`).
    const { pathname } = request.nextUrl;
    if (pathname === "/favicon.ico" || pathname.startsWith("/_next/")) {
      const response = NextResponse.next();
      response.headers.set("Vary", "Cookie");
      return response;
    }
    if (!isKnownPage(pathname)) return notFound(request, locale, security);
    const response = NextResponse.rewrite(inLocale(request, locale), {
      request: { headers: pageHeaders(request, security) },
    });
    return response;
  }
  if (request.nextUrl.pathname.startsWith("/_next/")) return;
  const legacy = legacyForumRedirect(request);
  if (legacy) return legacy;
  if (isUnknownUnsafePath(request.nextUrl.pathname))
    return notFound(request, locale, security);
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    // An address that cannot be decoded names no page.
    return notFound(request, locale, security);
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
      return notFound(request, locale, security);
  }
  // The styleguide is for the panel's people: the same one read decides, and without it the
  // answer is no.
  if (isStyleguidePath(pathname)) {
    const viewer = await visitorOf(request, hasSession);
    if (!viewer || !mayOpenStyleguide(viewer))
      return notFound(request, locale, security);
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
  // Any other address no page answers is a 404 here, with its status: the router would hand it to
  // its fallback page (`[...rest]`), which is served as a 200 whatever it says. The panel's
  // addresses are its gate's, above.
  if (!staffRequest && !isStaffPath(pathname) && !isPageRoute(pathname))
    return notFound(request, locale, security);
  // An id that is not a plain decimal number (for a public page, one followed by `-slug`) is no
  // record, whatever kind of request asks for it.
  if (
    id &&
    CONTENT[section] &&
    !(section === "conversations" && id === "new") &&
    !(PUBLIC_PAGES.includes(section) ? parsePageId(id) !== null : isId(id))
  ) {
    return notFound(request, locale, security);
  }
  const isPage = isDocumentRequest(request);
  if (isPage && section === "tags" && id && action === undefined) {
    const found = await tagPage(id, request);
    if (found instanceof NextResponse) return found;
    if (isUnavailable(found))
      return unavailable(request, locale, security, found.unavailable);
    if (!found) return notFound(request, locale, security);
  }
  const slug = isPage ? staticSlug(section, id, action) : undefined;
  if (slug !== undefined) {
    const parsed = PageSlug.safeParse(slug);
    const found =
      parsed.success &&
      (await exists(request, (forward) =>
        callWith(forward, pagesGet, { slug: parsed.data }),
      ));
    if (isUnavailable(found))
      return unavailable(request, locale, security, found.unavailable);
    if (!found) return notFound(request, locale, security);
  }
  const find =
    isPage && id && !(section === "conversations" && id === "new")
      ? CONTENT[section]
      : undefined;
  if (find) {
    const found = await find(id, action, request);
    if (found instanceof NextResponse) return found;
    if (isUnavailable(found))
      return unavailable(request, locale, security, found.unavailable);
    if (!found) return notFound(request, locale, security);
  }
  return toPage(request, locale, security);
}

// Match before decoding, including image optimizer requests and file aliases.
// Non-image Next internals return before the existing page access rules. The four upload routes
// are left out: the proxy would copy their body, and each checks the session before reading any.
// So are the backend's own paths (`BACKEND_PATHS` in next.config.ts; `[^/]+\.txt` covers
// robots.txt, llms.txt and the IndexNow key file): they are rewritten to it as they are, and a
// page of a language must not take their place. So are the OpenSearch description and the share
// cards (`/og/...`), files of the web app outside the language segment (app/opensearch.xml, app/og).
export const config = {
  matcher: [
    "/((?!account/picture$|threads/[0-9]+/uploads$|attachments$|admin/uploads$|[^/]+\\.txt$|sitemap\\.xml$|sitemaps/[^/]+$|feed\\.atom$|(?:forums|nodes)/[^/]+/feed\\.atom$|mcp$|health$|opensearch\\.xml$|og/).*)",
  ],
};
