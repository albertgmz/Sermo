import { expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
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
  canonicalPath,
  indexNowBatches,
  queueSeoEvents,
  registerSeoJobs,
  sitemapEntries,
  sitemapIndex,
  sitemapShard,
} from ".";

test("accented slugs are cosmetic and detail responses include complete structured data", async () => {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://foro.example.test";
  const node = insertNode(ctx, { title: "Discusión Española" });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "¿Qué tal, mañana?",
    body: "**Resumen** con enlace [uno](https://example.test)",
  });
  await execute(ctx, postsCreateOp, author, {
    threadId: made.thread.id,
    body: "Segunda respuesta",
  });
  await execute(ctx, profilesUpdateOp, author, { about: "About this author" });
  const thread = await execute(ctx, threadsGetOp, GUEST, { threadId: made.thread.id });
  const nodeDetail = await execute(ctx, nodesGetOp, GUEST, { nodeId: node.id });
  const profile = await execute(ctx, profilesGetOp, GUEST, {
    userId: made.thread.author.id,
  });
  expect(canonicalPath("node", node.id, nodeDetail.node.title)).toContain("discusion-espanola");
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
    [...sitemapEntries(ctx, base, "profile")].find((row) => row.id === made.thread.author.id)
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
