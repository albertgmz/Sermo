import {
  type Actor,
  apiCatalog,
  atomFeed,
  CLIENT_IP_HEADER,
  type Ctx,
  createStorage,
  execute,
  forumMarkdown,
  GUEST,
  getAuth,
  languageFor,
  llmsFullTxt,
  llmsTxt,
  type MarkdownPage,
  proxyLocation,
  readSiteSettings,
  refuseBeforeValidating,
  requestLanguage,
  resolveActor,
  robotsTxt,
  SermoError,
  type StorageConfig,
  securityTxt,
  setLocationHeaders,
  sitemapIndex,
  sitemapShard,
  threadMarkdown,
  translateRefusal,
  UnauthenticatedError,
  ValidationError,
} from "@sermo/core";
import { createMcpHandler } from "@sermo/mcp";
import { type Context, Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { MemoryStore, rateLimiter } from "hono-rate-limiter";
import * as z from "zod";
import type { JSONSchema } from "zod/v4/core";
import { buildOpenApiDocument } from "./openapi";
import { routeOperations } from "./routes";
import { uploadMultipart } from "./upload";

export const RATE_LIMITS = { read: 300, write: 60, search: 30, mcp: 60 } as const;
export interface AppOptions {
  trustedProxyHeader: string | null;
  /**
   * Take the visitor's place from the proxy's location headers (Cloudflare's "Add visitor location
   * headers"). Only with `trustedProxyHeader`, and only when nothing but that proxy can reach
   * the server: the headers are as forgeable as the address header otherwise. Off by default.
   */
  trustProxyLocation?: boolean;
  storage?: StorageConfig;
  /** Override the fixed window in tests. */
  rateLimitWindowMs?: number;
  /** Override the quotas in tests. */
  rateLimits?: Partial<Record<keyof typeof RATE_LIMITS, number>>;
}

type Variables = { actor: Actor; clientIp: string; setCookies: string[] };
type ApiContext = Context<{ Variables: Variables }>;
type Schema = Record<string, unknown>;
type Resolution = { actor: Actor; setCookies: string[]; rateKey: string };
const MCP_RESOLUTION = Symbol("mcpResolution");
const statuses = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
} as const;

function errorBody(
  code: string,
  message: string,
  issues?: { path: (string | number)[]; message: string }[],
) {
  return { error: { code, message, ...(issues ? { issues } : {}) } };
}

function hasSessionCookie(c: ApiContext): boolean {
  return /(?:^|;\s*)(?:__Secure-)?sermo\.session_token=/.test(c.req.header("cookie") ?? "");
}

export function coerceQueryValues(values: string[], schema: Schema | undefined): unknown {
  if (schema?.type === "array")
    return values.map((value) => coerce(value, schema.items as Schema | undefined));
  return coerce(values.at(-1) ?? "", schema);
}

function coerce(value: string, schema: Schema | undefined): unknown {
  if (!schema) return value;
  // Nullable fields are `anyOf: [T, { type: "null" }]`: "null" is null, anything else is a T.
  const variants = schema.anyOf as Schema[] | undefined;
  if (variants) {
    if (value === "null" && variants.some((variant) => variant.type === "null")) return null;
    const inner = variants.find((variant) => variant.type !== "null");
    return inner ? coerce(value, inner) : value;
  }
  if (schema.type === "integer") {
    if (!/^-?\d+$/.test(value)) return value;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }
  if (schema.type === "number") {
    const number = Number(value);
    return value.trim() !== "" && Number.isFinite(number) ? number : value;
  }
  if (schema.type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

function schemaProperties(schema: JSONSchema.JSONSchema): Record<string, Schema> {
  return (schema.properties ?? {}) as Record<string, Schema>;
}

/** Matches the paths of a Hono route (`:param` segments match any one segment). */
function routePattern(path: string): RegExp {
  const source = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : segment.replaceAll(".", "\\.")))
    .join("/");
  return new RegExp(`^${source}$`);
}

const fileRoute = /^\/api\/v1\/files\/[^/]+$/;

