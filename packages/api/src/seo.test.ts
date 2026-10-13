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
