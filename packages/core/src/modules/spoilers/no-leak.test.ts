import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { renderPlainText } from "../../render";
import { conversationsCreateOp } from "../conversations";
import { nodesCreateOp, postsCreateOp, threadsCreateOp } from "../forums";
import { profilePostsCreateOp } from "../profiles";
import { searchQueryOp } from "../search";
import { atomFeed } from "../seo";

// Every form: BB code block and inline, the Markdown container and the inline marker.
const BODY =
  "needle visible [SPOILER=Why]secret one[/SPOILER] [ISPOILER]secret two[/ISPOILER]\n" +
  ":::spoiler\nsecret three\n:::\n>!secret four!<";

// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
const call = (ctx: any, name: string, actor: object, input: object = {}): Promise<any> =>
  execute(ctx, getOperation(name), actor as never, input);

async function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = userActor(insertUser(ctx));
  const forum = await execute(ctx, nodesCreateOp, admin, {
    parentId: null,
    type: "forum",
    title: "Forum",
  });
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: forum.id,
    title: "Topic",
    body: BODY,
  });
  return { ctx, admin, author, forum, thread };
}

function expectMasked(text: string): void {
  expect(text).not.toMatch(/secret|Why/);
  expect(text).toContain("[spoiler]");
}

describe("spoiler text stays out of every plain-text path", () => {
  test("the stored thread excerpt", async () => {
    const w = await world();
    const stored = w.ctx.sqlite
      .prepare<{ excerpt: string }, [number]>("SELECT excerpt FROM threads WHERE id = ?1")
      .get(w.thread.thread.id)!.excerpt;
    expectMasked(stored);
    expect(stored).toContain("needle visible");
  });

  test("the thread excerpt after the first post is edited", async () => {
    const w = await world();
    await call(w.ctx, "posts.update", w.author, {
      postId: w.thread.post.id,
      body: "edited [SPOILER]secret five[/SPOILER] words",
    });
    const stored = w.ctx.sqlite
      .prepare<{ excerpt: string }, [number]>("SELECT excerpt FROM threads WHERE id = ?1")
      .get(w.thread.thread.id)!.excerpt;
    expectMasked(stored);
  });

  test("search snippets", async () => {
    const w = await world();
    const reply = await execute(w.ctx, postsCreateOp, w.author, {
      threadId: w.thread.thread.id,
      body: "needle reply [ISPOILER]secret six[/ISPOILER] after",
    });
    const result = await execute(w.ctx, searchQueryOp, w.author, { q: "needle" });
    expect(result.items.length).toBeGreaterThan(1);
    for (const item of result.items) expectMasked(item.post.excerpt);
    expect(result.items.find((item) => item.post.id === reply.id)?.post.excerpt).toContain("after");
  });

  test("the moderation queue", async () => {
    const w = await world();
    const reply = await execute(w.ctx, postsCreateOp, w.author, {
      threadId: w.thread.thread.id,
      body: BODY,
    });
    const reporter = userActor(insertUser(w.ctx));
    await call(w.ctx, "reports.create", reporter, {
      target: { type: "post", id: reply.id },
      reason: "Bad",
    });
    const items = (await call(w.ctx, "reports.list", w.admin)).items as { excerpt: string }[];
    expect(items).toHaveLength(1);
    expectMasked(items[0]!.excerpt);
  });

  test("the Atom feed", async () => {
    const w = await world();
    const feed = atomFeed(w.ctx, "https://forum.example.test", "Forum");
    expect(feed).toContain("needle visible");
    expectMasked(feed.replace(/<[^>]*>/g, " "));
  });

  test("the thread page data for search engines", async () => {
    const w = await world();
    await execute(w.ctx, postsCreateOp, w.author, {
      threadId: w.thread.thread.id,
      body: "reply [SPOILER]secret seven[/SPOILER]",
    });
    const page = await call(w.ctx, "seo.thread", GUEST, { threadId: w.thread.thread.id });
    const json = JSON.stringify(page);
    expect(json).toContain("needle visible");
    expect(json).not.toMatch(/secret|Why/);
    expect(json).toContain("[spoiler]");
  });

  test("emails, push messages and alert phrases built from the stored HTML", async () => {
    const w = await world();
    const recipient = insertUser(w.ctx);
    const made = await execute(w.ctx, conversationsCreateOp, w.author, {
      title: "Private",
      recipientIds: [recipient.id],
      body: BODY,
    });
    const wall = await execute(w.ctx, profilePostsCreateOp, w.author, {
      userId: recipient.id,
      body: BODY,
    });
    const html = [
      w.ctx.sqlite
        .prepare<{ body_html: string }, [number]>(
          "SELECT body_html FROM conversation_messages WHERE id = ?1",
        )
        .get(made.message.id)!.body_html,
      w.ctx.sqlite
        .prepare<{ body_html: string }, [number]>(
          "SELECT body_html FROM profile_posts WHERE id = ?1",
        )
        .get(wall.id)!.body_html,
      w.ctx.sqlite
        .prepare<{ body_html: string }, [number]>(
          "SELECT body_html FROM post_bodies WHERE post_id = ?1",
        )
        .get(w.thread.post.id)!.body_html,
    ];
    for (const body of html) {
      expectMasked(renderPlainText(body));
      expectMasked(renderPlainText(body, 180));
      expect(renderPlainText(body)).toContain("needle visible");
    }
  });
});
