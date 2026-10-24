import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { LEGACY_POST_QUOTE } from "../../bbcode/legacy-quotes";
import { execute } from "../../operation";
import { conversationsCreateOp } from "../conversations";
import { nodesCreateOp, postsCreateOp, threadsCreateOp } from "../forums";
import { profileCommentsCreateOp, profilePostsCreateOp } from "../profiles";
import { registerJobHandlers, runDueJobs, startScheduler } from "./index";
import {
  QUOTE_HEADERS_CHUNK,
  QUOTE_HEADERS_JOB,
  quoteHeaderWindowSql,
  scheduleQuoteHeaders,
} from "./quote-headers";

/** A quote of a post as the renderer stored it before: "<author> wrote:" in English. */
const legacy = (html: string) =>
  html.replace(
    /<blockquote class="bb-quote quote" data-post-id="(\d+)"><cite class="bb-quote-author">(.*?)<\/cite>/g,
    '<blockquote class="quote" data-post-id="$1"><cite>$2 wrote:</cite>',
  );

const TEXTS = [
  ["post_bodies", "post_id", "body_html"],
  ["post_revisions", "id", "body_html"],
  ["conversation_messages", "id", "body_html"],
  ["profile_posts", "id", "body_html"],
  ["profile_post_comments", "id", "body_html"],
  ["content_spoilers", "id", "html"],
] as const;

type Ctx = ReturnType<typeof createTestContext>;

function stored(ctx: Ctx): Map<string, string> {
  const all = new Map<string, string>();
  for (const [table, id, html] of TEXTS)
    for (const row of ctx.sqlite
      .prepare<{ id: number; html: string }, []>(
        `SELECT ${id} AS id, ${html} AS html FROM ${table}`,
      )
      .all())
      all.set(`${table}:${row.id}`, row.html);
  return all;
}

function age(ctx: Ctx): void {
  for (const [table, id, html] of TEXTS)
    for (const row of ctx.sqlite
      .prepare<{ id: number; html: string }, []>(
        `SELECT ${id} AS id, ${html} AS html FROM ${table}`,
      )
      .all())
      ctx.sqlite
        .prepare(`UPDATE ${table} SET ${html} = ?1 WHERE ${id} = ?2`)
        .run(legacy(row.html), row.id);
}

const pending = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM jobs WHERE type = ?1 AND status IN ('pending', 'running')",
    )
    .get(QUOTE_HEADERS_JOB)!.n;

/** Runs the walk to its end, moving the clock past each pause between chunks. */
async function finish(ctx: Ctx): Promise<number> {
  let chunks = 0;
  for (; pending(ctx) > 0 && chunks < 100; chunks++) {
    ctx.clock.advance(1_000);
    await runDueJobs(ctx, { limit: 1 });
  }
  return chunks;
}

