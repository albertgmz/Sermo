import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { runDueJobs } from "../jobs";
import { profilesUpdateOp } from "../profiles";
import { readSiteSettings, updateSiteSettings } from "../settings";
import { queueSeoEvents, registerSeoJobs, sitemapEntries, sitemapIndex, sitemapShard } from ".";

const BASE = "https://forum.example.test";

async function setup() {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = BASE;
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = userActor(insertUser(ctx));
  await execute(ctx, profilesUpdateOp, author, { about: "About this author" });
  const userId = actorUserId(author)!;
  const robots = async () =>
    (await execute(ctx, getOperation("seo.profile"), GUEST, { userId })).robots;
  return { ctx, admin, author, userId, robots };
}

test("a profile is not indexable while the setting is off, which is the default", async () => {
  const { ctx, robots } = await setup();
  expect(await robots()).toBe("noindex,follow");
  expect([...sitemapEntries(ctx, BASE, "profile")]).toEqual([]);
  expect(sitemapShard(ctx, BASE, "profile", 1)).not.toContain("<url>");
  expect(sitemapIndex(ctx, BASE)).not.toContain("profile-");
  // The scan never prepares its query while the setting is off.
  expect(ctx.statements.has("seo.sitemapProfiles")).toBe(false);
});

test("a profile with an about text is indexable and listed once the setting is on", async () => {
  const { ctx, admin, userId, robots } = await setup();
  updateSiteSettings(ctx, admin, { indexProfiles: true });
  expect(await robots()).toBe("index,follow");
  expect([...sitemapEntries(ctx, BASE, "profile")].map((row) => row.id)).toEqual([userId]);
  expect(sitemapShard(ctx, BASE, "profile", 1)).toContain(`/members/${userId}-`);
  expect(sitemapIndex(ctx, BASE)).toContain("profile-1.xml");
});

test("an empty profile stays out while the setting is on", async () => {
  const { ctx, admin } = await setup();
  updateSiteSettings(ctx, admin, { indexProfiles: true });
  const empty = insertUser(ctx).id;
  expect((await execute(ctx, getOperation("seo.profile"), GUEST, { userId: empty })).robots).toBe(
    "noindex,follow",
  );
  expect([...sitemapEntries(ctx, BASE, "profile")].map((row) => row.id)).not.toContain(empty);
});

test("turning the setting off again removes the profile from the sitemap and the index", async () => {
  const { ctx, admin, robots } = await setup();
  updateSiteSettings(ctx, admin, { indexProfiles: true });
  updateSiteSettings(ctx, admin, { indexProfiles: false });
  expect(await robots()).toBe("noindex,follow");
  expect(sitemapIndex(ctx, BASE)).not.toContain("profile-");
});

test("a stored settings row from before the setting existed reads as off", () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  updateSiteSettings(ctx, admin, { siteName: "Old site" });
  const row = ctx.sqlite
    .prepare<{ value: string }, []>("SELECT value FROM site_settings WHERE key='configuration'")
    .get()!;
  const stored = JSON.parse(row.value) as Record<string, unknown>;
  delete stored.indexProfiles;
  ctx.sqlite
    .prepare("UPDATE site_settings SET value=?1 WHERE key='configuration'")
    .run(JSON.stringify(stored));
  expect(readSiteSettings(ctx).indexProfiles).toBe(false);
});

test("IndexNow announces a profile edit only when the site indexes profiles", async () => {
  const { ctx, admin, author, userId } = await setup();
  updateSiteSettings(ctx, admin, { indexNowKey: "example-key-123" });
  const sent: string[] = [];
  registerSeoJobs(ctx, (async (_input: unknown, init?: RequestInit) => {
    sent.push(...(JSON.parse(String(init?.body)) as { urlList: string[] }).urlList);
    return new Response("ok");
  }) as typeof fetch);
  const profileUrls = () => sent.filter((url) => url.includes("/members/"));
  queueSeoEvents(ctx);
  await runDueJobs(ctx);
  expect(profileUrls()).toEqual([]);
  updateSiteSettings(ctx, admin, { indexProfiles: true });
  await execute(ctx, profilesUpdateOp, author, { about: "Changed" });
  queueSeoEvents(ctx);
  await runDueJobs(ctx);
  expect(profileUrls().some((url) => url.includes(`/members/${userId}-`))).toBe(true);
});
