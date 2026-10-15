import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CLIENT_IP_HEADER,
  closeContext,
  closeEmail,
  configurePush,
  configureSecurity,
  createContext,
  ensureAdmin,
  flushActivity,
  flushDownloadCounts,
  flushSessionActivity,
  flushViewCounts,
  isLoopbackHost,
  localDriver,
  notificationChannels,
  notificationPushPhrase,
  openGeoDatabase,
  registerAccountEmailJobs,
  registerAwardJobs,
  registerCreditJobs,
  registerCreditRuleJobs,
  registerEmailJobs,
  registerEmailTypes,
  registerJobHandlers,
  registerModerationJobs,
  registerNotificationJobs,
  registerPromotionJobs,
  registerPushJobs,
  registerRankingJobs,
  registerSecurityJobs,
  registerSeoJobs,
  registerShopJobs,
  registerSocialJobs,
  registerStandingJobs,
  registerStorageJobs,
  s3Driver,
  startCheckpointer,
  startJobWorker,
  startScheduler,
  validatePushVapid,
} from "@sermo/core";
import { Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createApp, type RATE_LIMITS } from "./app";

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;

/**
 * Adapt the two unsubscribe link flavours to the contract's JSON input: the browser link and the
 * RFC 8058 one-click post both carry the token in the query string. A JSON request (the
 * documented API form) is passed through untouched.
 */
export function adaptUnsubscribeRequest(request: Request): Request | Response {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1/unsubscribe") return request;
  if (request.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    if (!/^[A-Za-z0-9_.-]{16,1000}$/.test(token))
      return new Response("Invalid link.", { status: 400 });
    const body =
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
      "<h1>Unsubscribe from notification emails</h1>" +
      `<form method="post" action="/api/v1/unsubscribe?token=${token}&amp;confirm=1"><button type="submit">Unsubscribe</button></form></body></html>`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (request.method !== "POST") return request;
  if (JSON_CONTENT_TYPE.test(request.headers.get("content-type") ?? "")) return request;
  const token = url.searchParams.get("token") ?? "";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
}

function unsubscribeMessage(status: number): string {
  if (status >= 200 && status < 300) return "Your email preferences were updated.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong. Please try again later.";
  return "This link is invalid or expired.";
}

export async function handleUnsubscribeRequest(
  request: Request,
  app: ReturnType<typeof createApp>,
  server?: {
    requestIP(request: Request): { address: string; family: "IPv4" | "IPv6"; port: number } | null;
  },
): Promise<Response> {
  const ip = server?.requestIP(request);
  const adapted = adaptUnsubscribeRequest(request);
  if (adapted instanceof Response) return adapted;
  const response = await app.fetch(adapted, {
    requestIP: () => ip ?? null,
  });
  if (
    request.method === "POST" &&
    new URL(request.url).searchParams.get("confirm") === "1" &&
    new URL(request.url).pathname === "/api/v1/unsubscribe"
  ) {
    // Keep what the app set (cookies, rate-limit and security headers, Retry-After); replace only
    // the headers that describe the body.
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.delete("ETag");
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(
      `<!doctype html><html><body><p>${unsubscribeMessage(response.status)}</p></body></html>`,
      { status: response.status, headers },
    );
  }
  return response;
}

/**
 * Transport ceiling for request bodies. It must admit the largest upload the settings allow
 * (1 GiB, see the settings contract) plus multipart framing; the application limit
 * (`maxUploadBytes`, enforced by storage while streaming to a temp file) is what rejects an
 * oversized upload, with the normal error envelope.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024 * 1024 + 1024 * 1024;
/** Every other request keeps the ceiling Bun applied before the transport limit was raised. */
export const MAX_NON_UPLOAD_BODY_BYTES = 128 * 1024 * 1024;

const secureBodyLimitResponse = secureHeaders({
  // Match createApp for rejections returned before its middleware can run.
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  referrerPolicy: "strict-origin-when-cross-origin",
});

function payloadTooLarge(headers?: Headers): Response {
  const responseHeaders = new Headers(headers);
  for (const name of ["content-length", "content-encoding", "etag"]) responseHeaders.delete(name);
  responseHeaders.set("content-type", "application/json");
  return Response.json(
    { error: { code: "payload_too_large", message: "The request body is too large." } },
    { status: 413, headers: responseHeaders },
  );
}

async function securedPayloadTooLarge(request: Request, response?: Response): Promise<Response> {
  const context = new Context(request);
  context.res = payloadTooLarge(response?.headers);
  await secureBodyLimitResponse(context, async () => {});
  return context.res;
}

/**
 * Only the upload route may exceed `MAX_NON_UPLOAD_BODY_BYTES`: everything else is parsed in
 * memory, so a larger transport ceiling must not apply to it.
 */
export function limitRequestBody(
  request: Request,
  limit = MAX_NON_UPLOAD_BODY_BYTES,
  onLimitExceeded: () => void = () => {},
): Request | Response {
  if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/files")
    return request;
  const declared = request.headers.get("content-length");
  if (declared !== null) return Number(declared) > limit ? payloadTooLarge() : request;
  if (!request.body) return request;
  let seen = 0;
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          onLimitExceeded();
          controller.error(new Error("Request body too large."));
        } else controller.enqueue(chunk);
      },
    }),
  );
  return new Request(request, { body: counted, duplex: "half" } as RequestInit);
}

