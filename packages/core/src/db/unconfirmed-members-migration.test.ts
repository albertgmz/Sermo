import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { insertUser } from "@sermo/core/testing";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { GROUP_IDS } from "./schema";

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

/**
 * A database at migration 0085 with the stored configuration given (none when undefined) and four
 * unconfirmed accounts: a plain one, one that waits for its username, an erased one, and a member.
 */
function before(stored?: object) {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 85);
  if (stored !== undefined)
    ctx.sqlite.run(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 1)",
      [JSON.stringify(stored)],
    );
  const plain = insertUser(ctx, { username: "Plain", groupId: GROUP_IDS.unconfirmed });
  const naming = insertUser(ctx, { username: "Naming", groupId: GROUP_IDS.unconfirmed });
  ctx.sqlite.run("UPDATE users SET needs_username = 1 WHERE id = ?1", [naming.id]);
  const erased = insertUser(ctx, { username: "Erased", groupId: GROUP_IDS.unconfirmed });
  ctx.sqlite.run("UPDATE users SET erased_at = 1 WHERE id = ?1", [erased.id]);
  const member = insertUser(ctx, { username: "Member", groupId: GROUP_IDS.member });
  return { ctx, plain, naming, erased, member };
}

const groupsOf = (ctx: Ctx) =>
  ctx.sqlite
    .query<{ username: string; group_id: number }, []>(
      "SELECT username, group_id FROM users WHERE username IN ('Plain', 'Naming', 'Erased', 'Member') ORDER BY username",
    )
    .all();

const combination = (ctx: Ctx, id: number) =>
  ctx.sqlite
    .query<{ permission_combination_id: number }, [number]>(
      "SELECT permission_combination_id FROM users WHERE id = ?1",
    )
    .get(id)!.permission_combination_id;

const UNCHANGED = [
  { username: "Erased", group_id: GROUP_IDS.unconfirmed },
  { username: "Member", group_id: GROUP_IDS.member },
  { username: "Naming", group_id: GROUP_IDS.unconfirmed },
  { username: "Plain", group_id: GROUP_IDS.unconfirmed },
];

test("migration 0086 moves unconfirmed members to Member while the site asks no email confirmation", () => {
  const { ctx, plain, member } = before({ siteName: "Mi sitio", requireEmailConfirmation: false });
  applyMigrations(ctx, 86, 86);
  expect(groupsOf(ctx)).toEqual([
    { username: "Erased", group_id: GROUP_IDS.unconfirmed },
    { username: "Member", group_id: GROUP_IDS.member },
    { username: "Naming", group_id: GROUP_IDS.unconfirmed },
    { username: "Plain", group_id: GROUP_IDS.member },
  ]);
  // The member's permissions follow the new group.
  expect(combination(ctx, plain.id)).toBe(combination(ctx, member.id));
});

test("migration 0086 changes nothing while the site asks for email confirmation", () => {
  const { ctx } = before({ siteName: "Mi sitio", requireEmailConfirmation: true });
  applyMigrations(ctx, 86, 86);
  expect(groupsOf(ctx)).toEqual(UNCHANGED);
});

test("migration 0086 changes nothing when the setting is not stored (it is on by default)", () => {
  const { ctx } = before({ siteName: "Mi sitio" });
  applyMigrations(ctx, 86, 86);
  expect(groupsOf(ctx)).toEqual(UNCHANGED);
  const { ctx: bare } = before();
  applyMigrations(bare, 86, 86);
  expect(groupsOf(bare)).toEqual(UNCHANGED);
});

test("migration 0086 run twice gives the same result as once", () => {
  const { ctx } = before({ requireEmailConfirmation: false });
  applyMigrations(ctx, 86, 86);
  const once = groupsOf(ctx);
  applyMigrations(ctx, 86, 86);
  expect(groupsOf(ctx)).toEqual(once);
  expect(once.find((row) => row.username === "Plain")!.group_id).toBe(GROUP_IDS.member);
});
