import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ValidationError } from "./errors";
import { nodesCreateOp, postsUpdateOp, threadsCreateOp } from "./modules/forums";
import { readSiteSettings } from "./modules/settings";
import { execute } from "./operation";
import { MAX_BODY_LENGTH, renderContent, renderMarkdown } from "./render";

/** Returns what the function throws without echoing a large returned value on failure. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("canonical source length", () => {
  test("attribution inserted into quotes cannot push the stored source past the limit", async () => {
    const ctx = createTestContext();
    const author = insertUser(ctx, { username: "a".repeat(32) });
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, userActor(author), {
      nodeId: forum.id,
      title: "Topic",
      body: "Original",
    });
    const other = userActor(insertUser(ctx));
    const quote = `:::quote{post=${thread.post.id}}\nx\n:::\n`;
    const body = quote.repeat(Math.floor(6900 / quote.length));
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(thrown(() => renderContent(ctx, other, body))).toBeInstanceOf(ValidationError);
    // A body whose canonical form still fits is stored as before.
    const small = renderContent(ctx, other, quote.repeat(20));
    expect(small.source.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
  });
});

describe("mention limit on edit", () => {
  test("mentions already in the content survive a lowered limit; only new ones are limited", async () => {
    const ctx = createTestContext();
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    // Not a new member, so the permission (10) is the only limit while the post is created.
    ctx.sqlite.prepare("UPDATE users SET created_at = 0 WHERE id = ?1").run(authorUser.id);
    const targets = Array.from({ length: 5 }, (_, i) =>
      insertUser(ctx, { username: `Target${i}` }),
    );
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const mentions = (names: number[]) => names.map((i) => `@${targets[i]!.username}`).join(" ");
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Topic",
      body: mentions([0, 1, 2, 3]),
    });
    const stored = () =>
      ctx.sqlite
        .prepare<{ user_id: number }, [number]>(
          "SELECT user_id FROM content_mentions WHERE content_type = 'post' AND content_id = ?1 ORDER BY user_id",
        )
        .all(thread.post.id)
        .map((row) => row.user_id);
    expect(stored()).toEqual(targets.slice(0, 4).map((t) => t.id));

    // The author becomes subject to a limit of one mention per item.
    ctx.sqlite
      .prepare("UPDATE users SET created_at = ?1 WHERE id = ?2")
      .run(ctx.now(), authorUser.id);
    ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify({ ...readSiteSettings(ctx), newMemberMentionLimit: 1 }));
    await execute(ctx, postsUpdateOp, author, {
      postId: thread.post.id,
      body: `${mentions([0, 1, 2, 3])} and some plain text`,
    });
    expect(stored()).toEqual(targets.slice(0, 4).map((t) => t.id));

    // A new mention is refused because the allowance is already used up.
    await execute(ctx, postsUpdateOp, author, {
      postId: thread.post.id,
      body: `${mentions([0, 1, 2, 3, 4])} and some plain text`,
    });
    expect(stored()).toEqual(targets.slice(0, 4).map((t) => t.id));
  });
});

describe("container depth", () => {
  test("spoilers nested through lists count toward the depth limit like quotes", () => {
    let content = "text";
    for (let i = 0; i < 40; i++) content = `:::spoiler\n- ${content.split("\n").join("\n  ")}\n:::`;
    expect(content.length).toBeLessThan(MAX_BODY_LENGTH);
    expect(thrown(() => renderMarkdown(content))).toBeInstanceOf(ValidationError);

    let shallow = "text";
    for (let i = 0; i < 5; i++) shallow = `:::spoiler\n- ${shallow.split("\n").join("\n  ")}\n:::`;
    expect(renderMarkdown(shallow)).toContain("<details");
  });
});