export async function handleRequest(
  request: Request,
  app: ReturnType<typeof createApp>,
  server?: Parameters<typeof handleUnsubscribeRequest>[2],
  options: { maxNonUploadBodyBytes?: number } = {},
): Promise<Response> {
  // Bun associates the socket with this Request; wrapping its body loses that association.
  const ip = server?.requestIP(request);
  let exceeded = false;
  const limited = limitRequestBody(request, options.maxNonUploadBodyBytes, () => {
    exceeded = true;
  });
  if (limited instanceof Response) return securedPayloadTooLarge(request);
  try {
    const response = await handleUnsubscribeRequest(limited, app, {
      requestIP: () => ip ?? null,
    });
    // Body readers can catch the stream error and return any status. The boundary owns 413.
    return exceeded ? securedPayloadTooLarge(request, response) : response;
  } catch (error) {
    if (exceeded) return securedPayloadTooLarge(request);
    throw error;
  }
}

/** These are the options passed to Bun in production and in transport regression tests. */
export function createServerOptions(
  app: ReturnType<typeof createApp>,
  port: number,
  options: Parameters<typeof handleRequest>[3] = {},
) {
  return {
    port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: (request: Request, server: Bun.Server<undefined>) =>
      handleRequest(request, app, server, options),
  };
}

export interface ShutdownDependencies {
  stopAccepting(): void | Promise<void>;
  flushViewCounts(): void | Promise<void>;
  stopScheduler(): void | Promise<void>;
  stopWorker(): void | Promise<void>;
  closeMailer(): void | Promise<void>;
  stopCheckpointer(): void | Promise<void>;
  closeContext(): void;
}

