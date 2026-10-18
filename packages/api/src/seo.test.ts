import { expect, test } from "bun:test";
import { execute, getOperation, invalidate, updateSiteSettings } from "@sermo/core";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

test("public SEO routes serve XML, Atom, robots and only the configured IndexNow key", async () => {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  const node = insertNode(ctx, { title: "Announcements" });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  await execute(ctx, getOperation("threads.create"), author, {
    nodeId: node.id,
    title: "Hello",
    body: "News",
  });
  updateSiteSettings(ctx, admin, { indexNowKey: "example-key-123" });
  const app = createApp(ctx, { trustedProxyHeader: null });
  const robots = await app.request("/robots.txt");
  expect(robots.status).toBe(200);
  expect(await robots.text()).toContain("https://forum.example.test/sitemap.xml");
  const index = await app.request("/sitemap.xml");
  expect(index.status).toBe(200);
  expect(await index.text()).toContain("thread-1.xml");
  const shard = await app.request("/sitemaps/thread-1.xml");
  expect(shard.status).toBe(200);
  expect(await shard.text()).toContain("/threads/");
  const feed = await app.request(`/forums/${node.id}/feed.atom`);
  expect(feed.status).toBe(200);
  expect(await feed.text()).toContain("<entry>");
  const slugged = await app.request(`/forums/${node.id}-announcements/feed.atom`);
  expect(slugged.status).toBe(200);
  const old = await app.request(`/nodes/${node.id}/feed.atom`);
  expect(old.status).toBe(301);
  expect(old.headers.get("location")).toBe(`/forums/${node.id}/feed.atom`);
  expect((await app.request("/example-key-123.txt")).status).toBe(200);
  const robotsAgain = await (await app.request("/robots.txt")).text();
  expect(robotsAgain).toContain("Allow: /api/v1/files/");
  expect(robotsAgain.indexOf("Allow: /api/v1/files/")).toBeLessThan(
    robotsAgain.indexOf("Disallow: /api/\n"),
  );
  expect(robotsAgain).toContain("Disallow: /api/\n");
  updateSiteSettings(ctx, admin, { siteName: "Acme Talk" });
  expect(await (await app.request("/feed.atom")).text()).toContain("<title>Acme Talk</title>");
  expect((await app.request("/different-key.txt")).status).toBe(404);
});

test("/llms.txt is served as plain text at the root, from the site settings and the guest-visible forums", async () => {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  const open = insertNode(ctx, { title: "Open forum" });
  const hidden = insertNode(ctx, { title: "Closed forum" });
  invalidate(ctx, "node_tree");
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id,node_id,group_id,user_id,value) VALUES ((SELECT id FROM permission_definitions WHERE key='node.view'),?1,1,0,-1)",
    )
    .run(hidden.id);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  updateSiteSettings(ctx, admin, { siteName: "Acme Talk", siteDescription: "Acme users talk." });
  const app = createApp(ctx, { trustedProxyHeader: null });
  const response = await app.request("/llms.txt");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  const body = await response.text();
  expect(body.startsWith("# Acme Talk\n\n> Acme users talk.\n")).toBe(true);
  expect(body).toContain(`(https://forum.example.test/forums/${open.id}-open-forum.md)`);
  expect(body).not.toContain("Closed forum");
  expect(body).toContain("(https://forum.example.test/api/v1/openapi.json)");
  expect(body).toContain("(https://forum.example.test/mcp)");
  expect((await app.request("/llms.txt", { method: "POST" })).status).not.toBe(200);
});

test("public threads and forums have a Markdown version; nothing a guest cannot read does", async () => {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  const open = insertNode(ctx, { title: "Roses" });
  const closed = insertNode(ctx, { title: "Staff room" });
  invalidate(ctx, "node_tree");
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id,node_id,group_id,user_id,value) VALUES ((SELECT id FROM permission_definitions WHERE key='node.view'),?1,1,0,-1)",
    )
    .run(closed.id);
  const author = userActor(insertUser(ctx, { username: "wren" }));
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const create = getOperation("threads.create");
  const thread = (
    await execute(ctx, create, author, {
      nodeId: open.id,
      title: "Pruning",
      body: "Cut [b]here[/b]",
    })
  ).thread;
  const staff = (
    await execute(ctx, create, admin, { nodeId: closed.id, title: "Rota", body: "Staff only" })
  ).thread;
  const held = (
    await execute(ctx, create, author, { nodeId: open.id, title: "Held", body: "Waiting" })
  ).thread;
  ctx.sqlite.prepare("UPDATE threads SET state='moderated' WHERE id=?1").run(held.id);
  await execute(ctx, getOperation("conversations.create"), author, {
    title: "Private chat",
    recipientIds: [adminUser.id],
    body: "A private message",
  });
  const app = createApp(ctx, { trustedProxyHeader: null });
  const base = "https://forum.example.test";

  const page = await app.request(`/threads/${thread.id}-pruning.md`);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  expect(page.headers.get("cache-control")).toBe("public, max-age=60");
  expect(page.headers.get("link")).toBe(`<${base}/threads/${thread.id}-pruning>; rel="canonical"`);
  expect(page.headers.get("set-cookie")).toBeNull();
  const body = await page.text();
  expect(body).toContain("# Pruning\n");
  expect(body).toContain("Cut **here**");
  expect((await app.request(`/threads/${thread.id}-pruning.md`, { method: "HEAD" })).status).toBe(
    200,
  );
  const bare = await app.request(`/threads/${thread.id}.md?page=2`);
  expect(bare.status).toBe(301);
  expect(bare.headers.get("location")).toBe(`${base}/threads/${thread.id}-pruning.md?page=2`);
  expect((await app.request(`/threads/${thread.id}-pruning.md?page=2`)).status).toBe(404);
  expect((await app.request(`/threads/${thread.id}-pruning.md?page=x`)).status).toBe(404);

  const forum = await app.request(`/forums/${open.id}-roses.md`);
  expect(forum.status).toBe(200);
  expect(forum.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  const forumBody = await forum.text();
  expect(forumBody).toContain(`- [Pruning](${base}/threads/${thread.id}-pruning.md) by wren`);
  expect(forumBody).not.toContain("Held");
  expect((await app.request(`/forums/${open.id}.md`)).headers.get("location")).toBe(
    `${base}/forums/${open.id}-roses.md`,
  );

  // Hidden, moderated, missing and malformed: not found.
  for (const path of [
    `/threads/${staff.id}-rota.md`,
    `/threads/${held.id}-held.md`,
    `/threads/9999.md`,
    `/forums/${closed.id}-staff-room.md`,
    "/threads/abc.md",
    `/threads/${thread.id}-pruning`,
    "/forums/0.md",
  ]) {
    expect((await app.request(path)).status, path).toBe(404);
  }

  const full = await app.request("/llms-full.txt");
  expect(full.status).toBe(200);
  expect(full.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(full.headers.get("cache-control")).toBe("public, max-age=60");
  const fullBody = await full.text();
  expect(fullBody).toContain(`# Roses\n\n<${base}/forums/${open.id}-roses.md>`);
  expect(fullBody).toContain(`[Pruning](${base}/threads/${thread.id}-pruning.md)`);
  const llms = await (await app.request("/llms.txt")).text();
  expect(llms).toContain(`(${base}/forums/${open.id}-roses.md)`);
  expect(llms).toContain(`(${base}/llms-full.txt)`);
  for (const text of [body, forumBody, fullBody, llms]) {
    expect(text).not.toContain("Staff");
    expect(text).not.toContain("Rota");
    expect(text).not.toContain("Waiting");
    expect(text).not.toContain("rivate");
  }
});
