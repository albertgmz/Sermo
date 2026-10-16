import { describe, expect, test } from "bun:test";
import { insertUser } from "@sermo/core/testing";
import { writeTx } from "./db/tx";
import { ValidationError } from "./errors";
import { world } from "./modules/feed/fixtures.test";
import { MAX_BODY_LENGTH, renderContent, renderForImport, storeContentReferences } from "./render";

const quote = (author: string, postId: number, text = "quoted words") =>
  `[QUOTE="${author}, post: ${postId}, member: 7"]${text}[/QUOTE]`;

describe("renderForImport", () => {
  test("renders a body of 50,000 characters that renderContent refuses", async () => {
    const w = world();
    const body = `${"A line of ordinary text with [B]bold[/B] and a link https://example.com/x.\n".repeat(700)}tail`;
    expect(body.length).toBeGreaterThan(50_000);
    const long = body.slice(0, 50_000);
    expect(() => renderContent(w.ctx, w.admin, long)).toThrow(ValidationError);
    const result = renderForImport(w.ctx, w.admin, long, { nodeId: w.open.id });
    expect(result.source).toHaveLength(50_000);
    expect(result.html).toContain("<strong>bold</strong>");
  });

  test("a quote of a missing post is a plain quote with its author and no link", () => {
    const w = world();
    const html = renderForImport(w.ctx, w.admin, quote("Gone Member", 99_999), {
      nodeId: w.open.id,
    }).html;
    expect(html).toContain('<cite class="bb-quote-author">Gone Member</cite>');
    expect(html).toContain("quoted words");
    expect(html).not.toContain("/posts/");
    expect(html).not.toContain("data-post-id");
    expect(() => renderContent(w.ctx, w.admin, quote("Gone Member", 99_999))).toThrow(
      "The quoted post is not visible.",
    );
  });

  test("a quote of a deleted or hidden post, or of a deleted thread, is a plain quote", async () => {
    const w = world();
    const thread = await w.thread(w.alice, w.open.id, "Topic");
    const deleted = await w.reply(w.bob, thread.thread.id, "Deleted later");
    const hidden = await w.reply(w.bob, thread.thread.id, "Hidden later");
    const visible = await w.reply(w.bob, thread.thread.id, "Still here");
    const other = await w.thread(w.alice, w.open.id, "Other topic");
    const set = (table: string, id: number, state: string) =>
      w.ctx.sqlite.prepare(`UPDATE ${table} SET state = ?1 WHERE id = ?2`).run(state, id);
    set("posts", deleted.id, "deleted");
    set("posts", hidden.id, "moderated");
    set("threads", other.thread.id, "deleted");
    const render = (postId: number) =>
      renderForImport(w.ctx, w.admin, quote("Bob", postId), { nodeId: w.open.id });
    for (const postId of [deleted.id, hidden.id, other.post.id]) {
      const result = render(postId);
      expect(result.html).toContain('<cite class="bb-quote-author">Bob</cite>');
      expect(result.html).not.toContain("/posts/");
      expect(result.quotes).toEqual([]);
      expect(result.source).toBe(quote("Bob", postId));
    }
    const live = render(visible.id);
    expect(live.html).toContain(`href="/posts/${visible.id}"`);
    expect(live.quotes).toEqual([{ postId: visible.id, userId: w.bobUser.id }]);
  });

  test("a quote of a private-forum post from a public thread has no link and no source content", async () => {
    const w = world();
    const secret = await w.thread(w.admin, w.secret.id, "Hidden topic", "secret opening words");
    const body = quote("Insider", secret.post.id, "only what the quote says");
    const result = renderForImport(w.ctx, w.admin, body, { nodeId: w.open.id });
    expect(result.html).toContain('<cite class="bb-quote-author">Insider</cite>');
    expect(result.html).toContain("only what the quote says");
    expect(result.html).not.toContain("/posts/");
    expect(result.html).not.toContain("data-post-id");
    expect(result.html).not.toContain("secret opening words");
    expect(result.html).not.toContain("Hidden topic");
    expect(result.quotes).toEqual([]);
    expect(result.source).toBe(body);
    // The same quote inside the private forum links: its readers can open the source.
    const inside = renderForImport(w.ctx, w.admin, body, { nodeId: w.secret.id });
    expect(inside.html).toContain(`href="/posts/${secret.post.id}"`);
    expect(inside.quotes).toHaveLength(1);
    // Nothing is recorded for the stored references of the public post.
    writeTx(w.ctx, () => storeContentReferences(w.ctx, "post", 1, result));
    expect(
      w.ctx.sqlite
        .prepare("SELECT 1 FROM content_quotes WHERE quoted_post_id = ?1")
        .all(secret.post.id),
    ).toEqual([]);
  });

  test("mentions are not cut by the limit of a new member", () => {
    const w = world();
    const names = Array.from({ length: 6 }, (_, i) => `Target${i}`);
    for (const name of names) insertUser(w.ctx, { username: name });
    const source = names.map((name) => `@${name}`).join(" ");
    expect(renderContent(w.ctx, w.alice, source).mentionedUserIds).toHaveLength(3);
    expect(
      renderForImport(w.ctx, w.alice, source, { nodeId: w.open.id }).mentionedUserIds,
    ).toHaveLength(6);
  });
});

describe("the normal write path keeps its cap", () => {
  test("posts.create refuses 10,001 characters and takes 10,000", async () => {
    const w = world();
    const thread = await w.thread(w.alice, w.open.id, "Topic");
    await expect(
      w.call("posts.create", w.bob, {
        threadId: thread.thread.id,
        body: "x".repeat(MAX_BODY_LENGTH + 1),
      }),
    ).rejects.toThrow(ValidationError);
    await w.call("posts.create", w.bob, {
      threadId: thread.thread.id,
      body: "x".repeat(MAX_BODY_LENGTH),
    });
  });
});
