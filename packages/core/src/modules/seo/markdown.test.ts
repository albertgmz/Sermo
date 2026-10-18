import { expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { invalidate } from "../../context";
import { NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { renderBbCode } from "../../render";
import { postsCreateOp, threadsCreateOp } from "../forums";
import { updateSiteSettings } from "../settings";
import {
  forumMarkdown,
  LLMS_FULL_CAP,
  LLMS_FULL_FORUM_THREADS,
  llmsFullTxt,
  MARKDOWN_POSTS_PER_PAGE,
  type MarkdownPage,
  threadMarkdown,
} from ".";
import { postMarkdown } from "./post-markdown";

const BASE = "https://forum.example.test";
type TestCtx = ReturnType<typeof createTestContext>;

function setPermission(ctx: TestCtx, groupId: number, key: string, value: number, nodeId = 0) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id,node_id,group_id,user_id,value) VALUES ((SELECT id FROM permission_definitions WHERE key=?1),?2,?3,0,?4) ON CONFLICT(permission_id,node_id,group_id,user_id) DO UPDATE SET value=excluded.value",
    )
    .run(key, nodeId, groupId, value);
}

const markdownOf = (page: MarkdownPage) => {
  if ("redirect" in page) throw new Error(`Redirected to ${page.redirect}`);
  return page.markdown;
};

async function setup() {
  const ctx = createTestContext();
  const garden = insertNode(ctx, { title: "Garden", type: "category" });
  const roses = insertNode(ctx, { title: "Roses", parentId: garden.id });
  ctx.sqlite
    .prepare("UPDATE nodes SET description = ?1 WHERE id = ?2")
    .run("All about [roses]", roses.id);
  invalidate(ctx, "node_tree");
  const wren = insertUser(ctx, { username: "wren" });
  const made = await execute(ctx, threadsCreateOp, userActor(wren), {
    nodeId: roses.id,
    title: "Pruning *roses*",
    body: "Cut [b]above[/b] an outward bud.\n[spoiler]The secret[/spoiler]",
  });
  return { ctx, garden, roses, wren, thread: made.thread };
}

async function reply(ctx: TestCtx, threadId: number, body: string) {
  const author = userActor(insertUser(ctx));
  ctx.clock.advance(60_000);
  return execute(ctx, postsCreateOp, author, { threadId, body });
}

test("a post's stored HTML reads as Markdown, with the page's addresses made absolute", () => {
  const html = renderBbCode(
    [
      "Hello [b]bold[/b] [i]it[/i] *stars* _under_ [url=https://ex.com/a(b)]link[/url] https://bare.example/x",
      '[QUOTE="Ann"]quoted [b]text[/b][/QUOTE]',
      "[code=js]const a = `x`;\nif (a < 3) {}[/code]",
      "Inline [icode]a*b[/icode]",
      "[list][*]one[*]two [list=1][*]n1[*]n2[/list][/list]",
      "[heading=2]Title[/heading]",
      "[table][tr][th]A[/th][th]B|x[/th][/tr][tr][td]1[/td][td]2[/td][/tr][/table]",
      "[spoiler]secret words[/spoiler] and [ispoiler]hidden words[/ispoiler]",
      "[img]https://img.example/p.png[/img]",
      "[s]gone[/s]",
    ].join("\n"),
  );
  const markdown = postMarkdown(
    `${html}<p><a href="/members/4" class="mention">@wren</a> <span class="bb-attach" data-attach-id="9" data-attach-size="full">9</span></p><div class="bb-spoiler" data-spoiler="0"></div>`,
    BASE,
  );
  expect(markdown).toContain(
    "Hello **bold** *it* \\*stars\\* \\_under\\_ [link](https://ex.com/a%28b%29) <https://bare.example/x>",
  );
  expect(markdown).toContain("> **Ann**\n> quoted **text**");
  expect(markdown).toContain("```javascript\nconst a = `x`;\nif (a < 3) {}\n```");
  expect(markdown).toContain("Inline `a*b`");
  expect(markdown).toContain("- one\n- two\n  1. n1\n  2. n2");
  expect(markdown).toContain("## Title");
  expect(markdown).toContain("| A | B\\|x |\n| --- | --- |\n| 1 | 2 |");
  expect(markdown).toContain("![](https://img.example/p.png)");
  expect(markdown).toContain("~~gone~~");
  expect(markdown).toContain(`[@wren](${BASE}/members/4) [attachment]`);
  // A spoiler is a mark, whether its content is stored apart or inline.
  expect(markdown).not.toContain("secret words");
  expect(markdown).not.toContain("hidden words");
  expect(markdown.match(/\[spoiler\]/g)).toHaveLength(3);
});

