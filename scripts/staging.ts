import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@sermo/core";
import {
  BACKEND_PORT,
  DIST_DIR,
  formatStatus,
  killDecision,
  type Listener,
  ownMarkers,
  parseNetstat,
  parseStagingArgs,
  pendingMigrations,
  readPid,
  readSignIn,
  removePid,
  SERVICES,
  type Service,
  type ServiceState,
  type StagingPaths,
  seedEmail,
  stagingEnv,
  stagingPaths,
  WEB_PORT,
  writeEnvFile,
  writePid,
} from "./staging-lib";

// A second backend and web app on ports 4401 and 4400, run locally and not through the tunnel,
// on the large seed (or any database named with --db). See DECISIONS "Staging site (item 24)".
//
//   bun run staging:build [--db <path>]   web build into .next-staging, with the staging env
//   bun run staging:start [--db <path>]   migrates the database, then starts backend and
//                                         `next start` detached and waits until both answer
//   bun run staging:stop [--db <path>]    stops the two PIDs it started, after checking they are ours
//   bun run staging:status [--db <path>]  PIDs, ports and whether each answers

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps", "web");
const serverFile = join(root, "packages", "api", "src", "server.ts");
const loopbackFile = join(root, "scripts", "staging-loopback.ts");
// Migrations have no limit (see migrate); this only covers the servers opening their port.
const START_TIMEOUT_MS = 120_000;

