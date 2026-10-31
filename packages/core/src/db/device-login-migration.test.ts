import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { insertUser } from "@sermo/core/testing";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function applyMigrations(ctx: Ctx, from: number, through: number) {
  ctx.sqlite.transaction(() => {
    for (const entry of journal.entries.filter(
      (entry) => entry.idx >= from && entry.idx <= through,
    )) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    }
  })();
}

test("migration 0090 keeps every existing session a browser session and adds the device codes", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 89);
  const member = insertUser(ctx, { username: "Ada" });
  ctx.sqlite.run(
    "INSERT INTO auth_session (token, user_id, expires_at, created_at, updated_at, user_agent) VALUES ('old-token', ?1, 9999999999999, 1, 1, 'Firefox')",
    [member.id],
  );
  applyMigrations(ctx, 90, 90);
  expect(
    ctx.sqlite.query("SELECT token, user_id, user_agent, terminal_client FROM auth_session").all(),
  ).toEqual([
    { token: "old-token", user_id: member.id, user_agent: "Firefox", terminal_client: null },
  ]);
  expect(ctx.sqlite.query("SELECT count(*) AS n FROM auth_device_code").get()).toEqual({ n: 0 });
});

test("migration 0090 makes a change of a group's staff mark reload the permissions", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 90);
  const version = () =>
    ctx.sqlite
      .query<{ version: number }, []>(
        "SELECT version FROM cache_versions WHERE key = 'permissions'",
      )
      .get()?.version ?? 0;
  const before = version();
  ctx.sqlite.run("UPDATE groups SET is_staff = 1 WHERE id = 2");
  expect(version()).toBe(before + 1);
});
