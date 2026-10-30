import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

function before(stored?: string) {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 81);
  if (stored !== undefined)
    ctx.sqlite.run(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 1)",
      [stored],
    );
  return ctx;
}

const configuration = (ctx: Ctx) =>
  ctx.sqlite
    .query<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'configuration'")
    .get()?.value;

test("migration 0082 sets a stored English default language to Spanish and keeps every other setting", () => {
  const stored = JSON.stringify({ siteName: "Mi sitio", defaultLanguage: "en", newMemberDays: 7 });
  const ctx = before(stored);
  applyMigrations(ctx, 82, 82);
  expect(JSON.parse(configuration(ctx) as string)).toEqual({
    siteName: "Mi sitio",
    defaultLanguage: "es",
    newMemberDays: 7,
  });
});

test("migration 0082 leaves a configuration that has no stored default language as it is", () => {
  const stored = JSON.stringify({ siteName: "Mi sitio" });
  const ctx = before(stored);
  applyMigrations(ctx, 82, 82);
  expect(configuration(ctx)).toBe(stored);
});

test("migration 0082 leaves other settings rows and a missing configuration alone", () => {
  const ctx = before();
  ctx.sqlite.run(
    "INSERT INTO site_settings (key, value, updated_at) VALUES ('other', '{\"defaultLanguage\":\"en\"}', 1)",
  );
  applyMigrations(ctx, 82, 82);
  expect(configuration(ctx)).toBeUndefined();
  expect(
    ctx.sqlite
      .query<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'other'")
      .get()?.value,
  ).toBe('{"defaultLanguage":"en"}');
});