const PORTS: Record<Service, number> = { backend: BACKEND_PORT, web: WEB_PORT };
// The web app answers to `localhost` only: its Host header must match the address it was told.
const HEALTH: Record<Service, string> = {
  backend: `http://127.0.0.1:${BACKEND_PORT}/health`,
  web: `http://localhost:${WEB_PORT}/`,
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The HTTP status of the health address (a redirect is not followed), or null when nothing answers. */
async function probe(service: Service): Promise<number | null> {
  try {
    const response = await fetch(HEALTH[service], {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

async function stateOf(paths: StagingPaths, service: Service): Promise<ServiceState> {
  const pid = readPid(paths, service);
  return {
    service,
    port: PORTS[service],
    pid,
    alive: pid !== null && isAlive(pid),
    answers: (await probe(service)) === 200,
  };
}

/** Listening sockets with their owners. Without `netstat -ano` (not Windows) none are known. */
function listeners(): Listener[] {
  if (process.platform !== "win32") return [];
  return parseNetstat(spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout);
}

function commandLineOf(pid: number): string | null {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
          ],
          { encoding: "utf8" },
        )
      : spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  return result.stdout.trim() || null;
}

function killTree(pid: number): void {
  // On Windows a signal always ends the process at once; /T also takes anything it started.
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(pid, "SIGTERM");
}

async function waitUntil(done: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await done()) return true;
    await Bun.sleep(500);
  }
  return false;
}

function tail(file: string, lines = 15): string {
  return existsSync(file)
    ? readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n")
    : "";
}

function launch(paths: StagingPaths, service: Service, secret: string): number {
  const env = stagingEnv(service, paths, secret);
  const log = openSync(paths.logFile(service), "a");
  const options = {
    env,
    detached: true,
    stdio: ["ignore", log, log] as ["ignore", number, number],
    windowsHide: true,
  };
  try {
    const child =
      service === "backend"
        ? // The database path after the script is ignored by the server; `stop` reads it from the
          // command line to know the process is staging's.
          spawn(
            process.execPath,
            ["--preload", loopbackFile, serverFile, "--staging-db", paths.db],
            { ...options, cwd: root },
          )
        : spawn(nodeBinary(), [nextBin(), "start", "-p", String(WEB_PORT), "-H", "localhost"], {
            ...options,
            cwd: webDir,
          });
    child.unref();
    if (child.pid === undefined) throw new Error(`The ${service} did not start.`);
    writePid(paths, service, child.pid);
    return child.pid;
  } finally {
    closeSync(log);
  }
}

/** The web app runs on Node, as the container does. */
function nodeBinary(): string {
  const node = Bun.which("node");
  if (!node) throw new Error("Node is needed to run `next start`; it is not on PATH.");
  return node;
}

function nextBin(): string {
  const require = createRequire(join(webDir, "package.json"));
  return join(dirname(require.resolve("next/package.json")), "dist", "bin", "next");
}

async function signInLines(paths: StagingPaths): Promise<string[]> {
  const signIn = readSignIn(paths);
  if (!signIn) return [`No ${paths.meta}: the sign-in password is unknown.`];
  let username = "";
  try {
    const db = new Database(paths.db, { readonly: true });
    username =
      db
        .query<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
        .get(signIn.adminId)?.username ?? "";
    db.close();
  } catch {
    /* the address below signs in as well */
  }
  return [
    `Sign in as ${username ? `${username} or ` : ""}${seedEmail(signIn.adminId)} (the administrator)`,
    `Password: ${signIn.password}`,
  ];
}

function build(paths: StagingPaths): number {
  const env = stagingEnv("web", paths, "");
  const result = spawnSync(process.execPath, ["run", "build"], {
    cwd: webDir,
    env,
    stdio: "inherit",
  });
  if (result.status === 0) console.log(`Built into apps/web/${DIST_DIR}.`);
  return result.status ?? 1;
}

/**
 * Applies pending migrations before any server starts, with no time limit: they run in one
 * transaction, so a migration that is stopped halfway starts over from nothing. The call blocks
 * until it ends, so the only progress is the line before and the line after.
 */
function migrate(paths: StagingPaths): void {
  const journal = JSON.parse(
    readFileSync(join(root, "packages", "core", "drizzle", "meta", "_journal.json"), "utf8"),
  ) as { entries: { when: number; tag: string }[] };
  const db = openDatabase(paths.db);
  try {
    let lastApplied: number | null = null;
    try {
      lastApplied =
        db.$client
          .query<{ last: number | null }, []>(
            "SELECT max(created_at) AS last FROM __drizzle_migrations",
          )
          .get()?.last ?? null;
    } catch {
      /* no migrations table yet: every migration is pending */
    }
    const pending = pendingMigrations(journal.entries, lastApplied);
    if (pending.length === 0) {
      console.log("The database is up to date.");
      return;
    }
    console.log(
      `Applying ${pending.length} migration(s), ${pending[0]} to ${pending.at(-1)}. No time limit; do not stop it.`,
    );
    const started = performance.now();
    runMigrations(db);
    console.log(`Migrated in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  } finally {
    db.$client.close(true);
  }
}

async function start(paths: StagingPaths): Promise<number> {
  if (!existsSync(paths.db)) {
    console.error(`No database at ${paths.db}. Generate one with bun run seed:large.`);
    return 1;
  }
  if (!existsSync(join(webDir, DIST_DIR, "BUILD_ID"))) {
    console.error("There is no staging build. Run bun run staging:build first.");
    return 1;
  }
  const taken = listeners();
  for (const service of SERVICES) {
    const pid = readPid(paths, service);
    if (pid !== null && isAlive(pid)) {
      console.error(`The ${service} is already running (pid ${pid}). Run staging:stop first.`);
      return 1;
    }
    if (
      taken.some((listener) => listener.port === PORTS[service]) ||
      (await probe(service)) !== null
    ) {
      console.error(`Something already uses port ${PORTS[service]}; staging will not start.`);
      return 1;
    }
  }
  nodeBinary();
  const secret = writeEnvFile(paths);
  mkdirSync(paths.files, { recursive: true });
  migrate(paths);
  const launched: number[] = [];
  for (const service of SERVICES) {
    const pid = launch(paths, service, secret);
    launched.push(pid);
    console.log(`${service} started, pid ${pid}, log ${paths.logFile(service)}`);
    const ready = await waitUntil(
      async () => (await probe(service)) === 200 || !isAlive(pid),
      START_TIMEOUT_MS,
    );
    if (!ready || !isAlive(pid) || (await probe(service)) !== 200) {
      console.error(
        `The ${service} did not come up. Last log lines:\n${tail(paths.logFile(service))}`,
      );
      // Only what this command launched: a PID file left by an earlier run may name a reused PID.
      for (const startedPid of launched) killTree(startedPid);
      for (const started of SERVICES) removePid(paths, started);
      return 1;
    }
  }
  console.log(formatStatus(await Promise.all(SERVICES.map((s) => stateOf(paths, s)))));
  console.log(`Web http://localhost:${WEB_PORT}  backend http://127.0.0.1:${BACKEND_PORT}`);
  for (const line of await signInLines(paths)) console.log(line);
  return 0;
}

async function stop(paths: StagingPaths): Promise<number> {
  let status = 0;
  for (const service of [...SERVICES].reverse()) {
    const pid = readPid(paths, service);
    if (pid === null) {
      console.log(`${service}: no PID file.`);
      continue;
    }
    if (!isAlive(pid)) {
      removePid(paths, service);
      console.log(`${service}: pid ${pid} was not running.`);
      continue;
    }
    // A PID file left by a crash or a reboot may name an unrelated process by now.
    const decision = killDecision({
      pid,
      alive: true,
      port: PORTS[service],
      listeners: listeners(),
      commandLine: commandLineOf(pid),
      markers: ownMarkers(service, paths, { server: serverFile, next: nextBin() }),
    });
    if (!decision.kill) {
      console.error(
        `${service}: pid ${pid} is not stopped: ${decision.reason}. If it is not staging's, remove ${paths.pidFile(service)}.`,
      );
      status = 1;
      continue;
    }
    killTree(pid);
    if (await waitUntil(() => !isAlive(pid), 15_000)) {
      removePid(paths, service);
      console.log(`${service}: stopped pid ${pid} (${decision.reason}).`);
    } else {
      console.error(`${service}: pid ${pid} is still running.`);
      status = 1;
    }
  }
  return status;
}

async function status(paths: StagingPaths): Promise<number> {
  console.log(formatStatus(await Promise.all(SERVICES.map((s) => stateOf(paths, s)))));
  console.log(`Database ${paths.db}\nState ${paths.state}`);
  for (const line of await signInLines(paths)) console.log(line);
  return 0;
}

let exitCode = 0;
try {
  const { command, db } = parseStagingArgs(process.argv.slice(2));
  const paths = stagingPaths(db);
  exitCode = await { build, start, stop, status }[command](paths);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
}
process.exit(exitCode);
