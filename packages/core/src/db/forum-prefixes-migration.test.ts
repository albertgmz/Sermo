import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { insertNode, insertUser } from "../testing";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const TAG = "forum_prefixes";
const index = journal.entries.find((entry) => entry.tag.endsWith(TAG))!.idx;

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

test("the migration lets every forum offer every prefix, so nothing changes on the day, and changes no thread", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, index - 1);
  const author = insertUser(ctx);
  const news = insertNode(ctx, { title: "News" });
  const chat = insertNode(ctx, { title: "Chat" });
  const quiet = insertNode(ctx, { title: "Quiet" });
  const category = insertNode(ctx, { title: "Category", type: "category" });
  const color = ctx.sqlite
    .prepare<{ id: number }, []>("SELECT id FROM palette_colors WHERE kind = 'prefix' LIMIT 1")
    .get()!.id;
  const prefix = (label: string, active: number) =>
    ctx.sqlite
      .prepare<{ id: number }, [string, number, number]>(
        "INSERT INTO thread_prefixes (label, color_id, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 1) RETURNING id",
      )
      .get(label, color, active)!.id;
  const alert = prefix("Alert", 1);
  const solved = prefix("Solved", 1);
  const retired = prefix("Retired", 0);
  const unused = prefix("Unused", 1);
  const thread = (nodeId: number, prefixId: number | null) =>
    ctx.sqlite
      .prepare<{ id: number }, [number, number, number | null]>(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id, prefix_id) VALUES (?1, ?2, 'T', 1, 1, ?2, ?3) RETURNING id",
      )
      .get(nodeId, author.id, prefixId)!.id;
  const carriers = [
    thread(news.id, alert),
    thread(news.id, alert),
    thread(news.id, solved),
    thread(news.id, null),
    thread(chat.id, retired),
    thread(chat.id, alert),
    thread(quiet.id, null),
  ];
  const before = ctx.sqlite
    .prepare<{ id: number; prefix_id: number | null; node_id: number }, []>(
      "SELECT id, prefix_id, node_id FROM threads ORDER BY id",
    )
    .all();

  applyMigrations(ctx, index, index);

  const offered = ctx.sqlite
    .prepare<{ node_id: number; prefix_id: number }, []>(
      "SELECT node_id, prefix_id FROM forum_prefixes ORDER BY node_id, prefix_id",
    )
    .all();
  const forums = [news.id, chat.id, quiet.id];
  const prefixes = [alert, solved, retired, unused];
  expect(offered).toEqual(
    forums.flatMap((node_id) => prefixes.map((prefix_id) => ({ node_id, prefix_id }))),
  );
  expect(offered.some((row) => row.node_id === category.id)).toBe(false);
  // Nothing requires a prefix, and no thread was touched.
  expect(ctx.sqlite.prepare("SELECT 1 FROM nodes WHERE require_prefix <> 0").get()).toBeNull();
  expect(
    ctx.sqlite
      .prepare<{ id: number; prefix_id: number | null; node_id: number }, []>(
        "SELECT id, prefix_id, node_id FROM threads ORDER BY id",
      )
      .all(),
  ).toEqual(before);
  expect(carriers).toHaveLength(before.length);
});
