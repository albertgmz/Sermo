import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { writeTx } from "./db/tx";
import { ValidationError } from "./errors";
import { nodesCreateOp, postsCreateOp, postsUpdateOp, threadsCreateOp } from "./modules/forums";
import { readSiteSettings } from "./modules/settings";
import { execute } from "./operation";
import { MAX_BODY_LENGTH, renderContent, renderMarkdown, storeContentReferences } from "./render";

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
  test("an unchanged maximum-length quote remains editable after its author is renamed", async () => {
    const ctx = createTestContext();
    const quotedUser = insertUser(ctx, { username: "Alice" });
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, userActor(quotedUser), {
      nodeId: forum.id,
      title: "Topic",
      body: "Original",
    });
    const quote = `:::quote{post=${thread.post.id} author="Alice"}\nx\n:::\n`;
    const body = quote + "x".repeat(MAX_BODY_LENGTH - quote.length);
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body,
    });
    const storedBody = () =>
      ctx.sqlite
        .prepare<{ body_source: string; body_html: string }, [number]>(
          "SELECT body_source, body_html FROM post_bodies WHERE post_id = ?1",
        )
        .get(reply.id)!;
    expect(storedBody().body_source).toHaveLength(MAX_BODY_LENGTH);
    const renamed = "Renamed".repeat(4);
    ctx.sqlite
      .prepare("UPDATE users SET username = ?1, username_key = ?2 WHERE id = ?3")
      .run(renamed, renamed.toLowerCase(), quotedUser.id);
    await execute(ctx, postsUpdateOp, author, { postId: reply.id, body });
    expect(storedBody().body_source).toBe(body);
    expect(storedBody().body_html).toContain("Alice</a> wrote:");
    const options = {
      edit: { contentType: "post" as const, contentId: reply.id, authorId: authorUser.id },
    };
    expect(thrown(() => renderContent(ctx, author, `${body}x`, options))).toBeInstanceOf(
      ValidationError,
    );
    const fresh = renderContent(ctx, author, quote);
    expect(fresh.source).toContain(`author="${renamed}"`);
    expect(fresh.html).toContain(`${renamed}</a> wrote:`);

    // Neither deleting nor forging an attribution can change a saved quote's label.
    for (const attributes of ["", ' author="Forged"']) {
      const edited = renderContent(
        ctx,
        author,
        `:::quote{post=${thread.post.id}${attributes}}\nchanged\n:::`,
        options,
      );
      expect(edited.source).toContain('author="Alice"');
      expect(edited.html).toContain("Alice</a> wrote:");
    }
  });

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

  test("nested saved quotes retain attribution while a newly added post uses the current name", async () => {
    const ctx = createTestContext();
    const quotedUser = insertUser(ctx, { username: "Alice" });
    const quotedActor = userActor(quotedUser);
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, quotedActor, {
      nodeId: forum.id,
      title: "Topic",
      body: "Original",
    });
    const newer = await execute(ctx, postsCreateOp, quotedActor, {
      threadId: thread.thread.id,
      body: "Another post",
    });
    const quote = `:::quote{post=${thread.post.id}}\nx\n:::`;
    const source = [
      `:::spoiler\n${quote}\n:::`,
      `- ${quote.split("\n").join("\n  ")}`,
      quote
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    ].join("\n\n");
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: source,
    });
    const saved = ctx.sqlite
      .prepare<{ body_source: string }, [number]>(
        "SELECT body_source FROM post_bodies WHERE post_id = ?1",
      )
      .get(reply.id)!.body_source;
    expect(saved.match(/author="Alice"/g)).toHaveLength(3);
    ctx.sqlite
      .prepare("UPDATE users SET username = 'Mary Jane', username_key = 'mary jane' WHERE id = ?1")
      .run(quotedUser.id);
    const result = renderContent(
      ctx,
      author,
      `${saved}\n\n:::quote{post=${newer.id} author="Fake"}\ny\n:::`,
      {
        edit: { contentType: "post", contentId: reply.id, authorId: authorUser.id },
      },
    );
    expect(result.source.startsWith(saved)).toBe(true);
    expect(result.source.match(/author="Alice"/g)).toHaveLength(3);
    // The quote inside the spoiler is in the spoiler's own HTML, not in the body's.
    const shown = [result.html, ...result.spoilers].join("");
    expect(shown.match(/Alice<\/a> wrote:/g)).toHaveLength(3);
    expect(result.source).toContain(`:::quote{post=${newer.id} author="Mary Jane"}`);
    expect(result.html).toContain("Mary Jane</a> wrote:");
  });
});

