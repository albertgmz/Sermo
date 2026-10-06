import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CLIENT_IP_HEADER,
  closeContext,
  createContext,
  ensureAdmin,
  flushDownloadCounts,
  flushViewCounts,
  localDriver,
  registerJobHandlers,
  registerModerationJobs,
  registerPromotionJobs,
  registerSeoJobs,
  registerSocialJobs,
  registerStorageJobs,
  s3Driver,
  startCheckpointer,
  startJobWorker,
  startScheduler,
} from "@sermo/core";
import { createApp } from "./app";

export interface ShutdownDependencies {
  stopAccepting(): void | Promise<void>;
  flushViewCounts(): void | Promise<void>;
  stopScheduler(): void | Promise<void>;
  stopWorker(): void | Promise<void>;
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
    trustedProxyHeader: source.SERMO_TRUSTED_PROXY_HEADER ?? null,
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
  registerPromotionJobs(ctx);
  registerSeoJobs(ctx);
  registerSocialJobs(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: config.trustedProxyHeader,
    storage: { driver, tempDir: join(dirname(config.path), "upload-temp") },
  });
  const server = Bun.serve({ port: config.port, fetch: app.fetch });
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
