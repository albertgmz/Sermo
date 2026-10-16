import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeContext, createContext } from "../context";
import { writeTx } from "./tx";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs `fn` and returns the `[db.write-wait]` lines it logged. */
function logged(fn: () => void): string[] {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = warn;
  }
  return lines.filter((line) => line.startsWith("[db.write-wait]"));
}

test("writeTx logs a wait for the write lock another connection holds, and only then", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sermo-test-"));
  tempDirs.push(dir);
  const path = join(dir, "test.db");
  const ctx = createContext({ path });
  ctx.sqlite.run("CREATE TABLE t (n INTEGER)");

  expect(logged(() => writeTx(ctx, () => ctx.sqlite.run("INSERT INTO t VALUES (1)")))).toEqual([]);

  // A second process takes the write lock for 250 ms: this thread cannot hold it for a test.
  const holder = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const { Database } = require("bun:sqlite");
       const db = new Database(process.argv[1]);
       db.run("BEGIN IMMEDIATE");
       console.log("held");
       setTimeout(() => { db.run("COMMIT"); db.close(); }, 250);`,
      path,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const reader = holder.stdout.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("held");

  const lines = logged(() => writeTx(ctx, () => ctx.sqlite.run("INSERT INTO t VALUES (2)")));
  expect(lines).toHaveLength(1);
  const [, wait, hold] = /wait=(\d+) hold=(\d+)/.exec(lines[0] ?? "") ?? [];
  expect(Number(wait)).toBeGreaterThanOrEqual(100);
  expect(Number(hold)).toBeLessThan(100);
  expect(ctx.sqlite.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });

  await holder.exited;
  closeContext(ctx);
});
