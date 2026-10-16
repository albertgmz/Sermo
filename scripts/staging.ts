import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKEND_PORT,
  DIST_DIR,
  formatStatus,
  parseStagingArgs,
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
//   bun run staging:start [--db <path>]   backend and `next start`, detached, waits until both answer
//   bun run staging:stop [--db <path>]    stops the two PIDs it started
//   bun run staging:status [--db <path>]  PIDs, ports and whether each answers

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps", "web");
const START_TIMEOUT_MS = 300_000;

const PORTS: Record<Service, number> = { backend: BACKEND_PORT, web: WEB_PORT };
const HEALTH: Record<Service, string> = {
  backend: `http://127.0.0.1:${BACKEND_PORT}/health`,
  web: `http://127.0.0.1:${WEB_PORT}/`,
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The HTTP status of the health address (a redirect is not followed), or null when nothing listens. */
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
  try {
    const child =
      service === "backend"
        ? spawn(process.execPath, [join(root, "packages", "api", "src", "server.ts")], {
            cwd: root,
            env,
            detached: true,
            stdio: ["ignore", log, log],
            windowsHide: true,
          })
        : spawn(nodeBinary(), [nextBin(), "start", "-p", String(WEB_PORT)], {
            cwd: webDir,
            env,
            detached: true,
            stdio: ["ignore", log, log],
            windowsHide: true,
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

async function start(paths: StagingPaths): Promise<number> {
  if (!existsSync(paths.db)) {
    console.error(`No database at ${paths.db}. Generate one with bun run seed:large.`);
    return 1;
  }
  if (!existsSync(join(webDir, DIST_DIR, "BUILD_ID"))) {
    console.error("There is no staging build. Run bun run staging:build first.");
    return 1;
  }
  for (const service of SERVICES) {
    const pid = readPid(paths, service);
    if (pid !== null && isAlive(pid)) {
      console.error(`The ${service} is already running (pid ${pid}). Run staging:stop first.`);
      return 1;
    }
    if ((await probe(service)) !== null) {
      console.error(`Something already answers on port ${PORTS[service]}; staging will not start.`);
      return 1;
    }
  }
  nodeBinary();
  // The backend migrates the database when it opens it.
  const secret = writeEnvFile(paths);
  mkdirSync(paths.files, { recursive: true });
  for (const service of SERVICES) {
    const pid = launch(paths, service, secret);
    console.log(`${service} started, pid ${pid}, log ${paths.logFile(service)}`);
    const ready = await waitUntil(
      async () => (await probe(service)) === 200 || !isAlive(pid),
      START_TIMEOUT_MS,
    );
    if (!ready || !isAlive(pid) || (await probe(service)) !== 200) {
      console.error(
        `The ${service} did not come up. Last log lines:\n${tail(paths.logFile(service))}`,
      );
      for (const started of SERVICES) {
        const startedPid = readPid(paths, started);
        if (startedPid !== null) killTree(startedPid);
        removePid(paths, started);
      }
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
    // A PID file left by a crash or a reboot may name an unrelated process now: kill only one
    // whose port still answers.
    if ((await probe(service)) === null) {
      console.error(
        `${service}: pid ${pid} is running but port ${PORTS[service]} is closed, so it may not be ours. Not stopped; stop it by hand if it is, then remove ${paths.pidFile(service)}.`,
      );
      status = 1;
      continue;
    }
    killTree(pid);
    if (await waitUntil(() => !isAlive(pid), 15_000)) {
      removePid(paths, service);
      console.log(`${service}: stopped pid ${pid}.`);
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
