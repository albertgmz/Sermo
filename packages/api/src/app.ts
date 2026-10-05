import {
  type Actor,
  atomFeed,
  CLIENT_IP_HEADER,
  type Ctx,
  createStorage,
  execute,
  getAuth,
  readSiteSettings,
  resolveActor,
  robotsTxt,
  SermoError,
  type StorageConfig,
  sitemapIndex,
  sitemapShard,
} from "@sermo/core";
import { createMcpHandler } from "@sermo/mcp";
import { type Context, Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import * as z from "zod";
import type { JSONSchema } from "zod/v4/core";
import { buildOpenApiDocument } from "./openapi";
import { routeOperations, routes } from "./routes";
import { uploadMultipart } from "./upload";

export const RATE_LIMITS = { read: 300, write: 60, search: 30, mcp: 60 } as const;
export interface AppOptions {
  trustedProxyHeader: string | null;
  storage?: StorageConfig;
  /** Override the fixed window in tests. */
  rateLimitWindowMs?: number;
  /** Override the quotas in tests. */
  rateLimits?: Partial<Record<keyof typeof RATE_LIMITS, number>>;
}

type Variables = { actor: Actor; clientIp: string; setCookies: string[] };
type ApiContext = Context<{ Variables: Variables }>;
type Schema = Record<string, unknown>;
type Resolution = { actor: Actor; setCookies: string[] };
const MCP_RESOLUTION = Symbol("mcpResolution");
const statuses = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
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

function routePattern(path: string): RegExp {
  return new RegExp(`^/api/v1${path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
}

export function createApp(ctx: Ctx, options: AppOptions): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  let openApiDocument: Promise<object> | undefined;
  const limits = { ...RATE_LIMITS, ...options.rateLimits };
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  let loggedUnknownIp = false;

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );
  app.use("*", async (c, next) => {
    let ip: string | undefined;
    if (options.trustedProxyHeader) {
      ip = c.req.header(options.trustedProxyHeader)?.split(",").at(-1)?.trim();
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
    c.req.raw = new Request(c.req.raw, { headers });
    c.set("clientIp", ip);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof SermoError)
      return c.json(errorBody(error.code, error.message, error.issues), statuses[error.code]);
    if (error instanceof HTTPException && error.status === 403)
      return c.json(errorBody("forbidden", "The request origin was rejected."), 403);
    console.error("API request failed", error);
    return c.json(errorBody("internal", "Internal server error."), 500);
  });

  app.all("/api/auth/*", (c) => getAuth(ctx).handler(c.req.raw));

  const resolve = async (c: ApiContext, next: () => Promise<void>) => {
    const result = await resolveActor(ctx, c.req.raw.headers);
    c.set("actor", result.actor);
    c.set("setCookies", result.setCookies);
    if (c.req.path === "/mcp") Reflect.set(c.req.raw, MCP_RESOLUTION, result);
    await next();
    if (c.req.path !== "/mcp")
      for (const cookie of result.setCookies) c.res.headers.append("Set-Cookie", cookie);
  };
  app.use("/api/v1/*", resolve);
  app.use("/mcp", resolve);

  const key = (c: ApiContext) => {
    const actor = c.get("actor");
    return actor.kind === "guest"
      ? `ip:${c.get("clientIp")}`
      : actor.kind === "token"
        ? `key:${actor.tokenId}`
        : `user:${actor.userId}`;
  };
  const limiter = (limit: number) =>
    rateLimiter({
      windowMs,
      limit,
      standardHeaders: "draft-6",
      keyGenerator: key,
      handler: (c) => c.json(errorBody("rate_limited", "Too many requests."), 429),
    });
  const readLimiter = limiter(limits.read);
  const writeLimiter = limiter(limits.write);
  const searchLimiter = limiter(limits.search);
  const mcpLimiter = limiter(limits.mcp);
  app.use("/api/v1/*", (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD")
      return (c.req.path === "/api/v1/search" ? searchLimiter : readLimiter)(c, next);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return writeLimiter(c, next);
    return next();
  });
  app.use("/mcp", mcpLimiter);

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
        (upload && /^multipart\/form-data\s*;/i.test(c.req.header("content-type") ?? ""))
      )
    )
      return c.json(
        errorBody("unsupported_media_type", "Content-Type must be application/json."),
        415,
      );
    await next();
  });

  const mcp = createMcpHandler({
    ctx,
    resolveActor: async (request) => {
      const resolved = Reflect.get(request, MCP_RESOLUTION) as Resolution | undefined;
      if (!resolved) throw new Error("MCP actor was not resolved by the request middleware.");
      return resolved;
    },
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
  app.get("/sitemap.xml", (c) =>
    c.text(sitemapIndex(ctx, siteURL), 200, { "content-type": "application/xml; charset=utf-8" }),
  );
  app.get("/sitemaps/:name", (c) => {
    const parsed = /^(node|thread|profile)-(\d+)\.xml$/.exec(c.req.param("name"));
    if (!parsed) return c.json(errorBody("not_found", "Unknown sitemap."), 404);
    const kind = parsed[1] as "node" | "thread" | "profile";
    const shard = Number(parsed[2]);
    if (!Number.isSafeInteger(shard) || shard < 1)
      return c.json(errorBody("validation", "Invalid sitemap shard."), 400);
    return c.text(sitemapShard(ctx, siteURL, kind, shard), 200, {
      "content-type": "application/xml; charset=utf-8",
    });
  });
  app.get("/feed.atom", (c) =>
    c.text(atomFeed(ctx, siteURL, "Sermo"), 200, {
      "content-type": "application/atom+xml; charset=utf-8",
    }),
  );
  app.get("/nodes/:nodeId/feed.atom", (c) => {
    const match = /^(\d+)(?:-[^/]+)?$/.exec(c.req.param("nodeId"));
    const id = Number(match?.[1]);
    if (!Number.isSafeInteger(id) || id < 1)
      return c.json(errorBody("validation", "Invalid node ID."), 400);
    return c.text(atomFeed(ctx, siteURL, "Sermo", id), 200, {
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
        groupUploadLimitBytes: settings.groupUploadLimitBytes,
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
    return createStorage(ctx, options.storage).serve(c.get("actor"), fileId);
  });

  for (const { route, op } of routeOperations) {
    const path = `/api/v1${route.path.replace(/\{([^}]+)\}/g, ":$1")}`;
    const properties = schemaProperties(z.toJSONSchema(op.input, { io: "input" }));
    app.on(route.method, path, async (c) => {
      const raw: Record<string, unknown> = Object.create(null);
      if (route.method === "GET" || route.method === "DELETE") {
        const params = new URL(c.req.url).searchParams;
        for (const name of new Set(params.keys()))
          raw[name] = coerceQueryValues(params.getAll(name), properties[name]);
      } else {
        const body = await c.req.raw.text();
        if (body) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return c.json(errorBody("validation", "Malformed JSON body."), 400);
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            return c.json(errorBody("validation", "JSON body must be an object."), 400);
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
  app.notFound((c) => {
    const path = c.req.path;
    const methods: string[] = routes
      .filter((route) => routePattern(route.path).test(path))
      .map((route) => route.method);
    if (path === "/api/v1/openapi.json") methods.push("GET");
    if (methods.length) {
      if (methods.includes("GET")) methods.push("HEAD");
      c.header("Allow", [...new Set(methods)].join(", "));
      return c.json(errorBody("method_not_allowed", "Method not allowed."), 405);
    }
    return c.json(errorBody("not_found", "The requested route could not be found."), 404);
  });
  return app;
}
