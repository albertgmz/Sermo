import { expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import {
  nodesGetOp,
  nodesUpdateOp,
  postsCreateOp,
  postsDeleteOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsGetOp,
  threadsUpdateOp,
} from "../forums";
import { runDueJobs } from "../jobs";
import { profilesGetOp, profilesUpdateOp } from "../profiles";
import { updateSiteSettings } from "../settings";
import {
  atomFeed,
  canonicalPath,
  indexNowBatches,
  queueSeoEvents,
  registerSeoJobs,
  sitemapEntries,
  sitemapIndex,
  sitemapShard,
} from ".";

function setPermission(
  ctx: ReturnType<typeof createTestContext>,
  groupId: number,
  key: string,
  value: number,
  nodeId = 0,
) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id,node_id,group_id,user_id,value) VALUES ((SELECT id FROM permission_definitions WHERE key=?1),?2,?3,0,?4) ON CONFLICT(permission_id,node_id,group_id,user_id) DO UPDATE SET value=excluded.value",
    )
    .run(key, nodeId, groupId, value);
}

test("SEO uses node, profile, and state-specific thread permissions", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, { title: "Restricted" });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Reviewable",
    body: "Body",
  });
  const groupId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title,rank) VALUES ('SEO reviewers',10) RETURNING id",
    )
    .get()!.id;
  setPermission(ctx, groupId, "site.view", 1);
  const viewer = userActor(insertUser(ctx, { groupId }));
  const threadInput = { threadId: made.thread.id };
  await expect(
    execute(ctx, getOperation("seo.thread"), viewer, threadInput),
  ).rejects.toBeInstanceOf(NotFoundError);
  setPermission(ctx, groupId, "node.view", 1, node.id);
  setPermission(ctx, groupId, "forum.viewOthers", 1, node.id);
  setPermission(ctx, groupId, "forum.viewContent", 1, node.id);
  expect(
    (await execute(ctx, getOperation("seo.node"), viewer, { nodeId: node.id })).title,
  ).toContain("Restricted");
  ctx.sqlite.prepare("UPDATE threads SET state='moderated' WHERE id=?1").run(made.thread.id);
  await expect(
    execute(ctx, getOperation("seo.thread"), viewer, threadInput),
  ).rejects.toBeInstanceOf(NotFoundError);
  setPermission(ctx, groupId, "forum.viewModerated", 1, node.id);
  expect((await execute(ctx, getOperation("seo.thread"), viewer, threadInput)).title).toContain(
    "Reviewable",
  );
  ctx.sqlite.prepare("UPDATE threads SET state='deleted' WHERE id=?1").run(made.thread.id);
  await expect(
    execute(ctx, getOperation("seo.thread"), viewer, threadInput),
  ).rejects.toBeInstanceOf(NotFoundError);
  setPermission(ctx, groupId, "forum.viewDeleted", 1, node.id);
  expect((await execute(ctx, getOperation("seo.thread"), viewer, threadInput)).title).toContain(
    "Reviewable",
  );
  expect((await execute(ctx, getOperation("seo.thread"), author, threadInput)).title).toContain(
    "Reviewable",
  );
  await expect(
    execute(ctx, getOperation("seo.profile"), viewer, { userId: actorUserId(author)! }),
  ).rejects.toBeInstanceOf(NotFoundError);
  setPermission(ctx, groupId, "profile.view", 1);
  expect(
    (await execute(ctx, getOperation("seo.profile"), viewer, { userId: actorUserId(author)! }))
      .title,
  ).toBeTruthy();
  const visible = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Guest-hidden visible thread",
    body: "Public state, hidden node",
  });
  expect(atomFeed(ctx, "https://forum.example.test", "Forum")).toContain(
    "Guest-hidden visible thread",
  );
  setPermission(ctx, 1, "node.view", -1, node.id);
  expect(
    [...sitemapEntries(ctx, "https://forum.example.test", "node")].map((row) => row.id),
  ).not.toContain(node.id);
  expect(atomFeed(ctx, "https://forum.example.test", "Forum")).not.toContain(
    "Guest-hidden visible thread",
  );
  expect(
    [...sitemapEntries(ctx, "https://forum.example.test", "thread")].map((row) => row.id),
  ).not.toContain(visible.thread.id);
  expect(() => atomFeed(ctx, "https://forum.example.test", "Forum", node.id)).toThrow(
    NotFoundError,
  );
  ctx.config.siteBaseURL = "https://forum.example.test";
  updateSiteSettings(ctx, userActor(insertUser(ctx, { groupId: 4 })), {
    indexNowKey: "seo-test-key",
  });
  let submissions = 0;
  registerSeoJobs(ctx, (async () => {
    submissions++;
    return new Response("ok");
  }) as unknown as typeof fetch);
  queueSeoEvents(ctx);
  await runDueJobs(ctx);
  expect(submissions).toBe(0);
});

