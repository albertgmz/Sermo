import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// The parts of the staging script that need no process or network: arguments, paths, the
// environment of each service, and the files that keep its state. scripts/staging.ts does the rest.

export const COMMANDS = ["build", "start", "stop", "status"] as const;
export type Command = (typeof COMMANDS)[number];

export const BACKEND_PORT = 4401;
export const WEB_PORT = 4400;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** Next's own output folder for staging, so `check:web` in the same checkout leaves it alone. */
export const DIST_DIR = ".next-staging";

export const SERVICES = ["backend", "web"] as const;
export type Service = (typeof SERVICES)[number];

export function defaultDatabase(env: Record<string, string | undefined> = process.env): string {
  const base = env.SERMO_BENCH_DIR ?? join(homedir(), ".cache", "sermo-bench");
  return join(base, "large", "sermo.db");
}

export function parseStagingArgs(
  argv: string[],
  defaultDb: string = defaultDatabase(),
): { command: Command; db: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { db: { type: "string" } },
    allowPositionals: true,
  });
  const [command, ...extra] = positionals;
  if (!COMMANDS.includes(command as Command) || extra.length > 0)
    throw new Error(`Usage: bun scripts/staging.ts <${COMMANDS.join("|")}> [--db <path>]`);
  if (values.db !== undefined && values.db === "") throw new Error("--db needs a path.");
  return { command: command as Command, db: resolve(values.db ?? defaultDb) };
}

export interface StagingPaths {
  db: string;
  /** The seed generator writes its meta next to the database. */
  meta: string;
  /** Everything staging keeps besides the database: files, env, PID files and logs. */
  state: string;
  files: string;
  envFile: string;
  pidFile(service: Service): string;
  logFile(service: Service): string;
}

export function stagingPaths(db: string): StagingPaths {
  const state = join(dirname(db), "staging");
  return {
    db,
    meta: `${db}.json`,
    state,
    files: join(state, "files"),
    envFile: join(state, "staging.env"),
    pidFile: (service) => join(state, `${service}.pid`),
    logFile: (service) => join(state, `${service}.log`),
  };
}

/** Variables that would change what a service does if they leaked in from the caller's shell. */
const OWN_NAMES = /^(SERMO_|BETTER_AUTH_|PORT$|NODE_ENV$)/;

export function cleanBase(base: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(base).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !OWN_NAMES.test(entry[0]),
    ),
  );
}

/** Read when the web app is built, and again when it starts (the output folder). */
export function webEnv(): Record<string, string> {
  return {
    SERMO_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    SERMO_PUBLIC_URL: WEB_ORIGIN,
    SERMO_DIST_DIR: DIST_DIR,
  };
}

/**
 * Sign-in is limited per visitor and every request through the web app reaches the backend from
 * one address, so the limits are high enough for a load test. Better Auth's own sign-in limit is
 * not configurable here.
 */
export function backendEnv(paths: StagingPaths, secret: string): Record<string, string> {
  return {
    PORT: String(BACKEND_PORT),
    SERMO_DB_PATH: paths.db,
    SERMO_FILES_DIR: paths.files,
    BETTER_AUTH_URL: WEB_ORIGIN,
    BETTER_AUTH_SECRET: secret,
    SERMO_SESSION_COOKIE_CACHE: "true",
    SERMO_RATE_LIMIT_READ: "1000000",
    SERMO_RATE_LIMIT_WRITE: "100000",
    SERMO_RATE_LIMIT_SEARCH: "100000",
    SERMO_RATE_LIMIT_MCP: "100000",
  };
}

export function stagingEnv(
  service: Service,
  paths: StagingPaths,
  secret: string,
  base: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return {
    ...cleanBase(base),
    ...(service === "backend" ? backendEnv(paths, secret) : webEnv()),
  };
}

export function formatEnvFile(values: Record<string, string>): string {
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
}

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#")) values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

/**
 * The secret is made once, the first time staging starts, and kept so sessions survive a restart.
 * The file is rewritten from the current settings each time, so it always shows what ran.
 */
