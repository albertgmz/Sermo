import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CLIENT_IP_HEADER,
  closeContext,
  closeEmail,
  configurePush,
  createContext,
  ensureAdmin,
  flushDownloadCounts,
  flushViewCounts,
  isLoopbackHost,
  localDriver,
  registerEmailJobs,
  registerEmailTypes,
  registerJobHandlers,
  registerModerationJobs,
  registerNotificationJobs,
  registerPromotionJobs,
  registerSeoJobs,
  registerSocialJobs,
  registerStorageJobs,
  s3Driver,
  startCheckpointer,
  startJobWorker,
  startScheduler,
  validatePushVapid,
} from "@sermo/core";
import { createApp } from "./app";

/** Adapt RFC 8058 one-click posts to the contract's JSON input. */
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
  const token = url.searchParams.get("token") ?? "";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
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
    const body = response.ok
      ? "Your email preferences were updated."
      : "This link is invalid or expired.";
    return new Response(`<!doctype html><html><body><p>${body}</p></body></html>`, {
      status: response.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return response;
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
    vapid,
    auth: {
      secret,
      baseURL,
      trustedOrigins: (source.SERMO_TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      clientIpHeader: CLIENT_IP_HEADER,
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
  if (config.admin) await ensureAdmin(ctx, config.admin);
  const stopCheckpointer = startCheckpointer(ctx);
  registerJobHandlers(ctx);
  const stopWorker = startJobWorker(ctx);
  const stopScheduler = startScheduler(ctx);
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
  const emailTypes = {
    defaults: { "digest.weekly": { inApp: false, email: true, push: false } },
    securityTypes: new Set<string>(),
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
  const app = createApp(ctx, {
    trustedProxyHeader: config.trustedProxyHeader,
    storage: { driver, tempDir: join(dirname(config.path), "upload-temp") },
  });
  const server = Bun.serve({
    port: config.port,
    fetch: (request, server) => handleUnsubscribeRequest(request, app, server),
  });
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