describe("mention limit on edit", () => {
  test.each([0, 1])("renamed mentions retain their ids at a lowered limit of %i", async (limit) => {
    const ctx = createTestContext();
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const alice = insertUser(ctx, { username: "Alice" });
    const bobby = insertUser(ctx, { username: "Bobby" });
    const newcomer = insertUser(ctx, { username: "Newcomer" });
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Topic",
      body: "@Alice @Bobby",
    });
    ctx.sqlite
      .prepare("UPDATE users SET username = 'Mary Jane', username_key = 'mary jane' WHERE id = ?1")
      .run(alice.id);
    const setLimit = (value: number) =>
      ctx.sqlite
        .prepare(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(JSON.stringify({ ...readSiteSettings(ctx), newMemberMentionLimit: value }));
    setLimit(limit);
    const options = {
      edit: { contentType: "post" as const, contentId: thread.post.id, authorId: authorUser.id },
    };
    const source = '@Newcomer @"mARY jANE" @Bobby @"Mary Jane"';
    const changed = renderContent(ctx, author, source, options);
    expect(changed.mentionedUserIds).toEqual([alice.id, bobby.id]);
    expect(changed.html.match(new RegExp(`data-user-id="${alice.id}"`, "g"))).toHaveLength(2);
    expect(changed.html).not.toContain(`data-user-id="${newcomer.id}"`);
    expect(
      writeTx(ctx, () => storeContentReferences(ctx, "post", thread.post.id, changed))
        .newlyMentioned,
    ).toEqual([]);
    await execute(ctx, postsUpdateOp, author, { postId: thread.post.id, body: source });
    expect(
      ctx.sqlite
        .prepare<{ user_id: number }, [number]>(
          "SELECT user_id FROM content_mentions WHERE content_type = 'post' AND content_id = ?1 ORDER BY user_id",
        )
        .all(thread.post.id)
        .map((row) => row.user_id),
    ).toEqual([alice.id, bobby.id]);

    // Raising the allowance later must not make the retained member newly mentioned again.
    setLimit(3);
    const next = renderContent(ctx, author, '@"Mary Jane" @Bobby', options);
    expect(
      writeTx(ctx, () => storeContentReferences(ctx, "post", thread.post.id, next)).newlyMentioned,
    ).toEqual([]);
  });

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
  test("a 39-character spoiler around ten Markdown quotes remains valid", () => {
    const source = `:::spoiler\n${"> ".repeat(10)}text\n:::`;
    expect(source).toHaveLength(39);
    const html = renderMarkdown(source);
    expect(html.match(/<blockquote>/g)).toHaveLength(10);
    expect(html.match(/<details /g)).toHaveLength(1);
  });

  test("quotes and spoilers have independent ten-level boundaries", () => {
    const spoilers = (body: string, depth: number) =>
      `${":::spoiler\n".repeat(depth)}${body}\n${":::\n".repeat(depth)}`;
    const quotes = (body: string, depth: number) =>
      `${":::quote{post=1}\n".repeat(depth)}${body}\n${":::\n".repeat(depth)}`;
    for (const source of [spoilers(quotes("text", 10), 10), quotes(spoilers("text", 10), 10)]) {
      const html = renderMarkdown(source);
      expect(html.match(/<blockquote>/g)).toHaveLength(10);
      expect(html.match(/<details /g)).toHaveLength(10);
    }
    for (const source of [spoilers("text", 11), quotes("text", 11)]) {
      expect(thrown(() => renderMarkdown(source))).toBeInstanceOf(ValidationError);
    }
    const insideQuotes = spoilers("text", 10)
      .split("\n")
      .map((line) => `${"> ".repeat(10)}${line}`)
      .join("\n");
    expect(renderMarkdown(insideQuotes).match(/<details /g)).toHaveLength(10);
    expect(thrown(() => renderMarkdown(`:::spoiler\n${"> ".repeat(11)}text\n:::`))).toBeInstanceOf(
      ValidationError,
    );
    expect(
      renderMarkdown(`${spoilers("first", 10)}\n${spoilers("second", 10)}`).match(/<details /g),
    ).toHaveLength(20);
  });

  test.each(["- ", "1. "])(
    "spoilers nested through %s list items stop at eleven levels",
    (prefix) => {
      const nested = (depth: number) => {
        let body = "text";
        for (let i = 0; i < depth; i++) {
          const indented = body.split("\n").join(`\n${" ".repeat(prefix.length)}`);
          body = `:::spoiler\n${prefix}${indented}\n:::`;
        }
        return body;
      };
      expect(renderMarkdown(nested(10)).match(/<details /g)).toHaveLength(10);
      expect(thrown(() => renderMarkdown(nested(11)))).toBeInstanceOf(ValidationError);
    },
  );

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

describe("renderMarkdown maxLength", () => {
  test("the default limit is unchanged and maxLength raises it", () => {
    const text = "word ".repeat(3_000).slice(0, MAX_BODY_LENGTH + 1);
    expect(thrown(() => renderMarkdown(text))).toBeInstanceOf(ValidationError);
    expect(renderMarkdown(text, { maxLength: MAX_BODY_LENGTH + 1 })).toContain("word");
    expect(renderMarkdown("x".repeat(MAX_BODY_LENGTH))).toContain("x");
  });

  test("a raised limit is still a limit", () => {
    const error = thrown(() => renderMarkdown("x".repeat(101), { maxLength: 100 }));
    expect(error).toBeInstanceOf(ValidationError);
  });
});