/** Finish active requests before closing their database, even when cleanup fails. */
export async function shutdown(deps: ShutdownDependencies): Promise<void> {
  const failures: unknown[] = [];
  try {
    for (const step of [
      deps.stopAccepting,
      deps.flushViewCounts,
      deps.stopScheduler,
      deps.stopWorker,
      deps.closeMailer,
      deps.stopCheckpointer,
    ]) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    try {
      deps.closeContext();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Server shutdown failed.");
}

function required(source: Record<string, string | undefined>, name: string): string {
  const value = source[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function readConfiguration(source: Record<string, string | undefined> = process.env) {
  const port = Number(source.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be a valid port number.");
  const adminNames = ["SERMO_ADMIN_USERNAME", "SERMO_ADMIN_EMAIL", "SERMO_ADMIN_PASSWORD"] as const;
  const presentAdminNames = adminNames.filter((name) => Boolean(source[name]));
  if (presentAdminNames.length > 0 && presentAdminNames.length !== adminNames.length)
    throw new Error(
      "SERMO_ADMIN_USERNAME, SERMO_ADMIN_EMAIL, and SERMO_ADMIN_PASSWORD must all be set together.",
    );
  const secret = required(source, "BETTER_AUTH_SECRET");
  if (secret.length < 32)
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters. Generate one with the command in .env.example.",
    );
  const baseURL = required(source, "BETTER_AUTH_URL");
  new URL(baseURL);
  const siteURL = new URL(source.SERMO_SITE_URL || baseURL);
  if (
    !["http:", "https:"].includes(siteURL.protocol) ||
    siteURL.pathname !== "/" ||
    siteURL.search ||
    siteURL.hash ||
    siteURL.username ||
    siteURL.password
  )
    throw new Error("SERMO_SITE_URL must be an HTTP(S) origin without a path or credentials.");
  const publicFilesURL = source.SERMO_PUBLIC_FILES_URL
    ? new URL(source.SERMO_PUBLIC_FILES_URL)
    : null;
  if (
    publicFilesURL &&
    (!["http:", "https:"].includes(publicFilesURL.protocol) ||
      publicFilesURL.pathname !== "/" ||
      publicFilesURL.search ||
      publicFilesURL.hash ||
      publicFilesURL.username ||
      publicFilesURL.password)
  )
    throw new Error(
      "SERMO_PUBLIC_FILES_URL must be an HTTP(S) origin without a path or credentials.",
    );
  const storageDriver = source.SERMO_STORAGE_DRIVER ?? "local";
  if (storageDriver !== "local" && storageDriver !== "s3")
    throw new Error("SERMO_STORAGE_DRIVER must be local or s3.");
  if (storageDriver === "s3" && !source.SERMO_S3_BUCKET)
    throw new Error("SERMO_S3_BUCKET is required for S3 storage.");
  const mailDriver = source.SERMO_MAIL_DRIVER ?? "none";
  if (!["none", "capture", "smtp"].includes(mailDriver))
    throw new Error("SERMO_MAIL_DRIVER must be none, capture, or smtp.");
  const smtpPort = Number(source.SERMO_SMTP_PORT ?? "587");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    throw new Error("SERMO_SMTP_PORT must be a valid port.");
  if (mailDriver === "smtp" && (!source.SERMO_SMTP_HOST || !source.SERMO_MAIL_FROM))
    throw new Error("SERMO_SMTP_HOST and SERMO_MAIL_FROM are required for SMTP.");
  if (mailDriver === "smtp" && siteURL.protocol !== "https:" && !isLoopbackHost(siteURL.hostname))
    throw new Error("SERMO_SITE_URL must use HTTPS for SMTP unsubscribe links.");
  if (source.SERMO_SMTP_SECURE && !["true", "false"].includes(source.SERMO_SMTP_SECURE))
    throw new Error("SERMO_SMTP_SECURE must be true or false.");
  if (source.SERMO_SMTP_REQUIRE_TLS && !["true", "false"].includes(source.SERMO_SMTP_REQUIRE_TLS))
    throw new Error("SERMO_SMTP_REQUIRE_TLS must be true or false.");
  if (
    source.SERMO_SESSION_COOKIE_CACHE &&
    !["true", "false"].includes(source.SERMO_SESSION_COOKIE_CACHE)
  )
    throw new Error("SERMO_SESSION_COOKIE_CACHE must be true or false.");
  const retentionDays = Number(source.SERMO_IP_LOG_RETENTION_DAYS || "180");
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new Error("SERMO_IP_LOG_RETENTION_DAYS must be a positive whole number of days.");
  if (
    source.SERMO_TRUST_LOCATION_HEADERS &&
    !["true", "false"].includes(source.SERMO_TRUST_LOCATION_HEADERS)
  )
    throw new Error("SERMO_TRUST_LOCATION_HEADERS must be true or false.");
  const trustLocationHeaders = source.SERMO_TRUST_LOCATION_HEADERS === "true";
  if (trustLocationHeaders && !source.SERMO_TRUSTED_PROXY_HEADER)
    throw new Error(
      "SERMO_TRUST_LOCATION_HEADERS needs SERMO_TRUSTED_PROXY_HEADER: the location headers are trusted only behind a proxy.",
    );
  const vapidNames = [
    "SERMO_VAPID_PUBLIC_KEY",
    "SERMO_VAPID_PRIVATE_KEY",
    "SERMO_VAPID_SUBJECT",
  ] as const;
  const vapidPresent = vapidNames.filter((name) => Boolean(source[name]));
  if (vapidPresent.length > 0 && vapidPresent.length !== vapidNames.length)
    throw new Error(
      "SERMO_VAPID_PUBLIC_KEY, SERMO_VAPID_PRIVATE_KEY, and SERMO_VAPID_SUBJECT must all be set together.",
    );
  const vapid =
    vapidPresent.length === vapidNames.length
      ? {
          publicKey: required(source, "SERMO_VAPID_PUBLIC_KEY"),
          privateKey: required(source, "SERMO_VAPID_PRIVATE_KEY"),
          subject: required(source, "SERMO_VAPID_SUBJECT"),
        }
      : null;
  if (vapid && !/^(mailto:.+@.+|https:\/\/[^/]+.*)$/.test(vapid.subject))
    throw new Error("SERMO_VAPID_SUBJECT must be a mailto: address or HTTPS URL.");
  validatePushVapid(vapid);
  return {
    path: source.SERMO_DB_PATH ?? "./data/sermo.db",
    port,
    siteBaseURL: siteURL.origin,
    publicFileBaseURL: publicFilesURL?.origin,
    storage: {
      driver: storageDriver,
      directory:
        source.SERMO_FILES_DIR || join(dirname(source.SERMO_DB_PATH ?? "./data/sermo.db"), "files"),
      bucket: source.SERMO_S3_BUCKET,
      endpoint: source.SERMO_S3_ENDPOINT,
      region: source.SERMO_S3_REGION,
      accessKeyId: source.SERMO_S3_ACCESS_KEY_ID,
      secretAccessKey: source.SERMO_S3_SECRET_ACCESS_KEY,
    },
    mail: {
      driver: mailDriver as "none" | "capture" | "smtp",
      sender: source.SERMO_MAIL_FROM ?? "Sermo <no-reply@localhost>",
      replyTo: source.SERMO_MAIL_REPLY_TO,
      host: source.SERMO_SMTP_HOST,
      port: smtpPort,
      secure: source.SERMO_SMTP_SECURE === "true",
      requireTLS: source.SERMO_SMTP_REQUIRE_TLS
        ? source.SERMO_SMTP_REQUIRE_TLS === "true"
        : undefined,
      user: source.SERMO_SMTP_USER,
      password: source.SERMO_SMTP_PASSWORD,
    },
    trustedProxyHeader: source.SERMO_TRUSTED_PROXY_HEADER ?? null,
    trustLocationHeaders,
    ipLogRetentionDays: retentionDays,
    geoDatabase: source.SERMO_GEOIP_DATABASE || null,
    rateLimits: Object.fromEntries(
      (["read", "write", "search", "mcp"] as const).flatMap((bucket) => {
        const name = `SERMO_RATE_LIMIT_${bucket.toUpperCase()}`;
        const value = source[name];
        if (!value) return [];
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1)
          throw new Error(`${name} must be a positive integer.`);
        return [[bucket, limit]];
      }),
    ) as Partial<Record<keyof typeof RATE_LIMITS, number>>,
    vapid,
    auth: {
      secret,
      baseURL,
      trustedOrigins: (source.SERMO_TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      clientIpHeader: CLIENT_IP_HEADER,
      sessionCookieCache: source.SERMO_SESSION_COOKIE_CACHE !== "false",
    },
    admin:
      presentAdminNames.length === adminNames.length
        ? {
            username: required(source, "SERMO_ADMIN_USERNAME"),
            email: required(source, "SERMO_ADMIN_EMAIL"),
            password: required(source, "SERMO_ADMIN_PASSWORD"),
          }
        : null,
  };
}

async function main(): Promise<void> {
  const config = readConfiguration();
  mkdirSync(dirname(config.path), { recursive: true });
  const ctx = createContext({
    path: config.path,
    migrate: true,
    config: {
      auth: config.auth,
      publicFileBaseURL: config.publicFileBaseURL,
      siteBaseURL: config.siteBaseURL,
    },
  });
  configurePush(ctx, { vapid: config.vapid });
  configureSecurity(ctx, {
    ipLogRetentionDays: config.ipLogRetentionDays,
    geoLookup: await openGeoDatabase(config.geoDatabase),
  });
  const stopCheckpointer = startCheckpointer(ctx);
  registerJobHandlers(ctx);
  const driver =
    config.storage.driver === "local"
      ? localDriver(config.storage.directory)
      : s3Driver({
          bucket: config.storage.bucket!,
          ...(config.storage.endpoint ? { endpoint: config.storage.endpoint } : {}),
          ...(config.storage.region ? { region: config.storage.region } : {}),
          ...(config.storage.accessKeyId ? { accessKeyId: config.storage.accessKeyId } : {}),
          ...(config.storage.secretAccessKey
            ? { secretAccessKey: config.storage.secretAccessKey }
            : {}),
        });
  registerStorageJobs(ctx, { driver, tempDir: join(dirname(config.path), "upload-temp") });
  registerModerationJobs(ctx);
  registerNotificationJobs(ctx);
  registerPromotionJobs(ctx);
  registerSeoJobs(ctx);
  registerSocialJobs(ctx);
  registerCreditJobs(ctx);
  registerCreditRuleJobs(ctx);
  registerAwardJobs(ctx);
  registerShopJobs(ctx);
  registerRankingJobs(ctx);
  registerStandingJobs(ctx);
  registerSecurityJobs(ctx);
  const emailTypes = {
    ...notificationChannels,
    defaults: {
      ...notificationChannels.defaults,
      "digest.weekly": { inApp: false, email: true, push: false },
    },
  };
  registerEmailTypes(ctx, emailTypes);
  registerEmailJobs(
    ctx,
    config.mail.driver === "smtp"
      ? {
          driver: "smtp",
          sender: config.mail.sender,
          ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
          host: config.mail.host!,
          port: config.mail.port,
          secure: config.mail.secure,
          ...(config.mail.requireTLS !== undefined ? { requireTLS: config.mail.requireTLS } : {}),
          ...(config.mail.user ? { user: config.mail.user } : {}),
          ...(config.mail.password ? { password: config.mail.password } : {}),
        }
      : {
          driver: config.mail.driver,
          sender: config.mail.sender,
          ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
        },
    emailTypes,
  );
  registerPushJobs(ctx, { renderPhrase: notificationPushPhrase(ctx) });
  registerAccountEmailJobs(ctx);
  if (config.admin) await ensureAdmin(ctx, config.admin);
  const stopWorker = startJobWorker(ctx);
  const stopScheduler = startScheduler(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: config.trustedProxyHeader,
    trustProxyLocation: config.trustLocationHeaders,
    rateLimits: config.rateLimits,
    storage: { driver, tempDir: join(dirname(config.path), "upload-temp") },
  });
  const server = Bun.serve(createServerOptions(app, config.port));
  console.info(`Sermo listening on ${server.url}`);

  let stopping = false;
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    void shutdown({
      stopAccepting: () => server.stop(),
      flushViewCounts: () => {
        flushViewCounts(ctx);
        flushDownloadCounts(ctx);
        flushActivity(ctx);
        flushSessionActivity(ctx);
      },
      stopScheduler,
      stopWorker,
      closeMailer: () => closeEmail(ctx),
      stopCheckpointer,
      closeContext: () => closeContext(ctx),
    }).then(
      () => process.exit(0),
      (error) => {
        console.error("Server shutdown failed", error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

if (import.meta.main) await main();
