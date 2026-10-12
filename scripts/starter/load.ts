import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Actor,
  closeContext,
  createContext,
  createStorage,
  execute,
  getOperation,
  localDriver,
  s3Driver,
} from "@sermo/core";
import { readConfiguration } from "../../packages/api/src/server";
import { loadStarter, type Outcome } from "./loader";

const usage = "Usage: bun run starter:load --admin <username>";

const flag = process.argv.indexOf("--admin");
const username = flag === -1 ? undefined : process.argv[flag + 1];
if (!username || username.startsWith("--")) {
  console.error(`An administrator to act as is required. ${usage}`);
  process.exit(2);
}

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

const fail = (message: string): never => {
  console.error(message);
  closeContext(ctx);
  process.exit(1);
};

const member = ctx.sqlite
  .prepare<{ id: number; group_id: number }, [string]>(
    "SELECT id, group_id FROM users WHERE username_key = lower(?1)",
  )
  .get(username);
if (!member) fail(`There is no member named "${username}". Create the account first.`);
const actor: Actor = {
  kind: "user",
  userId: member!.id,
  groupId: member!.group_id,
  sessionId: 0,
};
try {
  // Reading the site settings needs administration rights: the cheapest check there is.
  await execute(ctx, getOperation("settings.get"), actor, {});
} catch {
  fail(`"${username}" is not an administrator: pick a member who can administer the site.`);
}

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
const storage = createStorage(ctx, { driver, tempDir: join(dirname(config.path), "upload-temp") });

const totals: Record<Outcome, number> = { created: 0, exists: 0, skipped: 0, failed: 0 };
const words: Record<Outcome, string> = {
  created: "created",
  exists: "already there",
  skipped: "skipped",
  failed: "FAILED",
};
try {
  await loadStarter({
    ctx,
    storage,
    actor,
    root: dirname(fileURLToPath(import.meta.url)),
    report: ({ outcome, kind, label, note }) => {
      totals[outcome] += 1;
      console.log(`${words[outcome].padEnd(13)} ${kind}: ${label}${note ? ` (${note})` : ""}`);
    },
  });
} finally {
  closeContext(ctx);
}

console.log(
  `\n${totals.created} created, ${totals.exists} already there, ${totals.skipped} skipped, ${totals.failed} failed.`,
);
if (totals.failed > 0) process.exit(1);