test("accented slugs are cosmetic and detail responses include complete structured data", async () => {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://foro.example.test";
  const node = insertNode(ctx, { title: "Discusión Española" });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "¿Qué tal, mañana?",
    body: "[B]Resumen[/B] con enlace [URL=https://example.test]uno[/URL]",
  });
  await execute(ctx, postsCreateOp, author, {
    threadId: made.thread.id,
    body: "Segunda respuesta",
  });
  await execute(ctx, profilesUpdateOp, author, { about: "About this author" });
  const thread = await execute(ctx, threadsGetOp, GUEST, { threadId: made.thread.id });
  const nodeDetail = await execute(ctx, nodesGetOp, GUEST, { nodeId: node.id });
  const profile = await execute(ctx, profilesGetOp, GUEST, {
    userId: actorUserId(author)!,
  });
  expect(canonicalPath("node", node.id, nodeDetail.node.title)).toBe(
    `/forums/${node.id}-discusion-espanola`,
  );
  expect(canonicalPath("thread", 7, "Qué tal")).toBe("/threads/7-que-tal");
  expect(canonicalPath("profile", 7, "Ana")).toBe("/members/7-ana");
  expect(new URL(nodeDetail.seo.canonical).pathname).toBe(`/forums/${node.id}-discusion-espanola`);
  // A request for the old or the plain-number address is told to move to the current one.
  const moved = await execute(ctx, getOperation("seo.node"), GUEST, {
    nodeId: node.id,
    requestedPath: `/nodes/${node.id}-discusion-espanola`,
  });
  expect(moved.redirect).toBe(true);
  const here = await execute(ctx, getOperation("seo.node"), GUEST, {
    nodeId: node.id,
    requestedPath: `/forums/${node.id}-discusion-espanola`,
  });
  expect(here.redirect).toBe(false);
  expect(thread.seo.canonical).toContain("que-tal-manana");
  expect(thread.seo.redirect).toBe(false);
  expect(thread.seo.robots).toBe("index,follow");
  expect(thread.seo.description).toContain("Resumen con enlace uno");
  const posting = thread.seo.jsonLd.find(
    (item: unknown) => (item as { "@type": string })["@type"] === "DiscussionForumPosting",
  ) as Record<string, unknown>;
  expect(posting).toMatchObject({
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: made.thread.title,
    commentCount: 1,
  });
  for (const property of [
    "@id",
    "url",
    "mainEntityOfPage",
    "text",
    "author",
    "datePublished",
    "interactionStatistic",
    "comment",
  ])
    expect(posting[property]).toBeDefined();
  expect(posting.interactionStatistic).toMatchObject({
    "@type": "InteractionCounter",
    interactionType: { "@type": "ViewAction" },
    userInteractionCount: 1,
  });
  const breadcrumb = nodeDetail.seo.jsonLd[0] as { itemListElement: unknown[] };
  expect(breadcrumb.itemListElement).toHaveLength(1);
  expect(breadcrumb.itemListElement[0]).toMatchObject({
    "@type": "ListItem",
    position: 1,
    name: nodeDetail.node.title,
    item: nodeDetail.seo.canonical,
  });
  expect(profile.seo.jsonLd[0]).toMatchObject({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: profile.seo.canonical,
    mainEntity: {
      "@type": "Person",
      name: profile.username,
      identifier: String(profile.id),
      url: profile.seo.canonical,
    },
  });
  expect((profile.seo.jsonLd[0] as Record<string, unknown>).dateCreated).toBeDefined();
  const emptyProfile = await execute(ctx, profilesGetOp, GUEST, { userId: insertUser(ctx).id });
  expect(emptyProfile.seo.robots).toBe("noindex,follow");
  const stale = await execute(ctx, getOperation("seo.thread"), GUEST, {
    threadId: made.thread.id,
    requestedPath: `/threads/${made.thread.id}-old-title`,
  });
  expect(stale.redirect).toBe(true);
  const pageTwo = await execute(ctx, getOperation("seo.thread"), GUEST, {
    threadId: made.thread.id,
    requestedPath: `${new URL(thread.seo.canonical).pathname}?page=2`,
    page: 2,
    pageSize: 1,
  });
  const laterPosting = pageTwo.jsonLd.find(
    (item: unknown) => (item as { "@type": string })["@type"] === "DiscussionForumPosting",
  ) as Record<string, unknown>;
  expect(laterPosting.mainEntityOfPage).toBe(thread.seo.canonical);
  expect(pageTwo.redirect).toBe(false);
  expect(pageTwo.robots).toBe("index,follow");
  const empty = await execute(ctx, getOperation("seo.thread"), GUEST, {
    threadId: made.thread.id,
    page: 9,
  });
  expect(empty.robots).toBe("noindex,follow");
});

