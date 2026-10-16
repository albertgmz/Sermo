import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  backendEnv,
  cleanBase,
  defaultDatabase,
  formatEnvFile,
  formatStatus,
  killDecision,
  ownMarkers,
  parseEnvFile,
  parseNetstat,
  parsePid,
  parseStagingArgs,
  pendingMigrations,
  readPid,
  readSignIn,
  removePid,
  seedEmail,
  stagingEnv,
  stagingPaths,
  webEnv,
  writeEnvFile,
  writePid,
} from "./staging-lib";

const scratch = mkdtempSync(join(tmpdir(), "sermo-staging-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const paths = () => stagingPaths(join(mkdtempSync(join(scratch, "db-")), "sermo.db"));

describe("arguments", () => {
  test("the database defaults to the large file", () => {
    expect(parseStagingArgs(["status"], "/x/large/sermo.db")).toEqual({
      command: "status",
      db: resolve("/x/large/sermo.db"),
    });
    expect(defaultDatabase({ SERMO_BENCH_DIR: "/bench" })).toBe(
      join("/bench", "large", "sermo.db"),
    );
  });

  test("--db replaces it, before or after the command", () => {
    expect(parseStagingArgs(["start", "--db", "/s/sermo.db"]).db).toBe(resolve("/s/sermo.db"));
    expect(parseStagingArgs(["--db", "/s/sermo.db", "stop"])).toEqual({
      command: "stop",
      db: resolve("/s/sermo.db"),
    });
  });

  test("refuses an unknown command, a missing one, extras and unknown options", () => {
    expect(() => parseStagingArgs([])).toThrow("Usage");
    expect(() => parseStagingArgs(["deploy"])).toThrow("Usage");
    expect(() => parseStagingArgs(["start", "stop"])).toThrow("Usage");
    expect(() => parseStagingArgs(["start", "--port", "1"])).toThrow();
    expect(() => parseStagingArgs(["start", "--db"])).toThrow();
    expect(() => parseStagingArgs(["start", "--db", ""])).toThrow("--db needs a path");
  });
});

describe("paths", () => {
  test("state lives next to the database", () => {
    const p = stagingPaths(join("/d", "large", "sermo.db"));
    expect(p.meta).toBe(join("/d", "large", "sermo.db.json"));
    expect(p.state).toBe(join("/d", "large", "staging"));
    expect(p.pidFile("web")).toBe(join("/d", "large", "staging", "web.pid"));
    expect(p.logFile("backend")).toBe(join("/d", "large", "staging", "backend.log"));
  });
});

describe("environment", () => {
  const p = stagingPaths(join("/d", "sermo.db"));
  const secret = "s".repeat(64);

  test("the backend gets its ports, database, public address and high limits", () => {
    const env = backendEnv(p, secret);
    expect(env.PORT).toBe("4401");
    expect(env.SERMO_DB_PATH).toBe(p.db);
    expect(env.SERMO_FILES_DIR).toBe(p.files);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:4400");
    expect(env.BETTER_AUTH_SECRET).toBe(secret);
    expect(env.SERMO_SESSION_COOKIE_CACHE).toBe("true");
    expect(Number(env.SERMO_RATE_LIMIT_READ)).toBeGreaterThan(3000);
    for (const bucket of ["WRITE", "SEARCH", "MCP"])
      expect(Number(env[`SERMO_RATE_LIMIT_${bucket}`])).toBeGreaterThan(300);
  });

  test("the web app reaches the staging backend and uses its own output folder", () => {
    expect(webEnv()).toEqual({
      SERMO_API_URL: "http://127.0.0.1:4401",
      SERMO_PUBLIC_URL: "http://localhost:4400",
      SERMO_DIST_DIR: ".next-staging",
    });
  });

  test("nothing of the live site's environment leaks in", () => {
    const base = {
      PATH: "/bin",
      PORT: "4201",
      SERMO_DB_PATH: "/live.db",
      BETTER_AUTH_URL: "https://live.example",
      NODE_ENV: "development",
      SERMO_API_URL: "http://127.0.0.1:4201",
      MISSING: undefined,
    };
    expect(cleanBase(base)).toEqual({ PATH: "/bin" });
    const backend = stagingEnv("backend", p, secret, base);
    expect(backend.PATH).toBe("/bin");
    expect(backend.PORT).toBe("4401");
    expect(backend.SERMO_DB_PATH).toBe(p.db);
    const web = stagingEnv("web", p, secret, base);
    expect(web.SERMO_API_URL).toBe("http://127.0.0.1:4401");
    expect(web.BETTER_AUTH_SECRET).toBeUndefined();
    expect(web.PORT).toBeUndefined();
  });

  test("an env file round-trips", () => {
    const values = { A: "1", B: "x=y" };
    expect(parseEnvFile(formatEnvFile(values))).toEqual(values);
    expect(parseEnvFile("# note\r\nA=1\r\n\r\nbad\r\n")).toEqual({ A: "1" });
  });

  test("the secret is made once and kept; the rest follows the settings", () => {
    const q = paths();
    const first = writeEnvFile(q);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(writeEnvFile(q)).toBe(first);
    const written = parseEnvFile(readFileSync(q.envFile, "utf8"));
    expect(written.BETTER_AUTH_SECRET).toBe(first);
    expect(written.SERMO_DB_PATH).toBe(q.db);
    writeFileSync(q.envFile, "BETTER_AUTH_SECRET=short\n");
    expect(writeEnvFile(q)).not.toBe("short");
    expect(writeEnvFile(paths())).not.toBe(first);
  });
});

describe("PID files", () => {
  test("parsePid takes a positive whole number and nothing else", () => {
    expect(parsePid("123\n")).toBe(123);
    for (const bad of ["", "abc", "0", "-4", "1.5", "12 13"]) expect(parsePid(bad)).toBeNull();
  });

  test("write, read and remove", () => {
    const q = paths();
    expect(readPid(q, "backend")).toBeNull();
    writePid(q, "backend", 4321);
    writePid(q, "web", 99);
    expect(readPid(q, "backend")).toBe(4321);
    expect(readPid(q, "web")).toBe(99);
    removePid(q, "backend");
    expect(existsSync(q.pidFile("backend"))).toBe(false);
    expect(readPid(q, "web")).toBe(99);
    removePid(q, "backend");
  });

  test("a damaged file reads as no PID", () => {
    const q = paths();
    writePid(q, "web", 1);
    writeFileSync(q.pidFile("web"), "garbage");
    expect(readPid(q, "web")).toBeNull();
  });
});

describe("sign-in and status", () => {
  test("the meta gives the password and the administrator's address", () => {
    const q = paths();
    expect(readSignIn(q)).toBeNull();
    writeFileSync(q.meta, JSON.stringify({ adminId: 7, password: "password", profile: "large" }));
    expect(readSignIn(q)).toEqual({ adminId: 7, password: "password" });
    expect(seedEmail(7)).toBe("user7@example.test");
    writeFileSync(q.meta, JSON.stringify({ adminId: 7 }));
    expect(readSignIn(q)).toBeNull();
  });

  test("status lines say what runs and what answers", () => {
    const text = formatStatus([
      { service: "backend", port: 4401, pid: 10, alive: true, answers: true },
      { service: "web", port: 4400, pid: null, alive: false, answers: false },
    ]);
    expect(text).toContain("backend  port 4401  pid 10  running  answers 200");
    expect(text).toContain("web      port 4400  pid -  not started  does not answer");
  });
});

describe("stop guard", () => {
  const NETSTAT = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:4200           0.0.0.0:0              LISTENING       1200",
    "  TCP    127.0.0.1:4401         0.0.0.0:0              LISTENING       80040",
    "  TCP    [::]:4400              [::]:0                 LISTENING       73292",
    "  TCP    127.0.0.1:4400         127.0.0.1:55486        ESTABLISHED     73292",
    "  TCP    127.0.0.1:49152        127.0.0.1:4400         TIME_WAIT       0",
  ].join("\r\n");

  test("netstat output gives the listening sockets only", () => {
    expect(parseNetstat(NETSTAT)).toEqual([
      { port: 4200, pid: 1200 },
      { port: 4401, pid: 80040 },
      { port: 4400, pid: 73292 },
    ]);
    expect(parseNetstat("")).toEqual([]);
  });

  const p = stagingPaths(join("/d", "sermo.db"));
  const files = {
    server: "/r/packages/api/src/server.ts",
    next: "/r/node_modules/next/dist/bin/next",
  };
  const base = {
    pid: 80040,
    alive: true,
    port: 4401,
    listeners: parseNetstat(NETSTAT),
    commandLine: null as string | null,
    markers: ownMarkers("backend", p, files),
  };

  test("the process that listens on the staging port is killed, whatever its command line", () => {
    expect(killDecision(base).kill).toBe(true);
  });

  test("a PID that is not running is left alone", () => {
    expect(killDecision({ ...base, alive: false }).kill).toBe(false);
  });

  test("a PID is never killed because of the port alone: another process owns it", () => {
    const decision = killDecision({
      ...base,
      pid: 555,
      commandLine: `bun ${files.server} ${p.db}`,
    });
    expect(decision.kill).toBe(false);
    expect(decision.reason).toContain("80040");
  });

  test("a PID that listens on another port is never killed", () => {
    // 1200 listens on 4200, the live test site; nothing listens on 4401.
    const listeners = parseNetstat(NETSTAT).filter((l) => l.port !== 4401);
    const decision = killDecision({
      ...base,
      pid: 1200,
      listeners,
      commandLine: `bun ${files.server} --staging-db ${p.db}`,
    });
    expect(decision).toEqual({ kill: false, reason: "listens on another port" });
  });

  test("with nothing listening, only a command line that shows staging's database counts", () => {
    const listeners = parseNetstat(NETSTAT).filter((l) => l.port !== 4401);
    const ours = `bun --preload x ${files.server} --staging-db ${p.db}`;
    expect(killDecision({ ...base, pid: 777, listeners, commandLine: ours }).kill).toBe(true);
    expect(
      killDecision({ ...base, pid: 777, listeners, commandLine: ours.toUpperCase() }).kill,
    ).toBe(true);
    // The live backend runs the same script on its own database.
    const live = `bun ${files.server}`;
    expect(killDecision({ ...base, pid: 777, listeners, commandLine: live }).kill).toBe(false);
    expect(killDecision({ ...base, pid: 777, listeners, commandLine: null }).kill).toBe(false);
  });

  test("the web app is told apart by its program and its staging port", () => {
    const web = {
      ...base,
      pid: 31,
      port: 4400,
      listeners: [],
      markers: ownMarkers("web", p, files),
    };
    expect(
      killDecision({ ...web, commandLine: `node ${files.next} start -p 4400 -H localhost` }).kill,
    ).toBe(true);
    expect(killDecision({ ...web, commandLine: `node ${files.next} start -p 4200` }).kill).toBe(
      false,
    );
    expect(killDecision({ ...web, commandLine: "node other.js start -p 4400" }).kill).toBe(false);
  });
});

describe("pending migrations", () => {
  const entries = [
    { when: 10, tag: "0000_a" },
    { when: 20, tag: "0001_b" },
    { when: 30, tag: "0002_c" },
  ];

  test("those newer than the last one applied", () => {
    expect(pendingMigrations(entries, 20)).toEqual(["0002_c"]);
    expect(pendingMigrations(entries, 30)).toEqual([]);
    expect(pendingMigrations(entries, null)).toEqual(["0000_a", "0001_b", "0002_c"]);
  });
});
