import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CLIENT_IP_HEADER, closeContext, createContext, startCheckpointer } from "@sermo/core";
import { ensureAdmin } from "../../core/src/modules/auth";
import {
  flushViewCounts,
  registerJobHandlers,
  startJobWorker,
  startScheduler,
} from "../../core/src/modules/jobs";
import { createApp } from "./app";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const path = process.env.SERMO_DB_PATH ?? "./data/sermo.db";
mkdirSync(dirname(path), { recursive: true });
const ctx = createContext({
  path,
  migrate: true,
  config: {
    auth: {
      secret: required("BETTER_AUTH_SECRET"),
      baseURL: required("BETTER_AUTH_URL"),
      trustedOrigins: (process.env.SERMO_TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      clientIpHeader: CLIENT_IP_HEADER,
    },
  },
});
const adminNames = ["SERMO_ADMIN_USERNAME", "SERMO_ADMIN_EMAIL", "SERMO_ADMIN_PASSWORD"] as const;
if (adminNames.every((name) => process.env[name])) {
  await ensureAdmin(ctx, {
    username: required("SERMO_ADMIN_USERNAME"),
    email: required("SERMO_ADMIN_EMAIL"),
    password: required("SERMO_ADMIN_PASSWORD"),
  });
}
const stopCheckpointer = startCheckpointer(ctx);
registerJobHandlers(ctx);
const stopWorker = startJobWorker(ctx);
const stopScheduler = startScheduler(ctx);
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PORT must be a valid port number.");
const app = createApp(ctx, { trustedProxyHeader: process.env.SERMO_TRUSTED_PROXY_HEADER ?? null });
const server = Bun.serve({ port, fetch: app.fetch });
console.info(`Sermo listening on ${server.url}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.stop();
  flushViewCounts(ctx);
  stopWorker();
  stopScheduler();
  await stopCheckpointer();
  closeContext(ctx);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
