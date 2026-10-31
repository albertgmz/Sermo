import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { profilesUpdateOp } from "../profiles";
import { updateSiteSettings } from "../settings";
import { sitemapEntries, sitemapIndex, sitemapShard } from ".";

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
  return { ctx, admin, userId, robots };
}

test("a profile is not indexable while the setting is off, which is the default", async () => {
  const { ctx, robots } = await setup();
  expect(await robots()).toBe("noindex,follow");
  expect([...sitemapEntries(ctx, BASE, "profile")]).toEqual([]);
  expect(sitemapShard(ctx, BASE, "profile", 1)).not.toContain("<url>");
  expect(sitemapIndex(ctx, BASE)).not.toContain("profile-");
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
