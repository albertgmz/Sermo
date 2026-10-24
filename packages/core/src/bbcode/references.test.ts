import { describe, expect, spyOn, test } from "bun:test";
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
import * as permissions from "../permissions";
import { PRINCIPAL_COLUMNS } from "../permissions";
import {
  bbCodeText,
  renderBbCode,
  renderContent,
  renderPlainText,
  storeContentReferences,
} from "../render";

describe("BB code references", () => {
  test("mentions resolve case-insensitively, including quoted names, but not code or links", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const alice = insertUser(ctx, { username: "Alice" });
    const space = insertUser(ctx, { username: "Mary Jane" });
    const result = renderContent(
      ctx,
      author,
      '@ALICE @"mary jane" @Nobody [ICODE]@Alice[/ICODE]\n\n[CODE]\n@Alice\n[/CODE]\n\n[URL=https://example.com]@Alice[/URL]\n\n[PLAIN]@Alice[/PLAIN]',
    );
    expect(result.mentionedUserIds).toEqual([alice.id, space.id]);
    expect(result.html).toContain(`data-user-id="${alice.id}"`);
    expect(result.html).toContain(`>@Alice</a>`);
    expect(result.html).toContain(`>@Mary Jane</a>`);
    expect(result.html).toContain("@Nobody");
    expect(result.html).toContain("<code>@Alice</code>");
    expect(result.html.match(/class="mention"/g)).toHaveLength(2);
    expect(result.html).not.toContain(
      '<a href="https://example.com" rel="nofollow ugc noopener"><a',
    );
  });

  test("email addresses and text inside links never become mentions", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    insertUser(ctx, { username: "b.com" });
    const alice = insertUser(ctx, { username: "Alice" });
    const result = renderContent(
      ctx,
      author,
      "contact a@b.com now [URL=https://example.com/a]see @Alice[/URL] [IMG]https://example.com/a.png[/IMG] @Alice",
    );
    expect(result.mentionedUserIds).toEqual([alice.id]);
    expect(result.html).toContain("contact a@b.com now");
    expect(result.html.match(/class="mention"/g)).toHaveLength(1);
    expect(result.html).toContain("see @Alice</a>");
  });

  test("names may start and end with underscores", () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const target = insertUser(ctx, { username: "_Bob_" });
    expect(renderContent(ctx, author, "@_Bob_").mentionedUserIds).toEqual([target.id]);
  });

  test("tag scans stay fast and preserve ordinary paragraphs", () => {
    renderBbCode("warmup");
    for (const source of [
      "[".repeat(5000),
      "[/".repeat(2500),
      "a:::".repeat(2500),
      "[ISPOILER".repeat(1000),
      "@a".repeat(2500),
    ]) {
      const start = performance.now();
      renderBbCode(source);
      expect(performance.now() - start).toBeLessThan(100);
    }
    expect(renderBbCode("foo [ISPOILER]bar[/ISPOILER] baz")).toBe(
      '<p>foo <span class="spoiler">bar</span> baz</p>',
    );
    expect(renderBbCode("a:::b")).toBe("<p>a:::b</p>");
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
    expect(
      renderContent(ctx, editor, `[QUOTE="post: ${own.id}"]text[/QUOTE]`, edit).quotes,
    ).toEqual([{ postId: own.id, userId: editorUser.id }]);
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(thread.post.id);
    expect(() =>
      renderContent(ctx, editor, `[QUOTE="post: ${thread.post.id}"]text[/QUOTE]`, edit),
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

  test("a quote of a post has the header every attributed quote has, with no English words", async () => {
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
      title: "Topic",
      body: "Original",
    });
    const id = thread.post.id;
    const linked = renderContent(ctx, author, `[QUOTE="post: ${id}"]quoted[/QUOTE]`).html;
    expect(linked).toBe(
      `<blockquote class="bb-quote quote" data-post-id="${id}"><cite class="bb-quote-author"><a href="/posts/${id}" rel="nofollow ugc noopener">Alice</a></cite>quoted</blockquote>`,
    );
    // Inside a link the author is only named.
    const inLink = renderContent(
      ctx,
      author,
      `[URL=https://a.example][QUOTE="post: ${id}"]q[/QUOTE][/URL]`,
    ).html;
    expect(inLink).toContain(
      `<blockquote class="bb-quote quote" data-post-id="${id}"><cite class="bb-quote-author">Alice</cite>q</blockquote>`,
    );
    expect(linked + inLink).not.toContain("wrote");
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
    const canonical = `[QUOTE="Alice, post: ${postId}, member: ${authorUser.id}"]`;
    const quote = `[QUOTE="Fake, post: ${postId}, member: 999"][B]quoted[/B][/QUOTE]`;
    const result = renderContent(ctx, other, quote);
    expect(result.quotes).toEqual([{ postId, userId: authorUser.id }]);
    expect(result.html).toContain(`data-post-id="${postId}"`);
    expect(result.html).toContain("Alice</a></cite>");
    expect(result.html).not.toContain("Fake");
    expect(result.source).toBe(`${canonical}[B]quoted[/B][/QUOTE]`);
    // XenForo's other spellings of a quote of a post.
    for (const option of [
      `post: ${postId}`,
      `Fake, post: ${postId}`,
      `"Fake, post: ${postId}"`,
      `'Fake, post: ${postId}, member: 9'`,
      `"Fake, convMessage: 4, post: ${postId}, member: 9"`,
    ]) {
      const spelled = renderContent(ctx, other, `[quote=${option}]text[/quote]`);
      expect(spelled.source).toBe(`${canonical}text[/quote]`);
      expect(spelled.html).toContain("Alice</a></cite>");
    }
    const nested = renderContent(
      ctx,
      other,
      `[QUOTE="Fake, post: ${postId}"][QUOTE="Also Fake, post: ${postId}"]Nested[/QUOTE][/QUOTE]`,
    );
    expect(nested.source.match(/\[QUOTE="Alice, post: /g)).toHaveLength(2);
    const placed = renderContent(
      ctx,
      other,
      `[LIST][*][QUOTE="Fake, post: ${postId}"]list quote[/QUOTE][/LIST]\n\n[SPOILER][QUOTE="Fake, post: ${postId}"]in a spoiler[/QUOTE][/SPOILER]`,
    );
    expect(placed.source.match(/\[QUOTE="Alice, post: /g)).toHaveLength(2);
    // Inside code or plain it is not a quote at all.
    const literal = `[CODE][QUOTE="Fake, post: ${postId}"]x[/QUOTE][/CODE]`;
    expect(renderContent(ctx, other, literal).source).toBe(literal);
    expect(renderContent(ctx, other, literal).quotes).toEqual([]);
    expect(
      renderContent(ctx, other, `[QUOTE="post: ${postId}"]\r\nCRLF\r\n[/QUOTE]`).source,
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
    ).toContain(`[QUOTE="Alice, post: `);
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
    expect(() => renderContent(ctx, other, '[QUOTE="Fake, post: 99999"]x[/QUOTE]')).toThrow(
      ValidationError,
    );
  });

  test("a quote of a member whose name holds brackets, quotes, commas or colons reads back as written", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const writer = insertUser(ctx);
    const other = userActor(writer);
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const names = [
      "Crow[de(a)d]",
      "Aoki [x]",
      "]odd[",
      'Say "hi"',
      '"Yoandy_Isse"',
      "Ann, post: 7",
      "Re: Bob, convMessage: 5",
      "post: 3",
      "member: 4",
      "Agent: 47",
      'a"]b',
    ];
    for (const name of names) {
      const member = insertUser(ctx, { username: name });
      const thread = await execute(ctx, threadsCreateOp, userActor(member), {
        nodeId: forum.id,
        title: "Topic",
        body: "Original",
      });
      const postId = thread.post.id;
      // Write -> parse -> render: the quote links to its post under the member's real name.
      const reply = await execute(ctx, postsCreateOp, other, {
        threadId: thread.thread.id,
        body: `[QUOTE="Fake, post: ${postId}, member: 999"]quoted[/QUOTE]`,
      });
      const stored = () =>
        ctx.sqlite
          .prepare<{ body_source: string; body_html: string }, [number]>(
            "SELECT body_source, body_html FROM post_bodies WHERE post_id = ?1",
          )
          .get(reply.id)!;
      const { body_source: source, body_html: html } = stored();
      expect(source, name).toStartWith('[QUOTE="');
      expect(source, name).toContain(`post: ${postId}, member: ${member.id}"]quoted[/QUOTE]`);
      expect(html, name).toContain(`data-post-id="${postId}"`);
      expect(html, name).not.toContain("[QUOTE");
      // The canonical source renders to itself, as any later render of the stored text does.
      const again = renderContent(ctx, other, source);
      expect(again.source, name).toBe(source);
      expect(again.quotes, name).toEqual([{ postId, userId: member.id }]);
      expect(again.html, name).toBe(html);
      // A moderator's re-render of the stored text (an edit, a merge or a split).
      const moderated = renderContent(ctx, admin, source, {
        edit: { contentType: "post", contentId: reply.id, authorId: writer.id },
      });
      expect(moderated.source, name).toBe(source);
      expect(moderated.html, name).toBe(html);
    }
  });

  test("spoilers and plain text hide concealed content", () => {
    const html = renderBbCode(
      '[SPOILER="Ending"]Secret [B]ending[/B][/SPOILER]\n\n[ISPOILER]inline secret[/ISPOILER]',
    );
    expect(html).toContain(
      '<details class="spoiler"><summary class="bb-spoiler-summary bb-has-title">Ending</summary>',
    );
    expect(html).toContain('<span class="spoiler">inline secret</span>');
    const entity = renderBbCode('[SPOILER="A & B"]secret[/SPOILER]');
    expect(entity).toContain(">A &amp; B</summary>");
    expect(entity).not.toContain("&amp;amp;");
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

  test("a code block cannot close a spoiler", () => {
    const html = renderBbCode("[SPOILER][CODE]\n[/SPOILER]\n[/CODE]\ninside[/SPOILER]");
    expect(html).toContain("[/SPOILER]</code>");
    expect(html).toContain("inside");
    expect(html.match(/<\/details>/g)).toHaveLength(1);
  });

  test("stored and search excerpts hide spoilers and omit tags", () => {
    const source =
      'before\n[SPOILER=Ending]secret end[/SPOILER]\nafter [ISPOILER]inline secret[/ISPOILER]\n[QUOTE="Alice, post: 1, member: 2"]quoted words[/QUOTE]';
    for (const text of [excerptFromMarkdown(source), maskMarkupForExcerpt(source)]) {
      expect(text).toContain("[spoiler]");
      expect(text).toContain("quoted words");
      expect(text).not.toContain("secret end");
      expect(text).not.toContain("inline secret");
      expect(text).not.toContain("[QUOTE");
    }
    // Typed Markdown is text, and an excerpt keeps it as typed.
    expect(excerptFromMarkdown("snake_case **bold** #tag")).toBe("snake_case **bold** #tag");
  });

  test("excerpts keep text that only looks like a tag and drop what is not text", () => {
    expect(excerptFromMarkdown("x = arr[i] + arr[b] [s] [/u]")).toBe(
      "x = arr[i] + arr[b] [s] [/u]",
    );
    expect(
      excerptFromMarkdown(
        "see [IMG]https://a.example/p.png[/IMG] [ATTACH=full]12[/ATTACH][MEDIA=youtube]kQ0Eo1UccEE[/MEDIA] now[HR]",
      ),
    ).toBe("see now");
    expect(
      excerptFromMarkdown(
        "[B]bold[/B] [URL]www.a.b[/URL] [CODE]a[i][/CODE] [PLAIN][b][/PLAIN] [USER=3]Al[/USER]",
      ),
    ).toBe("bold www.a.b a[i] [b] Al");
    // A stray closing tag in a cut text does not hide what follows.
    expect(maskMarkupForExcerpt("a [/SPOILER] b", 100)).toBe("a [/SPOILER] b");
    expect(maskMarkupForExcerpt("a [SPOILER]s", 5)).not.toContain("s");
  });

  test("an excerpt cut inside a tag does not show the start of it, and U+0001 is no spoiler", () => {
    const cut = maskMarkupForExcerpt(
      "hello world [URL=https://example.com/path]link text[/URL] and more",
      30,
    );
    expect(cut).toBe("hello world ");
    expect(maskMarkupForExcerpt("a [B]b[/B] and arr[i", 100)).toBe("a b and arr[i");
    expect(excerptFromMarkdown("typed \u0001 mark")).toBe("typed mark");
    expect(excerptFromMarkdown("typed \u0001 [SPOILER]s[/SPOILER]")).toBe("typed [spoiler]");
  });

  test("the search text keeps the words in spoilers and drops tags and attributions", () => {
    expect(
      bbCodeText(
        '[QUOTE="Alice, post: 12, member: 3"]quoted[/QUOTE] [SPOILER=T]secret[/SPOILER] [B]b[/B] arr[i]',
      ),
    ).toBe("quoted secret b arr[i]");
  });

  test("a post quoted many times is checked once", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx, { username: "Alice" }));
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
    const quote = `[QUOTE="post: ${thread.post.id}"]x[/QUOTE]`;
    const view = spyOn(permissions, "can");
    const result = renderContent(ctx, other, quote.repeat(200));
    const checks = view.mock.calls.filter(([, , id]) => id === "node.view").length;
    view.mockRestore();
    expect(result.quotes).toHaveLength(1);
    expect(result.html.match(/Alice<\/a><\/cite>/g)).toHaveLength(200);
    expect(checks).toBe(1);
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
      body: "needle before [ISPOILER]private inline[/ISPOILER]\n[SPOILER]private block[/SPOILER]\nafter",
    });
    const stored = ctx.sqlite
      .prepare<{ excerpt: string }, [number]>("SELECT excerpt FROM threads WHERE id = ?1")
      .get(thread.thread.id)!.excerpt;
    expect(stored).not.toContain("private");
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: `needle reply\n[SPOILER]private block[/SPOILER]\n[QUOTE="post: ${thread.post.id}"]quoted words[/QUOTE]`,
    });
    const result = await execute(ctx, searchQueryOp, author, { q: "needle" });
    const item = result.items.find((entry) => entry.post.id === reply.id);
    expect(item?.post.excerpt).toContain("quoted words");
    expect(item?.post.excerpt).not.toContain("private");
    expect(item?.post.excerpt).not.toContain("[QUOTE");
  });

  test("nested quotes obey the depth limit", () => {
    const nested = (count: number) =>
      `${'[QUOTE="Alice, post: 1"]'.repeat(count)}text${"[/QUOTE]".repeat(count)}`;
    expect(renderBbCode(nested(10))).toContain("<blockquote");
    expect(() => renderBbCode(nested(11))).toThrow(ValidationError);
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