export function createApp(ctx: Ctx, options: AppOptions): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  let openApiDocument: Promise<object> | undefined;
  const limits = { ...RATE_LIMITS, ...options.rateLimits };
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  let loggedUnknownIp = false;

  // The site's logo and icon are shown in its emails, whose mail apps load pictures from another
  // origin: those files alone may be embedded anywhere. A picture a mail shows besides these
  // (`siteBranding`, modules/email/branding.ts) needs its purpose in the list below. Registered
  // before the secure headers so that it runs after them and replaces their `same-origin`.
  const sitePicture = ctx.sqlite.prepare<{ found: number }, [number]>(
    "SELECT 1 AS found FROM files f LEFT JOIN files p ON p.id = f.parent_file_id WHERE f.id = ?1 AND COALESCE(p.purpose, f.purpose) IN ('site_logo', 'site_icon') AND COALESCE(p.visibility, f.visibility) = 'public'",
  );
  app.use("/api/v1/files/:fileId", async (c, next) => {
    await next();
    const status = c.res.status;
    if (
      (status === 200 || status === 206 || status === 304) &&
      sitePicture.get(Number(c.req.param("fileId")))
    )
      c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  });
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );
  // A shared cache in front of the site (a CDN with a "cache everything" rule) keeps any answer
  // that does not forbid it, and would hand a member's answer to the next visitor: every API
  // answer, errors included, is private and not stored unless its route set its own value.
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) c.header("cache-control", "private, no-store");
  });
  // A refusal is written in English by the service; a client that reads Spanish (its language
  // cookie, else the site's language) gets the Spanish text of it.
  app.use("/api/*", async (c, next) => {
    await next();
    if (
      c.res.status < 400 ||
      c.res.status === 500 ||
      !c.res.headers.get("content-type")?.includes("application/json")
    )
      return;
    const language = languageFor(
      requestLanguage(c.req.raw.headers),
      readSiteSettings(ctx).defaultLanguage,
    );
    if (language === "en") return;
    const body = (await c.res
      .clone()
      .json()
      .catch(() => null)) as {
      error?: { message?: string; issues?: { message?: string }[] };
    } | null;
    const error = body?.error;
    if (typeof error?.message !== "string") return;
    error.message = translateRefusal(language, error.message);
    for (const issue of error.issues ?? [])
      if (typeof issue.message === "string")
        issue.message = translateRefusal(language, issue.message);
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(JSON.stringify(body), { status: c.res.status, headers });
  });
  app.use("*", async (c, next) => {
    let ip: string | undefined;
    // Whether the address came from the trusted proxy's header: a request without it did not pass
    // the proxy, so whatever location headers it carries are nobody's word.
    let viaProxy = false;
    if (options.trustedProxyHeader) {
      ip = c.req.header(options.trustedProxyHeader)?.split(",").at(-1)?.trim();
      viaProxy = Boolean(ip);
    } else {
      try {
        ip = getConnInfo(c).remote.address;
      } catch {
        /* app.request has no socket */
      }
    }
    if (!ip) {
      ip = "unknown";
      if (!loggedUnknownIp) {
        loggedUnknownIp = true;
        console.warn("Client IP is unavailable; using the unknown rate-limit bucket.");
      }
    }
    const headers = new Headers(c.req.raw.headers);
    headers.delete(CLIENT_IP_HEADER);
    headers.set(CLIENT_IP_HEADER, ip);
    // The place travels like the address: whatever the client sent under our names is dropped,
    // and they are set again only from the proxy's own headers on the trusted proxy path.
    setLocationHeaders(
      headers,
      viaProxy && options.trustProxyLocation ? proxyLocation(headers) : null,
    );
    c.req.raw = new Request(c.req.raw, { headers });
    c.set("clientIp", ip);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof SermoError)
      return c.json(errorBody(error.code, error.message, error.issues), statuses[error.code]);
    if (error instanceof HTTPException && error.status === 403)
      return c.json(errorBody("forbidden", "The request origin was rejected."), 403);
    if (error instanceof HTTPException && error.status === 415) return error.getResponse();
    console.error("API request failed", error);
    return c.json(errorBody("internal", "Internal server error."), 500);
  });

  app.all("/api/auth/*", (c) => getAuth(ctx).handler(c.req.raw));

  const key = (c: ApiContext) => {
    const actor = c.get("actor");
    return actor.kind === "guest"
      ? `ip:${c.get("clientIp")}`
      : actor.kind === "token"
        ? `key:${actor.tokenId}`
        : `user:${actor.userId}`;
  };
  const resolve = async (c: ApiContext, next: () => Promise<void>) => {
    let resolved: Awaited<ReturnType<typeof resolveActor>>;
    try {
      resolved = await resolveActor(ctx, c.req.raw.headers);
    } catch (error) {
      // A dead session cookie must not break a picture anyone may see: a file is served as to a
      // guest when only the cookie cannot be resolved (the file route decides what a guest may
      // read). A bad API key or bearer token, and a banned member, are still refused.
      const headers = c.req.raw.headers;
      if (
        !(error instanceof UnauthenticatedError) ||
        headers.has("authorization") ||
        headers.has("x-api-key") ||
        !(c.req.method === "GET" && fileRoute.test(c.req.path))
      )
        throw error;
      resolved = { actor: GUEST, setCookies: [] };
    }
    // A session cookie is a browser session: the group and permission writes ask it for the
    // administrator's password (see confirmActorPassword).
    const result =
      resolved.actor.kind === "user"
        ? { ...resolved, actor: { ...resolved.actor, interactive: true as const } }
        : resolved;
    c.set("actor", result.actor);
    c.set("setCookies", result.setCookies);
    if (c.req.path === "/mcp")
      Reflect.set(c.req.raw, MCP_RESOLUTION, { ...result, rateKey: key(c) });
    await next();
    for (const cookie of result.setCookies) c.res.headers.append("Set-Cookie", cookie);
  };
  app.use("/api/v1/*", resolve);
  app.use("/mcp", resolve);

  const bucket = (limit: number) => {
    const store = new MemoryStore<{ Variables: Variables }>();
    const middleware = rateLimiter({
      windowMs,
      limit,
      standardHeaders: "draft-6",
      keyGenerator: key,
      store,
      handler: (c) => c.json(errorBody("rate_limited", "Too many requests."), 429),
    });
    // Same counting as the middleware: every attempt counts, the ones over the limit fail.
    // The store hands out its live counter, so read it at once (calls in a batch run concurrently).
    const allow = (rateKey: string) => store.increment(rateKey).totalHits <= limit;
    return { middleware, allow };
  };
  const readLimiter = bucket(limits.read);
  const writeLimiter = bucket(limits.write);
  const searchLimiter = bucket(limits.search);
  const mcpLimiter = bucket(limits.mcp);
  app.use("/api/v1/*", (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD")
      return (c.req.path === "/api/v1/search" ? searchLimiter : readLimiter).middleware(c, next);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method))
      return writeLimiter.middleware(c, next);
    return next();
  });
  app.use("/mcp", mcpLimiter.middleware);

  const authConfig = ctx.config.auth;
  const allowedOrigins = authConfig
    ? [new URL(authConfig.baseURL).origin, ...authConfig.trustedOrigins]
    : [];
  const csrfMiddleware = csrf({ origin: allowedOrigins });
  app.use("/api/v1/*", (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) || !hasSessionCookie(c))
      return next();
    return csrfMiddleware(c, next);
  });
  app.use("/api/v1/*", async (c, next) => {
    const upload = c.req.method === "POST" && c.req.path === "/api/v1/files";
    if (upload && hasSessionCookie(c) && !allowedOrigins.includes(c.req.header("origin") ?? ""))
      return c.json(errorBody("forbidden", "The request origin is not allowed."), 403);
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) &&
      hasSessionCookie(c) &&
      !(
        /^application\/json(?:\s*;|$)/i.test(c.req.header("content-type") ?? "") ||
        (upload && /^multipart\/form-data\s*(?:;|$)/i.test(c.req.header("content-type") ?? ""))
      )
    )
      return c.json(
        errorBody("unsupported_media_type", "Content-Type must be application/json."),
        415,
      );
    await next();
  });

  const mcpResolution = (request: Request): Resolution => {
    const resolved = Reflect.get(request, MCP_RESOLUTION) as Resolution | undefined;
    if (!resolved) throw new Error("MCP actor was not resolved by the request middleware.");
    return resolved;
  };
  const mcp = createMcpHandler({
    ctx,
    // The middleware appends the cookies to every response, so the handler must not.
    resolveActor: async (request) => ({ ...mcpResolution(request), setCookies: [] }),
    // Each tool call is charged to the bucket REST uses for the same operation.
    allowCall: (request, op) =>
      (op.kind === "write"
        ? writeLimiter
        : op.name === "search.query"
          ? searchLimiter
          : readLimiter
      ).allow(mcpResolution(request).rateKey),
  });
  app.all("/mcp", (c) => mcp(c.req.raw));
  app.get("/health", (c) => {
    try {
      ctx.sqlite.query("SELECT 1").get();
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });
  const siteURL = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  app.get("/robots.txt", (c) =>
    c.text(robotsTxt(siteURL), 200, { "content-type": "text/plain; charset=utf-8" }),
  );
  app.get("/llms.txt", (c) =>
    c.text(llmsTxt(ctx, siteURL), 200, { "content-type": "text/plain; charset=utf-8" }),
  );
  // Guest content only, the same for every visitor: a shared cache may keep it for a minute.
  const GUEST_MAX_AGE_MS = 60_000;
  const GUEST_CACHE = `public, max-age=${GUEST_MAX_AGE_MS / 1000}`;
  // Each of these answers is built from many rows (a page of posts converted, or every public
  // forum): they count against the read quota of the visitor's address, as a guest, whom they
  // never resolve.
  const guestRead = (c: ApiContext, next: () => Promise<void>) => {
    c.set("actor", GUEST);
    c.set("setCookies", []);
    return readLimiter.middleware(c, next);
  };
  // One address every agent asks for, and the dearest: built at most once a minute.
  let llmsFull: { at: number; text: string } | undefined;
  app.get("/llms-full.txt", guestRead, (c) => {
    if (!llmsFull || ctx.now() - llmsFull.at >= GUEST_MAX_AGE_MS)
      llmsFull = { at: ctx.now(), text: llmsFullTxt(ctx, siteURL) };
    return c.text(llmsFull.text, 200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": GUEST_CACHE,
    });
  });
  // The Markdown version of a public thread or forum: its page's address with `.md` added.
  const markdown = (c: Context, page: MarkdownPage) =>
    "redirect" in page
      ? c.body(null, 301, { location: page.redirect, "cache-control": GUEST_CACHE })
      : c.body(page.markdown, 200, {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": GUEST_CACHE,
          link: `<${page.canonical}>; rel="canonical"`,
        });
  const markdownRef = (name: string) => {
    const id = Number(/^(\d+)(?:-[^/]*)?\.md$/.exec(name)?.[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  app.get("/threads/:name", guestRead, (c) => {
    const name = c.req.param("name") ?? "";
    const id = markdownRef(name);
    if (id === null) return c.json(errorBody("not_found", "Unknown page."), 404);
    const raw = c.req.query("page");
    const page = raw === undefined ? 1 : /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : 0;
    return markdown(c, threadMarkdown(ctx, siteURL, id, `/threads/${name.slice(0, -3)}`, page));
  });
  app.get("/forums/:name", guestRead, (c) => {
    const name = c.req.param("name") ?? "";
    const id = markdownRef(name);
    if (id === null) return c.json(errorBody("not_found", "Unknown page."), 404);
    return markdown(c, forumMarkdown(ctx, siteURL, id, `/forums/${name.slice(0, -3)}`));
  });
  // The other /.well-known files are the web app's (the GPC resource, the change-password
  // redirect); it answers every other /.well-known path with a plain 404.
  app.get("/.well-known/security.txt", (c) => {
    const body = securityTxt(ctx, siteURL);
    if (body === null) return c.text("Not found.\n", 404);
    return c.text(body, 200, { "content-type": "text/plain; charset=utf-8" });
  });
  app.get("/.well-known/api-catalog", (c) =>
    c.body(JSON.stringify(apiCatalog(siteURL)), 200, {
      "content-type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      // RFC 9727 section 2: a HEAD of the catalog answers this link, so GET sends it too.
      link: '</.well-known/api-catalog>; rel="api-catalog"',
    }),
  );
  app.get("/sitemap.xml", (c) =>
    c.text(sitemapIndex(ctx, siteURL), 200, { "content-type": "application/xml; charset=utf-8" }),
  );
  app.get("/sitemaps/:name", (c) => {
    const parsed = /^(node|thread|profile|tag)-(\d+)\.xml$/.exec(c.req.param("name"));
    if (!parsed) return c.json(errorBody("not_found", "Unknown sitemap."), 404);
    const kind = parsed[1] as "node" | "thread" | "profile" | "tag";
    const shard = Number(parsed[2]);
    if (!Number.isSafeInteger(shard) || shard < 1)
      return c.json(errorBody("validation", "Invalid sitemap shard."), 400);
    return c.text(sitemapShard(ctx, siteURL, kind, shard), 200, {
      "content-type": "application/xml; charset=utf-8",
    });
  });
  app.get("/feed.atom", (c) =>
    c.text(atomFeed(ctx, siteURL, readSiteSettings(ctx).siteName), 200, {
      "content-type": "application/atom+xml; charset=utf-8",
    }),
  );
  // The address this feed had before forums moved to /forums: kept answering with a redirect.
  app.get("/nodes/:nodeId/feed.atom", (c) =>
    c.redirect(`/forums/${encodeURIComponent(c.req.param("nodeId"))}/feed.atom`, 301),
  );
  app.get("/forums/:nodeId/feed.atom", (c) => {
    const match = /^(\d+)(?:-[^/]+)?$/.exec(c.req.param("nodeId"));
    const id = Number(match?.[1]);
    if (!Number.isSafeInteger(id) || id < 1)
      return c.json(errorBody("validation", "Invalid node ID."), 400);
    return c.text(atomFeed(ctx, siteURL, readSiteSettings(ctx).siteName, id), 200, {
      "content-type": "application/atom+xml; charset=utf-8",
    });
  });
  app.get("/:name", (c) => {
    const matched = /^(.+)\.txt$/.exec(c.req.param("name"));
    const key = readSiteSettings(ctx).indexNowKey;
    if (!key || matched?.[1] !== key)
      return c.json(errorBody("not_found", "Key unavailable."), 404);
    return c.text(key, 200, { "content-type": "text/plain; charset=utf-8" });
  });
  app.get("/api/v1/openapi.json", async (c) => {
    openApiDocument ??= buildOpenApiDocument(ctx);
    return c.json(await openApiDocument);
  });

  app.post("/api/v1/files", async (c) => {
    if (!options.storage)
      return c.json(errorBody("unavailable", "File storage is unavailable."), 503);
    const settings = readSiteSettings(ctx);
    const uploaded = await uploadMultipart(
      ctx,
      c.get("actor"),
      c.req.raw,
      {
        ...options.storage,
        maxBytes: settings.maxUploadBytes,
        allowedTypesByPurpose: settings.allowedUploadTypes,
      },
      new URL(c.req.url).searchParams.get("purpose") ?? "attachment",
    );
    return c.json(uploaded, 201);
  });
  app.get("/api/v1/files/:fileId", (c) => {
    if (!options.storage)
      return c.json(errorBody("unavailable", "File storage is unavailable."), 503);
    const fileId = Number(c.req.param("fileId"));
    if (!Number.isSafeInteger(fileId) || fileId < 1)
      return c.json(errorBody("validation", "Invalid file ID."), 400);
    const response = createStorage(ctx, options.storage).serve(
      c.get("actor"),
      fileId,
      c.req.raw.headers,
    );
    // A refreshed session cookie goes out with this answer: no shared cache may keep it.
    if (c.get("setCookies").length)
      response.headers.set(
        "Cache-Control",
        (response.headers.get("Cache-Control") ?? "private, no-store").replace(
          /^public\b/,
          "private",
        ),
      );
    return response;
  });

  for (const { route, op } of routeOperations) {
    const path = `/api/v1${route.path.replace(/\{([^}]+)\}/g, ":$1")}`;
    const properties = schemaProperties(z.toJSONSchema(op.input, { io: "input" }));
    app.on(route.method, path, async (c) => {
      // A body that cannot be read as input is refused like input that does not validate: after
      // the operation has had its say about the caller.
      const unreadable = (message: string) =>
        refuseBeforeValidating(ctx, op, c.get("actor"), new ValidationError(message));
      const raw: Record<string, unknown> = Object.create(null);
      if (route.method === "GET" || route.method === "DELETE") {
        const params = new URL(c.req.url).searchParams;
        for (const name of new Set(params.keys()))
          raw[name] = coerceQueryValues(params.getAll(name), properties[name]);
      }
      // A DELETE may carry a JSON body too, so a secret need not travel in the URL; its fields
      // win over the same field in the query.
      if (route.method !== "GET") {
        const body = await c.req.raw.text();
        if (body) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return unreadable("Malformed JSON body.");
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            return unreadable("JSON body must be an object.");
          for (const [name, value] of Object.entries(parsed)) {
            if (name !== "__proto__" && name !== "constructor" && name !== "prototype")
              raw[name] = value;
          }
        }
      }
      for (const [name, value] of Object.entries(c.req.param()))
        raw[name] = coerce(String(value), properties[name]);
      if (op.name === "search.query") c.header("X-Robots-Tag", "noindex, follow");
      return c.json(await execute(ctx, op, c.get("actor"), raw), route.status);
    });
  }
  const knownRoutes = app.routes
    // Middleware is registered for ALL methods; the IndexNow key route matches any single segment.
    .filter((route) => route.method !== "ALL" && route.path !== "/:name")
    .map((route) => ({ method: route.method, pattern: routePattern(route.path) }));
  app.notFound((c) => {
    const methods = knownRoutes
      .filter((route) => route.pattern.test(c.req.path))
      .map((route) => route.method);
    const indexNowKey = readSiteSettings(ctx).indexNowKey;
    if (indexNowKey && c.req.path === `/${indexNowKey}.txt`) methods.push("GET");
    if (methods.length) {
      if (methods.includes("GET")) methods.push("HEAD");
      c.header("Allow", [...new Set(methods)].join(", "));
      return c.json(errorBody("method_not_allowed", "Method not allowed."), 405);
    }
    return c.json(errorBody("not_found", "The requested route could not be found."), 404);
  });
  return app;
}