async function world() {
  const ctx = createTestContext();
  registerJobHandlers(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const aliceUser = insertUser(ctx, { username: "Alice" });
  const alice = userActor(aliceUser);
  const bobUser = insertUser(ctx, { username: "Bob" });
  const bob = userActor(bobUser);
  const forum = await execute(ctx, nodesCreateOp, admin, {
    parentId: null,
    type: "forum",
    title: "Forum",
  });
  const thread = await execute(ctx, threadsCreateOp, alice, {
    nodeId: forum.id,
    title: "Topic",
    body: "Original wrote: words",
  });
  const quote = `[QUOTE="post: ${thread.post.id}"]Original[/QUOTE]`;
  const reply = await execute(ctx, postsCreateOp, bob, {
    threadId: thread.thread.id,
    body: `${quote}\n\nAgreed.\n\n[SPOILER]${quote}[/SPOILER]\n\n[URL=https://a.example]${quote}[/URL]`,
  });
  await execute(ctx, conversationsCreateOp, bob, {
    title: "Private",
    recipientIds: [aliceUser.id],
    body: `${quote}\n\nSee this.`,
  });
  const wall = await execute(ctx, profilePostsCreateOp, bob, { userId: aliceUser.id, body: quote });
  await execute(ctx, profileCommentsCreateOp, alice, { profilePostId: wall.id, body: quote });
  const html = ctx.sqlite
    .prepare<{ body_html: string }, [number]>(
      "SELECT body_html FROM post_bodies WHERE post_id = ?1",
    )
    .get(reply.id)!.body_html;
  ctx.sqlite
    .prepare(
      "INSERT INTO post_revisions (post_id, editor_id, body_source, body_html, edited_at) VALUES (?1, ?2, ?3, ?4, 1)",
    )
    .run(reply.id, bobUser.id, quote, html);
  return ctx;
}

describe("quote headers of stored texts", () => {
  test("every stored quote of a post gets the header a render writes now, and the rest stays", async () => {
    const ctx = await world();
    const current = stored(ctx);
    const quoting = [...current].filter(([, html]) => html.includes('class="bb-quote quote"'));
    // Each kind of stored text holds a quote: post, revision, message, wall post, comment, spoiler.
    expect(new Set(quoting.map(([key]) => key.split(":")[0]))).toEqual(
      new Set(TEXTS.map(([table]) => table)),
    );
    age(ctx);
    expect([...stored(ctx).values()].join("")).toContain(" wrote:</cite>");
    // The server's start queues the walk.
    startScheduler(ctx)();
    expect(pending(ctx)).toBe(1);
    await finish(ctx);
    expect(stored(ctx)).toEqual(current);
    expect([...stored(ctx).values()].join("")).not.toContain(" wrote:</cite>");
    // A finished walk is never queued again.
    scheduleQuoteHeaders(ctx);
    expect(pending(ctx)).toBe(0);
  });

  test("a stopped walk goes on from where it was, window by window", async () => {
    const ctx = createTestContext();
    registerJobHandlers(ctx);
    const old = (id: number) =>
      `<blockquote class="quote" data-post-id="${id}"><cite><a href="/posts/${id}" rel="nofollow ugc noopener">A&amp;B</a> wrote:</cite>x</blockquote>`;
    const insert = ctx.sqlite.prepare(
      "INSERT INTO content_spoilers (content_type, content_id, position, html) VALUES ('post', ?1, 0, ?2)",
    );
    const rows = QUOTE_HEADERS_CHUNK + 5;
    for (let id = 1; id <= rows; id++) insert.run(id, id === 2 ? "<p>plain</p>" : old(id));
    const htmlOf = (id: number) =>
      ctx.sqlite
        .prepare<{ html: string }, [number]>(
          "SELECT html FROM content_spoilers WHERE content_id = ?1",
        )
        .get(id)!.html;
    scheduleQuoteHeaders(ctx);
    // The empty tables before, then the first window of spoilers.
    for (let chunk = 0; chunk < TEXTS.length; chunk++) {
      ctx.clock.advance(1_000);
      await runDueJobs(ctx, { limit: 1 });
    }
    expect(htmlOf(QUOTE_HEADERS_CHUNK)).toBe(
      `<blockquote class="bb-quote quote" data-post-id="${QUOTE_HEADERS_CHUNK}"><cite class="bb-quote-author"><a href="/posts/${QUOTE_HEADERS_CHUNK}" rel="nofollow ugc noopener">A&amp;B</a></cite>x</blockquote>`,
    );
    expect(htmlOf(QUOTE_HEADERS_CHUNK + 1)).toStartWith(LEGACY_POST_QUOTE);
    expect(htmlOf(2)).toBe("<p>plain</p>");
    // The server stops; the queued chunk is lost with it. The next start goes on.
    ctx.sqlite.prepare("DELETE FROM jobs WHERE type = ?1").run(QUOTE_HEADERS_JOB);
    scheduleQuoteHeaders(ctx);
    expect(await finish(ctx)).toBe(1);
    expect(htmlOf(rows)).not.toContain("wrote");
  });

  test("each window is read through its table's key", () => {
    const ctx = createTestContext();
    TEXTS.forEach((_, stage) => {
      expectNoTableScan(ctx, quoteHeaderWindowSql(stage), [LEGACY_POST_QUOTE, 0, 1_000]);
    });
  });
});
