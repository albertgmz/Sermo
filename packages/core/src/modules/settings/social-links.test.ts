import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { readSiteSettings } from "./index";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

const none = { discord: null, telegram: null, x: null };

test("a site that never set social links has none", async () => {
  const ctx = createTestContext();
  expect(readSiteSettings(ctx).socialLinks).toEqual(none);
  expect((await run(ctx, "site.get", GUEST)).socialLinks).toEqual(none);
});

test("settings stored before social links existed still parse", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  await run(ctx, "settings.update", admin, { siteName: "Old" });
  const stored = JSON.parse(
    ctx.sqlite
      .prepare<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'configuration'")
      .get()!.value,
  );
  delete stored.socialLinks;
  ctx.sqlite
    .prepare("UPDATE site_settings SET value = ?1 WHERE key = 'configuration'")
    .run(JSON.stringify(stored));
  expect(readSiteSettings(ctx)).toMatchObject({ siteName: "Old", socialLinks: none });
  expect((await run(ctx, "settings.get", admin)).socialLinks).toEqual(none);
  expect((await run(ctx, "site.get", GUEST)).name).toBe("Old");
});

test("site.get shows new social links after settings.update, and an update replaces the whole object", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  await run(ctx, "settings.update", admin, {
    socialLinks: { discord: "https://discord.gg/abc", telegram: null, x: "https://x.com/sermo" },
  });
  expect((await run(ctx, "site.get", GUEST)).socialLinks).toEqual({
    discord: "https://discord.gg/abc",
    telegram: null,
    x: "https://x.com/sermo",
  });
  await run(ctx, "settings.update", admin, {
    socialLinks: { discord: null, telegram: "https://t.me/sermo", x: null },
  });
  expect((await run(ctx, "site.get", GUEST)).socialLinks).toEqual({
    discord: null,
    telegram: "https://t.me/sermo",
    x: null,
  });
});

test("social links must be http(s) URLs", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  await expect(
    run(ctx, "settings.update", admin, {
      socialLinks: { discord: "javascript:alert(1)", telegram: null, x: null },
    }),
  ).rejects.toBeInstanceOf(ValidationError);
});

test("site.get tells every visitor the upload limit, and follows settings.update", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  expect((await run(ctx, "site.get", GUEST)).maxUploadBytes).toBe(25 * 1024 * 1024);
  await run(ctx, "settings.update", admin, { maxUploadBytes: 1_000_000 });
  expect((await run(ctx, "site.get", GUEST)).maxUploadBytes).toBe(1_000_000);
  expect((await run(ctx, "site.get", userActor(insertUser(ctx)))).maxUploadBytes).toBe(1_000_000);
});

test("site.get returns the site description; an update that does not send it keeps it", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  expect((await run(ctx, "site.get", GUEST)).description).toBe("");
  await run(ctx, "settings.update", admin, { siteDescription: "  A forum about birds.  " });
  expect((await run(ctx, "site.get", GUEST)).description).toBe("A forum about birds.");
  await run(ctx, "settings.update", admin, { siteName: "Birds" });
  expect((await run(ctx, "site.get", GUEST)).description).toBe("A forum about birds.");
  expect((await run(ctx, "settings.get", admin)).siteDescription).toBe("A forum about birds.");
  await run(ctx, "settings.update", admin, { siteDescription: "" });
  expect((await run(ctx, "site.get", GUEST)).description).toBe("");
  await expect(
    run(ctx, "settings.update", admin, { siteDescription: "x".repeat(301) }),
  ).rejects.toBeInstanceOf(ValidationError);
});

test("settings stored before the description existed still parse", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  await run(ctx, "settings.update", admin, { siteName: "Old" });
  const stored = JSON.parse(
    ctx.sqlite
      .prepare<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'configuration'")
      .get()!.value,
  );
  delete stored.siteDescription;
  ctx.sqlite
    .prepare("UPDATE site_settings SET value = ?1 WHERE key = 'configuration'")
    .run(JSON.stringify(stored));
  expect((await run(ctx, "site.get", GUEST)).description).toBe("");
});

test("the forum statistics panel is off until an administrator turns it on, and site.get follows", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  expect((await run(ctx, "settings.get", admin)).forumStatsEnabled).toBe(false);
  expect((await run(ctx, "site.get", GUEST)).forumStatsEnabled).toBe(false);
  await run(ctx, "settings.update", admin, { forumStatsEnabled: true });
  expect((await run(ctx, "site.get", GUEST)).forumStatsEnabled).toBe(true);
  await run(ctx, "settings.update", admin, { siteName: "Birds" });
  expect((await run(ctx, "site.get", GUEST)).forumStatsEnabled).toBe(true);
});

test("settings stored before the forum statistics switch existed still parse, with it off", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  await run(ctx, "settings.update", admin, { siteName: "Old" });
  const stored = JSON.parse(
    ctx.sqlite
      .prepare<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'configuration'")
      .get()!.value,
  );
  delete stored.forumStatsEnabled;
  ctx.sqlite
    .prepare("UPDATE site_settings SET value = ?1 WHERE key = 'configuration'")
    .run(JSON.stringify(stored));
  expect((await run(ctx, "site.get", GUEST)).forumStatsEnabled).toBe(false);
});

test("site.get carries the analytics setting, none by default", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  expect((await run(ctx, "site.get", GUEST)).analytics).toEqual({ provider: "none" });
  await run(ctx, "settings.update", admin, {
    analytics: { provider: "matomo", url: "https://stats.example.com/", siteId: 4 },
  });
  expect((await run(ctx, "site.get", GUEST)).analytics).toEqual({
    provider: "matomo",
    url: "https://stats.example.com/",
    siteId: 4,
  });
  await run(ctx, "settings.update", admin, {
    analytics: { provider: "google", measurementId: "G-ABC123" },
  });
  expect((await run(ctx, "site.get", GUEST)).analytics).toEqual({
    provider: "google",
    measurementId: "G-ABC123",
  });
});
