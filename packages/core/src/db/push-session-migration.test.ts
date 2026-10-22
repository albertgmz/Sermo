import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const PUSH_SESSION = journal.entries.findIndex((entry) => entry.tag.endsWith("_push_session"));

function applyMigrations(ctx: Ctx, from: number, to: number) {
  ctx.sqlite.transaction(() => {
    for (const entry of journal.entries.slice(from, to)) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    }
  })();
}

test("a subscription saved before the link keeps working, with no session", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  expect(PUSH_SESSION).toBeGreaterThan(0);
  applyMigrations(ctx, 0, PUSH_SESSION);
  ctx.sqlite.run(
    "INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES (1, 'a', 'a@example.test', 0, 1, 1)",
  );
  ctx.sqlite.run(
    "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (1, 'a', 'a', 2, 1)",
  );
  ctx.sqlite.run(
    "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (1, 'https://fcm.googleapis.com/old', 'p', 'a', 1)",
  );
  applyMigrations(ctx, PUSH_SESSION, PUSH_SESSION + 1);

  expect(
    ctx.sqlite
      .prepare<{ endpoint: string; session_id: number | null }, []>(
        "SELECT endpoint, session_id FROM push_subscriptions",
      )
      .all(),
  ).toEqual([{ endpoint: "https://fcm.googleapis.com/old", session_id: null }]);
  // The link deletes with its session, and a session's delete finds the subscription by an index.
  const link = ctx.sqlite
    .prepare<{ table: string; on_delete: string }, []>(
      "SELECT \"table\", on_delete FROM pragma_foreign_key_list('push_subscriptions')",
    )
    .all();
  expect(link).toContainEqual({ table: "auth_session", on_delete: "CASCADE" });
  const plan = ctx.sqlite
    .prepare<{ detail: string }, []>(
      "EXPLAIN QUERY PLAN SELECT id FROM push_subscriptions WHERE session_id = 5",
    )
    .all()
    .map((row) => row.detail)
    .join(" ");
  expect(plan).toContain("push_subscriptions_session");
});