test("a later page left sparse by deleted posts is noindex", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Long thread",
    body: "First",
  });
  const replies: number[] = [];
  for (let i = 0; i < 21; i++)
    replies.push(
      (await execute(ctx, postsCreateOp, author, { threadId: made.thread.id, body: `Reply ${i}` }))
        .id,
    );
  for (const id of replies.slice(19, 20)) await execute(ctx, postsDeleteOp, author, { postId: id });
  const page = await execute(ctx, getOperation("seo.thread"), GUEST, {
    threadId: made.thread.id,
    page: 2,
    pageSize: 20,
  });
  expect(page.robots).toBe("noindex,follow");
});

test("sitemaps expose only guest-visible content and IndexNow stays disabled without a key", async () => {
  const ctx = createTestContext();
  const publicNode = insertNode(ctx, { title: "Public" });
  const privateNode = insertNode(ctx, { title: "Private" });
  ctx.sqlite
    .prepare("INSERT INTO node_permissions (node_id,group_id,can_view) VALUES (?1,1,0)")
    .run(privateNode.id);
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const publicThread = await execute(ctx, threadsCreateOp, author, {
    nodeId: publicNode.id,
    title: "Visible",
    body: "Text",
  });
  const privateThread = await execute(ctx, threadsCreateOp, author, {
    nodeId: privateNode.id,
    title: "Hidden",
    body: "Text",
  });
  const nodes = [...sitemapEntries(ctx, "https://forum.example.test", "node")];
  const threads = [...sitemapEntries(ctx, "https://forum.example.test", "thread")];
  expect(nodes.map((row) => row.id)).toContain(publicNode.id);
  expect(nodes.every((row) => new URL(row.url).pathname.startsWith("/forums/"))).toBe(true);
  expect(nodes.map((row) => row.id)).not.toContain(privateNode.id);
  expect(threads.map((row) => row.id)).toContain(publicThread.thread.id);
  expect(threads.map((row) => row.id)).not.toContain(privateThread.thread.id);
  await expect(
    execute(ctx, getOperation("seo.thread"), GUEST, { threadId: privateThread.thread.id }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(sitemapIndex(ctx, "https://forum.example.test")).toContain("thread-1.xml");
  expect(indexNowBatches("https://forum.example.test", undefined, ["/threads/1"])).toEqual([]);
});

test("sitemap lastmod advances on public node, thread, and profile changes", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, { title: "Original" });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Topic",
    body: "First",
  });
  await execute(ctx, profilesUpdateOp, author, { about: "Public biography" });
  ctx.clock.advance(60_000);
  await execute(ctx, nodesUpdateOp, admin, { nodeId: node.id, title: "Renamed" });
  await execute(ctx, postsCreateOp, author, { threadId: made.thread.id, body: "Reply" });
  await execute(ctx, profilesUpdateOp, author, { about: "Changed biography" });
  const base = "https://forum.example.test";
  const expected = new Date(ctx.now()).toISOString();
  expect([...sitemapEntries(ctx, base, "node")].find((row) => row.id === node.id)?.lastmod).toBe(
    expected,
  );
  expect(
    [...sitemapEntries(ctx, base, "thread")].find((row) => row.id === made.thread.id)?.lastmod,
  ).toBe(expected);
  expect(
    [...sitemapEntries(ctx, base, "profile")].find((row) => row.id === actorUserId(author)!)
      ?.lastmod,
  ).toBe(expected);
});

test("IndexNow consumes public events, batches URLs, and retries a failed submission", async () => {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  const node = insertNode(ctx, { title: "Public" });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  updateSiteSettings(ctx, admin, { indexNowKey: "example-key-123" });
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Notice",
    body: "Body",
  });
  const calls: string[][] = [];
  let failures = 1;
  registerSeoJobs(ctx, (async (_input: unknown, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(String(init?.body)) as { urlList: string[] };
    calls.push(payload.urlList);
    if (failures-- > 0) return new Response("try again", { status: 503 });
    return new Response("ok", { status: 200 });
  }) as typeof fetch);
  queueSeoEvents(ctx);
  await runDueJobs(ctx);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain(`https://forum.example.test/threads/${made.thread.id}-notice`);
  expect(
    ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM indexnow_pending").get()?.n,
  ).toBeGreaterThan(0);
  ctx.clock.advance(30_000);
  await runDueJobs(ctx);
  expect(calls).toHaveLength(2);
  expect(
    ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM indexnow_pending").get()?.n,
  ).toBe(0);
  await execute(ctx, threadsUpdateOp, author, {
    threadId: made.thread.id,
    title: "Updated notice",
  });
  await execute(ctx, threadsDeleteOp, admin, { threadId: made.thread.id });
  queueSeoEvents(ctx);
  await runDueJobs(ctx);
  expect(calls.at(-1)).toContain(
    `https://forum.example.test/threads/${made.thread.id}-updated-notice`,
  );
});