export function writeEnvFile(paths: StagingPaths): string {
  mkdirSync(paths.state, { recursive: true });
  const kept = existsSync(paths.envFile)
    ? parseEnvFile(readFileSync(paths.envFile, "utf8")).BETTER_AUTH_SECRET
    : undefined;
  const secret = kept && kept.length >= 32 ? kept : randomBytes(32).toString("hex");
  writeFileSync(
    paths.envFile,
    formatEnvFile({ ...backendEnv(paths, secret), ...webEnv() }),
    "utf8",
  );
  return secret;
}

export function parsePid(text: string): number | null {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function readPid(paths: StagingPaths, service: Service): number | null {
  const file = paths.pidFile(service);
  return existsSync(file) ? parsePid(readFileSync(file, "utf8")) : null;
}

export function writePid(paths: StagingPaths, service: Service, pid: number): void {
  mkdirSync(paths.state, { recursive: true });
  writeFileSync(paths.pidFile(service), `${pid}\n`, "utf8");
}

export function removePid(paths: StagingPaths, service: Service): void {
  rmSync(paths.pidFile(service), { force: true });
}

export interface SignIn {
  password: string;
  adminId: number;
}

/** The seed generator's meta: the shared password and the administrator's member id. */
export function readSignIn(paths: StagingPaths): SignIn | null {
  if (!existsSync(paths.meta)) return null;
  const meta = JSON.parse(readFileSync(paths.meta, "utf8")) as Partial<SignIn>;
  return typeof meta.password === "string" && typeof meta.adminId === "number"
    ? { password: meta.password, adminId: meta.adminId }
    : null;
}

/** The seed gives member `n` the address `user<n>@example.test`. */
export function seedEmail(id: number): string {
  return `user${id}@example.test`;
}

export interface ServiceState {
  service: Service;
  port: number;
  pid: number | null;
  alive: boolean;
  answers: boolean;
}

export function formatStatus(states: ServiceState[]): string {
  return states
    .map(
      (s) =>
        `${s.service.padEnd(8)} port ${s.port}  pid ${s.pid ?? "-"}  ${
          s.pid === null ? "not started" : s.alive ? "running" : "not running"
        }  ${s.answers ? "answers 200" : "does not answer"}`,
    )
    .join("\n");
}

export interface Listener {
  port: number;
  pid: number;
}

/** The listening sockets in the output of `netstat -ano` (IPv4 and IPv6 lines). */
export function parseNetstat(text: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
    if (match) listeners.push({ port: Number(match[1]), pid: Number(match[2]) });
  }
  return listeners;
}

/** Strings that all appear in the command line of a process staging started. */
export function ownMarkers(
  service: Service,
  paths: StagingPaths,
  files: { server: string; next: string },
): string[] {
  return service === "backend"
    ? [files.server, paths.db]
    : [files.next, "start", "-p", String(WEB_PORT)];
}

export interface KillFacts {
  pid: number;
  alive: boolean;
  port: number;
  listeners: Listener[];
  /** Null when it could not be read. */
  commandLine: string | null;
  markers: string[];
}

/**
 * May `stop` kill this PID? Only when it is staging's: it listens on the staging port, or nothing
 * does yet (a start that has not opened its port, or one cut short) and its command line shows it
 * is staging's. Never by port alone, and never a process that listens elsewhere.
 */
export function killDecision(facts: KillFacts): { kill: boolean; reason: string } {
  const { pid, port, listeners } = facts;
  if (!facts.alive) return { kill: false, reason: "not running" };
  const owners = listeners.filter((listener) => listener.port === port);
  if (owners.some((listener) => listener.pid === pid))
    return { kill: true, reason: `listens on port ${port}` };
  if (owners.length > 0)
    return {
      kill: false,
      reason: `port ${port} belongs to pid ${owners[0]!.pid}, not to this one`,
    };
  if (listeners.some((listener) => listener.pid === pid))
    return { kill: false, reason: "listens on another port" };
  const line = facts.commandLine?.toLowerCase();
  if (line && facts.markers.every((marker) => line.includes(marker.toLowerCase())))
    return { kill: true, reason: "not listening yet and its command line is staging's" };
  return { kill: false, reason: "its command line is not staging's" };
}

/** Migrations of the journal newer than the newest one the database has applied. */
export function pendingMigrations(
  entries: { when: number; tag: string }[],
  lastApplied: number | null,
): string[] {
  return entries
    .filter((entry) => lastApplied === null || entry.when > lastApplied)
    .map((entry) => entry.tag);
}