test("a public thread's Markdown has its front matter, its forum and its posts", async () => {
  const { ctx, roses, thread } = await setup();
  await reply(ctx, thread.id, "Second [url=/threads/1]post[/url]");
  const page = threadMarkdown(ctx, BASE, thread.id, `/threads/${thread.id}-pruning-roses`, 1);
  const canonical = `${BASE}/threads/${thread.id}-pruning-roses`;
  expect(page).toMatchObject({ canonical });
  const markdown = markdownOf(page);
  expect(markdown).toStartWith(
    `---\ntitle: "Pruning *roses*"\nurl: "${canonical}"\nforum: "Roses"\nauthor: "wren"\npublished: "`,
  );
  expect(markdown).toContain("\npage: 1\npages: 1\n---\n\n# Pruning *roses*\n\n");
  expect(markdown).toContain(
    `In [Roses](${BASE}/forums/${roses.id}-roses.md), started by wren on `,
  );
  expect(markdown).toContain("Cut **above** an outward bud.\n\n[spoiler]");
  expect(markdown).not.toContain("The secret");
  expect(markdown).toMatch(
    new RegExp(`## wren, \\[[^\\]]+\\]\\(${canonical}#post-${thread.firstPostId}\\)`),
  );
  expect(markdown).toContain(`Second [post](${BASE}/threads/1)`);
  expect(markdown).not.toContain("Next page");
});

test("a long thread's Markdown is paged like the thread", async () => {
  const { ctx, thread } = await setup();
  for (let i = 1; i <= MARKDOWN_POSTS_PER_PAGE; i++) await reply(ctx, thread.id, `Reply ${i}`);
  const path = `/threads/${thread.id}-pruning-roses`;
  const first = markdownOf(threadMarkdown(ctx, BASE, thread.id, path, 1));
  expect(first).toContain("pages: 2\n");
  expect(first).toContain(`Reply ${MARKDOWN_POSTS_PER_PAGE - 1}\n`);
  expect(first).not.toContain(`Reply ${MARKDOWN_POSTS_PER_PAGE}\n`);
  expect(first).toContain(`[Next page](${BASE}${path}.md?page=2)`);
  const second = threadMarkdown(ctx, BASE, thread.id, path, 2);
  expect(second).toMatchObject({ canonical: `${BASE}${path}?page=2` });
  expect(markdownOf(second)).toContain(`Reply ${MARKDOWN_POSTS_PER_PAGE}\n`);
  expect(markdownOf(second)).toContain(`[Previous page](${BASE}${path}.md)`);
  expect(markdownOf(second)).toContain(`?page=2#post-`);
  expect(() => threadMarkdown(ctx, BASE, thread.id, path, 3)).toThrow(NotFoundError);
  expect(() => threadMarkdown(ctx, BASE, thread.id, path, 0)).toThrow(NotFoundError);
});

test("a thread's Markdown leaves out posts a guest does not read", async () => {
  const { ctx, thread } = await setup();
  const held = await reply(ctx, thread.id, "Waiting for approval");
  const gone = await reply(ctx, thread.id, "Taken down");
  ctx.sqlite.prepare("UPDATE posts SET state='moderated' WHERE id=?1").run(held.id);
  ctx.sqlite.prepare("UPDATE posts SET state='deleted' WHERE id=?1").run(gone.id);
  const markdown = markdownOf(
    threadMarkdown(ctx, BASE, thread.id, `/threads/${thread.id}-pruning-roses`, 1),
  );
  expect(markdown).not.toContain("Waiting for approval");
  expect(markdown).not.toContain("Taken down");
});

