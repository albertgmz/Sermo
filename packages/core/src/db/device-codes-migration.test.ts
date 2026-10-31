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

/** A database at migration 0086 with a member whose device was kept before the codes, and a finished walk. */
function before() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 86);
  const member = insertUser(ctx, { username: "Ada" });
  ctx.sqlite.run(
    "UPDATE users SET device_type = 'phone', device_os = 'Android', device_browser = 'Chrome' WHERE id = ?1",
    [member.id],
  );
  ctx.sqlite.run(
    "INSERT INTO site_settings (key, value, updated_at) VALUES ('security.deviceBackfill', '{\"done\":true}', 1), ('other', '1', 1)",
  );
  return { ctx, member };
}

test("migration 0087 shows the device of every existing member and keeps what was stored", () => {
  const { ctx, member } = before();
  applyMigrations(ctx, 87, 87);
  expect(
    ctx.sqlite
      .query(
        "SELECT show_device, device_type, device_os, device_browser, device_type_name, device_os_code, device_browser_code, device_brand_code FROM users WHERE id = ?1",
      )
      .get(member.id),
  ).toEqual({
    show_device: 1,
    device_type: "phone",
    device_os: "Android",
    device_browser: "Chrome",
    device_type_name: null,
    device_os_code: null,
    device_browser_code: null,
    device_brand_code: null,
  });
});

test("migration 0087 deletes the record of the finished walk, so the walk runs again, and no other setting", () => {
  const { ctx } = before();
  applyMigrations(ctx, 87, 87);
  expect(
    ctx.sqlite.query<{ key: string }, []>("SELECT key FROM site_settings ORDER BY key").all(),
  ).toEqual([{ key: "other" }]);
});
