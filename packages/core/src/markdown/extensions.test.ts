import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { writeTx } from "../db/tx";
import { ValidationError } from "../errors";
import { conversationsCreateOp, conversationsReplyOp } from "../modules/conversations";
import { nodesCreateOp, postsCreateOp, postsUpdateOp, threadsCreateOp } from "../modules/forums";
import {
  profileCommentsCreateOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsUpdateOp,
} from "../modules/profiles";
import { searchQueryOp } from "../modules/search";
import { excerptFromMarkdown, maskMarkupForExcerpt } from "../modules/seo/excerpt";
import { execute } from "../operation";
import { PRINCIPAL_COLUMNS } from "../permissions";
import { renderContent, renderMarkdown, renderPlainText, storeContentReferences } from "../render";

describe("Markdown extensions", () => {
  test("mentions resolve case-insensitively, including quoted names, but not code or links", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const alice = insertUser(ctx, { username: "Alice" });
    const space = insertUser(ctx, { username: "Mary Jane" });
    const result = renderContent(
      ctx,
      author,
      '@ALICE @"mary jane" @Nobody `@Alice`\n\n```\n@Alice\n```\n\n[@Alice](https://example.com)',
    );
    expect(result.mentionedUserIds).toEqual([alice.id, space.id]);
    expect(result.html).toContain(`data-user-id="${alice.id}"`);
    expect(result.html).toContain(`>@Alice</a>`);
    expect(result.html).toContain(`>@Mary Jane</a>`);
    expect(result.html).toContain("@Nobody");
    expect(result.html).toContain("<code>@Alice</code>");
    expect(result.html).not.toContain(
      '<a href="https://example.com" rel="nofollow ugc noopener"><a',
    );
  });

  test("email addresses and image alt text never become mentions", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    insertUser(ctx, { username: "b.com" });
    const alice = insertUser(ctx, { username: "Alice" });
    const result = renderContent(
      ctx,
      author,
      "contact a@b.com now ![see @Alice](https://example.com/a.png) @Alice",
    );
    expect(result.mentionedUserIds).toEqual([alice.id]);
    expect(result.html).toContain('href="mailto:a@b.com"');
    expect(result.html).toContain('alt="see @Alice"');
  });

  test("names may start and end with underscores", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const target = insertUser(ctx, { username: "_Bob_" });
    expect(renderContent(ctx, author, "@_Bob_").mentionedUserIds).toEqual([target.id]);
  });

  test("block start scans stay fast and preserve ordinary paragraphs", () => {
    renderMarkdown("warmup");
    for (const source of [
      ">!".repeat(5000),
      ":::\n".repeat(2500),
      "a:::".repeat(2500),
      "a >!".repeat(2500),
    ]) {
      const start = performance.now();
      renderMarkdown(source);
      expect(performance.now() - start).toBeLessThan(100);
    }
    expect(renderMarkdown("foo >!bar!< baz")).toBe(
      '<p>foo <span class="spoiler">bar</span> baz</p>',
    );
    expect(renderMarkdown("a:::b")).toBe("<p>a:::b</p>");
  });

  test("new member and permission limits leave excess mentions as text", () => {
    const ctx = createTestContext();
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const users = Array.from({ length: 11 }, (_, i) => insertUser(ctx, { username: `Target${i}` }));
    const source = users.map((u) => `@${u.username}`).join(" ");
    const fresh = renderContent(ctx, author, source);
    expect(fresh.mentionedUserIds).toHaveLength(3);
    ctx.sqlite
      .prepare("UPDATE users SET created_at = ?1 WHERE id = ?2")
      .run(ctx.now() - 9 * 86_400_000, authorUser.id);
    const older = renderContent(ctx, author, source);
    expect(older.mentionedUserIds).toHaveLength(10);
    const moderatorUser = insertUser(ctx, { groupId: 3 });
    const moderator = userActor(moderatorUser);
    ctx.sqlite
      .prepare("UPDATE users SET created_at = ?1 WHERE id = ?2")
      .run(ctx.now() - 9 * 86_400_000, moderatorUser.id);
    expect(renderContent(ctx, moderator, source).mentionedUserIds).toHaveLength(11);
  });

  test("reference edits report newly mentioned ids and remove old rows", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const alice = insertUser(ctx, { username: "Alice" });
    const bob = insertUser(ctx, { username: "Bobby" });
    const first = renderContent(ctx, author, "@Alice");
    expect(
      writeTx(ctx, () => storeContentReferences(ctx, "post", 31, first)).newlyMentioned,
    ).toEqual([alice.id]);
    const next = renderContent(ctx, author, "@Bobby");
    expect(
      writeTx(ctx, () => storeContentReferences(ctx, "post", 31, next)).newlyMentioned,
    ).toEqual([bob.id]);
    expect(
      ctx.sqlite.prepare<{ user_id: number }, []>("SELECT user_id FROM content_mentions").all(),
    ).toEqual([{ user_id: bob.id }]);
  });

  test("stored mentions keep their id after the target is renamed", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const target = insertUser(ctx, { username: "Alice" });
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Topic",
      body: "@Alice",
    });
    ctx.sqlite
      .prepare("UPDATE users SET username = 'Carol', username_key = 'carol' WHERE id = ?1")
      .run(target.id);
    ctx.sqlite
      .prepare("UPDATE auth_user SET username = 'carol', display_username = 'Carol' WHERE id = ?1")
      .run(target.id);
    const html = ctx.sqlite
      .prepare<{ body_html: string }, [number]>(
        "SELECT body_html FROM post_bodies WHERE post_id = ?1",
      )
      .get(thread.post.id)!.body_html;
    expect(html).toContain(`data-user-id="${target.id}"`);
    expect(html).toContain("@Alice</a>");
    const impostor = insertUser(ctx, { username: "Alice", email: "impostor@example.test" });
    const edit = renderContent(ctx, author, "@Alice revised", {
      edit: { contentType: "post", contentId: thread.post.id, authorId: authorUser.id },
    });
    expect(edit.mentionedUserIds).toEqual([target.id]);
    expect(
      writeTx(ctx, () => storeContentReferences(ctx, "post", thread.post.id, edit)).newlyMentioned,
    ).toEqual([]);
    await execute(ctx, postsUpdateOp, author, { postId: thread.post.id, body: "@Alice revised" });
    const changed = ctx.sqlite
      .prepare<{ body_html: string }, [number]>(
        "SELECT body_html FROM post_bodies WHERE post_id = ?1",
      )
      .get(thread.post.id)!.body_html;
    expect(changed).toContain(`data-user-id="${target.id}"`);
    expect(changed).not.toContain(`data-user-id="${impostor.id}"`);
  });

  test("moderator edits use the original author's mention limit", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const author = userActor(insertUser(ctx));
    const targets = Array.from({ length: 5 }, (_, i) => insertUser(ctx, { username: `Limit${i}` }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Topic",
      body: "Initial",
    });
    const source = targets.map((user) => `@${user.username}`).join(" ");
    await execute(ctx, postsUpdateOp, moderator, { postId: thread.post.id, body: source });
    const html = ctx.sqlite
      .prepare<{ body_html: string }, [number]>(
        "SELECT body_html FROM post_bodies WHERE post_id = ?1",
      )
      .get(thread.post.id)!.body_html;
    expect(html.match(/class="mention"/g)).toHaveLength(3);
  });

  test("new quote visibility on edit belongs to the editor", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const editorUser = insertUser(ctx);
    const editor = userActor(editorUser);
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Topic",
      body: "Initial",
    });
    const own = await execute(ctx, postsCreateOp, editor, {
      threadId: thread.thread.id,
      body: "Editor's post",
    });
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(own.id);
    const edit = {
      edit: { contentType: "post" as const, contentId: thread.post.id, authorId: authorUser.id },
    };
    expect(renderContent(ctx, editor, `:::quote{post=${own.id}}\ntext\n:::`, edit).quotes).toEqual([
      { postId: own.id, userId: editorUser.id },
    ]);
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(thread.post.id);
    expect(() =>
      renderContent(ctx, editor, `:::quote{post=${thread.post.id}}\ntext\n:::`, edit),
    ).toThrow(ValidationError);
  });

  test("profile and conversation writes store and update mentions", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const target = insertUser(ctx, { username: "Alice" });
    const wall = await execute(ctx, profilePostsCreateOp, author, {
      userId: target.id,
      body: "@Alice",
    });
    const comment = await execute(ctx, profileCommentsCreateOp, author, {
      profilePostId: wall.id,
      body: "@Alice",
    });
    const conversation = await execute(ctx, conversationsCreateOp, author, {
      title: "Private",
      recipientIds: [target.id],
      body: "@Alice",
    });
    const reply = await execute(ctx, conversationsReplyOp, author, {
      conversationId: conversation.conversation.id,
      body: "@Alice",
    });
    const rows = ctx.sqlite
      .prepare<{ content_type: string; content_id: number; user_id: number }, []>(
        "SELECT content_type, content_id, user_id FROM content_mentions ORDER BY content_type, content_id",
      )
      .all();
    expect(rows).toEqual([
      {
        content_type: "conversation_message",
        content_id: conversation.message.id,
        user_id: target.id,
      },
      { content_type: "conversation_message", content_id: reply.id, user_id: target.id },
      { content_type: "profile_post", content_id: wall.id, user_id: target.id },
      { content_type: "profile_post_comment", content_id: comment.id, user_id: target.id },
    ]);
    await execute(ctx, profilePostsUpdateOp, author, {
      profilePostId: wall.id,
      body: "No mention",
    });
    await execute(ctx, profileCommentsUpdateOp, author, {
      commentId: comment.id,
      body: "No mention",
    });
    expect(
      ctx.sqlite
        .prepare<{ content_type: string }, []>(
          "SELECT content_type FROM content_mentions ORDER BY content_type",
        )
        .all(),
    ).toEqual([{ content_type: "conversation_message" }, { content_type: "conversation_message" }]);
  });

  test("quotes validate visibility and store real attribution", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const authorUser = insertUser(ctx, { username: "Alice" });
    const author = userActor(authorUser);
    const other = userActor(insertUser(ctx));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Topic",
      body: "Original",
    });
    const postId = thread.post.id;
    const quote = `:::quote{post=${postId} author="Fake"}\n**quoted**\n:::`;
    const result = renderContent(ctx, other, quote);
    expect(result.quotes).toEqual([{ postId, userId: authorUser.id }]);
    expect(result.html).toContain(`data-post-id="${postId}"`);
    expect(result.html).toContain("Alice</a> wrote:");
    expect(result.source).toContain(`:::quote{post=${postId} author="Alice"}`);
    expect(renderContent(ctx, other, `:::quote{post=${postId}}\ntext\n:::`).source).toContain(
      `:::quote{post=${postId} author="Alice"}`,
    );
    expect(renderContent(ctx, other, `:::quote{post=${postId}}\ntext\n:::`).html).toContain(
      "Alice</a> wrote:",
    );
    const nested = renderContent(
      ctx,
      other,
      `:::quote{post=${postId} author="Fake"}\n:::quote{post=${postId} author="Also Fake"}\nNested\n:::\n:::`,
    );
    expect(nested.source.match(/author="Alice"/g)).toHaveLength(2);
    const placed = renderContent(
      ctx,
      other,
      `- :::quote{post=${postId} author="Fake"}\n  list quote\n  :::\n\n> :::quote{post=${postId} author="Fake"}\n> block quote\n> :::\n`,
    );
    expect(placed.source.match(/author="Alice"/g)).toHaveLength(2);
    expect(
      renderContent(ctx, other, `:::quote{post=${postId}}\r\nCRLF\r\n:::`).source,
    ).not.toContain("\r");
    const reply = await execute(ctx, postsCreateOp, other, {
      threadId: thread.thread.id,
      body: quote,
    });
    expect(
      ctx.sqlite
        .prepare<{ body_source: string }, [number]>(
          "SELECT body_source FROM post_bodies WHERE post_id = ?1",
        )
        .get(reply.id)!.body_source,
    ).toContain(`author="Alice"`);
    expect(
      ctx.sqlite
        .prepare<{ quoted_post_id: number }, []>("SELECT quoted_post_id FROM content_quotes")
        .all(),
    ).toEqual([{ quoted_post_id: postId }]);
    ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(postId);
    await execute(ctx, postsUpdateOp, other, { postId: reply.id, body: `${quote}\nkept` });
    expect(
      ctx.sqlite
        .prepare<{ quoted_post_id: number }, []>("SELECT quoted_post_id FROM content_quotes")
        .get()!.quoted_post_id,
    ).toBe(postId);
    expect(() => renderContent(ctx, other, quote)).toThrow(ValidationError);
    await execute(ctx, postsUpdateOp, other, { postId: reply.id, body: "No quote" });
    expect(ctx.sqlite.prepare("SELECT id FROM content_quotes").all()).toHaveLength(0);
    expect(() => renderContent(ctx, other, ':::quote{post=99999 author="Fake"}\nx\n:::')).toThrow(
      ValidationError,
    );
  });

  test("spoilers and plain text hide concealed content", () => {
    const html = renderMarkdown(
      ':::spoiler{title="Ending"}\nSecret **ending**\n:::\n\n>!inline secret!<',
    );
    expect(html).toContain('<details class="spoiler"><summary>Spoiler: Ending</summary>');
    expect(html).toContain('<span class="spoiler">inline secret</span>');
    expect(renderMarkdown(':::spoiler{title="A &amp; B"}\nsecret\n:::')).toContain(
      "Spoiler: A &amp; B</summary>",
    );
    expect(renderMarkdown(':::spoiler{title="A &amp; B"}\nsecret\n:::')).not.toContain("&amp;amp;");
    expect(renderPlainText(html)).not.toContain("secret");
    expect(renderPlainText(html)).toContain("[spoiler]");
    expect(renderPlainText("<blockquote><p>quoted text</p></blockquote>")).toBe("> quoted text");
    expect(
      renderPlainText(
        '<p>See <a href="https://example.com">site</a> and <a href="/members/1" class="mention">@Alice</a>.</p>',
      ),
    ).toContain("site (https://example.com) and @Alice");
    expect(renderPlainText("<p>one two three four</p>", 11)).toBe("one two…");
    expect(
      renderPlainText(
        '<blockquote class="quote"><cite><a href="/posts/1">Alice</a> wrote:</cite><p>text</p></blockquote>',
      ),
    ).toContain("> Alice wrote:");
    expect(
      renderPlainText('<h2>Mixed Case</h2><p><a href="mailto:a@b.com">a@b.com</a></p>'),
    ).toContain("Mixed Case\n\na@b.com");
    expect(
      renderPlainText('<h2>Mixed Case</h2><p><a href="mailto:a@b.com">a@b.com</a></p>'),
    ).not.toContain("(a@b.com)");
  });

  test("fenced code cannot close a spoiler container", () => {
    const html = renderMarkdown(":::spoiler\n```text\n:::\n```\ninside\n:::");
    expect(html).toContain(":::\n</code>");
    expect(html).toContain("<p>inside</p>");
    expect(html).toContain("</details>");
  });

  test("stored and search excerpts hide spoilers and omit quote directive syntax", () => {
    const source =
      'before\n:::spoiler{title="Ending"}\nsecret end\n:::\nafter >!inline secret!<\n- :::quote{post=1 author="Alice"}\n  quoted words\n  :::';
    for (const text of [excerptFromMarkdown(source), maskMarkupForExcerpt(source)]) {
      expect(text).toContain("[spoiler]");
      expect(text).toContain("quoted words");
      expect(text).not.toContain("secret end");
      expect(text).not.toContain("inline secret");
      expect(text).not.toContain(":::quote");
    }
  });

  test("thread and search excerpts never expose spoiler content", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx, { username: "Alice" }));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Excerpt topic",
      body: "needle before >!private inline!<\n:::spoiler\nprivate block\n:::\nafter",
    });
    const stored = ctx.sqlite
      .prepare<{ excerpt: string }, [number]>("SELECT excerpt FROM threads WHERE id = ?1")
      .get(thread.thread.id)!.excerpt;
    expect(stored).not.toContain("private");
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: `needle reply\n:::spoiler\nprivate block\n:::\n:::quote{post=${thread.post.id}}\nquoted words\n:::`,
    });
    const result = await execute(ctx, searchQueryOp, author, { q: "needle" });
    const item = result.items.find((entry) => entry.post.id === reply.id);
    expect(item?.post.excerpt).toContain("quoted words");
    expect(item?.post.excerpt).not.toContain("private");
    expect(item?.post.excerpt).not.toContain(":::quote");
  });

  test("nested quote directives obey the depth limit", () => {
    const nested = (count: number) =>
      `${':::quote{post=1 author="Alice"}\n'.repeat(count)}text\n${":::\n".repeat(count)}`;
    expect(renderMarkdown(nested(10))).toContain("<blockquote>");
    expect(() => renderMarkdown(nested(11))).toThrow(ValidationError);
  });

  test("reference lookups use indexes", () => {
    const ctx = createTestContext();
    expectNoTableScan(
      ctx,
      "SELECT id, username, username_key FROM users WHERE username_key IN (SELECT value FROM json_each(?1))",
      ['["alice"]'],
    );
    expectNoTableScan(
      ctx,
      "SELECT p.id, p.user_id, u.username, p.state AS post_state, t.state AS thread_state, t.user_id AS thread_user_id, t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id WHERE p.id IN (SELECT value FROM json_each(?1))",
      ["[1]"],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?2",
      ["post", 1],
    );
    expectNoTableScan(
      ctx,
      "SELECT quoted_post_id, quoted_user_id FROM content_quotes WHERE content_type = ?1 AND content_id = ?2",
      ["post", 1],
    );
    expectNoTableScan(
      ctx,
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
      [1],
    );
  });
});