test("a stale slug, a bare id and a merged thread point at the current Markdown address", async () => {
  const { ctx, roses, wren, thread } = await setup();
  const target = `${BASE}/threads/${thread.id}-pruning-roses.md`;
  expect(threadMarkdown(ctx, BASE, thread.id, `/threads/${thread.id}`, 1)).toEqual({
    redirect: target,
  });
  expect(threadMarkdown(ctx, BASE, thread.id, `/threads/${thread.id}-old`, 2)).toEqual({
    redirect: `${target}?page=2`,
  });
  const other = await execute(ctx, threadsCreateOp, userActor(wren), {
    nodeId: roses.id,
    title: "Merged away",
    body: "Gone",
  });
  ctx.sqlite
    .prepare("UPDATE threads SET state='deleted', merged_into_id=?1 WHERE id=?2")
    .run(thread.id, other.thread.id);
  expect(threadMarkdown(ctx, BASE, other.thread.id, `/threads/${other.thread.id}`, 1)).toEqual({
    redirect: target,
  });
});

test("a thread a guest may not read has no Markdown", async () => {
  const { ctx, roses, thread } = await setup();
  const path = `/threads/${thread.id}-pruning-roses`;
  const missing = () => threadMarkdown(ctx, BASE, thread.id, path, 1);
  expect(() => threadMarkdown(ctx, BASE, thread.id + 99, path, 1)).toThrow(NotFoundError);
  for (const state of ["moderated", "deleted"]) {
    ctx.sqlite.prepare("UPDATE threads SET state=?1 WHERE id=?2").run(state, thread.id);
    expect(missing).toThrow(NotFoundError);
  }
  ctx.sqlite.prepare("UPDATE threads SET state='visible' WHERE id=?1").run(thread.id);
  expect(markdownOf(missing())).toContain("Pruning");
  // Threads closed to guests: the forum hidden, others' threads closed, their text closed.
  for (const key of ["node.view", "forum.viewOthers", "forum.viewContent"]) {
    setPermission(ctx, 1, key, -1, roses.id);
    expect(missing).toThrow(NotFoundError);
    setPermission(ctx, 1, key, 1, roses.id);
    expect(markdownOf(missing())).toContain("Pruning");
  }
  setPermission(ctx, 1, "site.view", -1);
  expect(missing).toThrow(NotFoundError);
});

test("a forum's Markdown lists its public forums and newest public threads", async () => {
  const { ctx, garden, roses, wren, thread } = await setup();
  const child = insertNode(ctx, { title: "Climbers", parentId: roses.id });
  const secret = insertNode(ctx, { title: "Staff roses", parentId: roses.id });
  invalidate(ctx, "node_tree");
  setPermission(ctx, 1, "node.view", -1, secret.id);
  const held = await execute(ctx, threadsCreateOp, userActor(wren), {
    nodeId: roses.id,
    title: "Held thread",
    body: "Waiting",
  });
  ctx.sqlite.prepare("UPDATE threads SET state='moderated' WHERE id=?1").run(held.thread.id);
  const page = forumMarkdown(ctx, BASE, roses.id, `/forums/${roses.id}-roses`);
  expect(page).toMatchObject({ canonical: `${BASE}/forums/${roses.id}-roses` });
  const markdown = markdownOf(page);
  expect(markdown).toStartWith(
    `---\ntitle: "Roses"\nurl: "${BASE}/forums/${roses.id}-roses"\n---\n\n# Roses\n\n> All about \\[roses\\]\n\n`,
  );
  expect(markdown).toContain(`Part of [Garden](${BASE}/forums/${garden.id}-garden.md).`);
  expect(markdown).toContain(`## Forums\n\n- [Climbers](${BASE}/forums/${child.id}-climbers.md)\n`);
  expect(markdown).not.toContain("Staff roses");
  expect(markdown).toContain(
    `- [Pruning *roses*](${BASE}/threads/${thread.id}-pruning-roses.md) by wren, 0 replies, last post `,
  );
  expect(markdown).not.toContain("Held thread");
  // A category lists its forums and no threads.
  const category = markdownOf(forumMarkdown(ctx, BASE, garden.id, `/forums/${garden.id}-garden`));
  expect(category).toContain(`- [Roses](${BASE}/forums/${roses.id}-roses.md): All about`);
  expect(category).not.toContain("## Threads");
  // Threads guests may not open are not listed; a stale slug points at the current address.
  setPermission(ctx, 1, "forum.viewContent", -1, roses.id);
  expect(markdownOf(forumMarkdown(ctx, BASE, roses.id, ""))).not.toContain("## Threads");
  expect(forumMarkdown(ctx, BASE, roses.id, `/forums/${roses.id}`)).toEqual({
    redirect: `${BASE}/forums/${roses.id}-roses.md`,
  });
  setPermission(ctx, 1, "node.view", -1, roses.id);
  expect(() => forumMarkdown(ctx, BASE, roses.id, "")).toThrow(NotFoundError);
  expect(() => forumMarkdown(ctx, BASE, roses.id + 99, "")).toThrow(NotFoundError);
});