test("SEO page and feed queries use indexed plans", () => {
  const ctx = createTestContext();
  expectNoTableScan(
    ctx,
    "SELECT p.id,p.user_id,p.position,b.body_source,p.created_at,p.edited_at,u.username FROM posts p JOIN post_bodies b ON b.post_id=p.id JOIN users u ON u.id=p.user_id WHERE p.thread_id=?1 AND p.position BETWEEN ?2 AND ?3 AND p.state='visible' ORDER BY p.position",
    [1, 0, 19],
  );
  expectNoTableScan(
    ctx,
    "SELECT t.id,t.node_id,t.title,t.excerpt,t.created_at,t.last_post_at,t.content_updated_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.state='visible' AND t.node_id IN (SELECT value FROM json_each(?1)) ORDER BY t.last_post_at DESC,t.id DESC LIMIT ?2",
    ["[1]", 50],
  );
  expectNoTableScan(
    ctx,
    "SELECT t.id,t.node_id,t.title,t.excerpt,t.created_at,t.last_post_at,t.content_updated_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.state='visible' AND t.node_id=?1 ORDER BY t.last_post_at DESC,t.id DESC LIMIT ?2",
    [1, 50],
  );
});

test("sitemap shards cap exactly at 50,000 URLs", () => {
  const ctx = createTestContext();
  ctx.sqlite.exec(
    "WITH RECURSIVE seq(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM seq WHERE id<50001) INSERT INTO nodes (id,type,title,position) SELECT id,'forum','Node '||id,id FROM seq",
  );
  invalidate(ctx, "node_tree");
  const base = "https://forum.example.test";
  const index = sitemapIndex(ctx, base);
  expect(index).toContain("node-1.xml");
  expect(index).toContain("node-2.xml");
  expect((sitemapShard(ctx, base, "node", 1).match(/<url>/g) ?? []).length).toBe(50_000);
  expect((sitemapShard(ctx, base, "node", 2).match(/<url>/g) ?? []).length).toBe(1);
});

test("page titles, structured data and the feed name the site by its site name setting", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = insertUser(ctx, { username: "Writer" });
  const node = insertNode(ctx, { title: "Lounge" });
  invalidate(ctx, "node_tree");
  const made = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: node.id,
    title: "Hello",
    body: "Body",
  });
  updateSiteSettings(ctx, admin, { siteName: "Acme Talk" });
  const call = (name: string, input: object) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), GUEST, input as never) as Promise<any>;
  expect((await call("seo.thread", { threadId: made.thread.id })).title).toBe("Hello | Acme Talk");
  expect((await call("seo.node", { nodeId: node.id })).title).toBe("Lounge | Acme Talk");
  expect((await call("seo.profile", { userId: author.id })).title).toBe("Writer | Acme Talk");
  expect((await call("profiles.get", { userId: author.id })).seo.title).toBe("Writer | Acme Talk");
  expect(JSON.stringify(await call("seo.thread", { threadId: made.thread.id }))).not.toContain(
    "Sermo",
  );
  updateSiteSettings(ctx, admin, { siteName: "Other" });
  expect((await call("seo.thread", { threadId: made.thread.id })).title).toBe("Hello | Other");
});

test("masking for the guest thread page works on a bounded part of each post", async () => {
  const { boundSource, maskMarkupForExcerpt } = await import("./excerpt");
  const long = `${"word ".repeat(2_000)}[SPOILER]secret tail[/SPOILER]`;
  expect(boundSource(long, 3000).text).toHaveLength(3000);
  expect(boundSource("short", 3000)).toEqual({ text: "short", truncated: false });
  expect(maskMarkupForExcerpt(long, 3000).length).toBeLessThanOrEqual(3000);
  // A spoiler the cut leaves open hides the rest, block or inline.
  const cut = `${"x".repeat(2_990)}[SPOILER]secret that goes on and on [/SPOILER]`;
  const masked = maskMarkupForExcerpt(cut, 3000);
  expect(masked).not.toContain("secret");
  expect(masked).toContain("[spoiler]");
  expect(
    maskMarkupForExcerpt(`${"x".repeat(2_990)} [ISPOILER]secret goes on and on[/ISPOILER]`, 3000),
  ).not.toContain("secret");
  expect(
    maskMarkupForExcerpt(`${"x".repeat(2_000)}[SPOILER]secret[/SPOILER]`, 2_010),
  ).not.toContain("secret");
});