test("llms-full.txt holds every public forum with its newest threads and nothing private", async () => {
  const { ctx, roses, wren, thread } = await setup();
  const hidden = insertNode(ctx, { title: "Staff room" });
  invalidate(ctx, "node_tree");
  setPermission(ctx, 1, "node.view", -1, hidden.id);
  await execute(ctx, threadsCreateOp, userActor(wren), {
    nodeId: hidden.id,
    title: "Staff only thread",
    body: "Private",
  });
  const friend = insertUser(ctx);
  await execute(ctx, getOperation("conversations.create"), userActor(wren), {
    title: "Private chat",
    recipientIds: [friend.id],
    body: "A private message",
  });
  for (let i = 0; i < LLMS_FULL_FORUM_THREADS; i++) {
    ctx.clock.advance(60_000);
    await execute(ctx, threadsCreateOp, userActor(wren), {
      nodeId: roses.id,
      title: `Newer ${i}`,
      body: "More",
    });
  }
  updateSiteSettings(ctx, userActor(insertUser(ctx, { groupId: 4 })), { siteName: "Garden Club" });
  const text = llmsFullTxt(ctx, BASE);
  expect(text).toStartWith("# Garden Club\n\n> Garden Club is a discussion forum.\n\n");
  expect(text).toContain(
    `---\n\n# Roses\n\n<${BASE}/forums/${roses.id}-roses.md>\n\n> All about \\[roses\\]`,
  );
  expect(text.match(/^- \[Newer \d\]/gm)).toHaveLength(LLMS_FULL_FORUM_THREADS);
  expect(text).not.toContain(`/threads/${thread.id}-`);
  expect(text).not.toContain("Staff");
  expect(text).not.toContain("Private");
  expect(text).not.toContain("stops here");
  setPermission(ctx, 1, "site.view", -1);
  expect(() => llmsFullTxt(ctx, BASE)).toThrow(NotFoundError);
});

test("llms-full.txt stops before the forum that would take it past its cap", () => {
  const ctx = createTestContext();
  const long = "word ".repeat(100_000);
  const ids = [1, 2, 3].map((i) => insertNode(ctx, { title: `Forum ${i}` }).id);
  for (const id of ids)
    ctx.sqlite.prepare("UPDATE nodes SET description = ?1 WHERE id = ?2").run(long, id);
  invalidate(ctx, "node_tree");
  const text = llmsFullTxt(ctx, BASE);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LLMS_FULL_CAP);
  expect(text).toContain("# Forum 2\n");
  expect(text).not.toContain("# Forum 3\n");
  expect(text).toEndWith(
    `The file stops here, at ${LLMS_FULL_CAP} bytes; the [sitemap](${BASE}/sitemap.xml) lists every public forum and thread.\n`,
  );
});

test("the Markdown queries use their indexes", async () => {
  const { ctx } = await setup();
  expectNoTableScan(
    ctx,
    "SELECT p.id,b.body_html,p.created_at,u.username FROM posts p JOIN post_bodies b ON b.post_id=p.id JOIN users u ON u.id=p.user_id WHERE p.thread_id=?1 AND p.position BETWEEN ?2 AND ?3 AND p.state='visible' ORDER BY p.position",
    [1, 0, 19],
  );
  expectNoTableScan(
    ctx,
    "SELECT position FROM posts WHERE thread_id=?1 AND state='visible' ORDER BY position DESC LIMIT 1",
    [1],
  );
  expectNoTableScan(
    ctx,
    "SELECT t.id,t.title,t.excerpt,t.reply_count,t.last_post_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.node_id=?1 AND t.state='visible' AND t.first_post_id IS NOT NULL ORDER BY t.last_post_at DESC,t.id DESC LIMIT ?2",
    [1, 50],
  );
});
