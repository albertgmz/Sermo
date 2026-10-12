import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { createStorage, localDriver } from "../storage";
import { readSiteSettings } from "./index";

sharp.cache(false);

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const png = () =>
  sharp({
    create: { width: 60, height: 20, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
    .png()
    .toBuffer();
function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-site-pictures-"));
  dirs.push(dir);
  const ctx = createTestContext();
  const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = userActor(insertUser(ctx));
  const upload = async (actor: typeof admin, purpose: string) =>
    (await storage.upload(actor, stream(await png()), "image/png", purpose as never)).id;
  const update = (actor: typeof admin, input: object) =>
    execute(ctx, getOperation("settings.update"), actor, input);
  const site = () =>
    execute(ctx, getOperation("site.get"), GUEST, {}) as Promise<{
      logo: { fileId: number; url: string } | null;
      icon: { fileId: number } | null;
      backdrop: { fileId: number } | null;
    }>;
  return { ctx, admin, member, upload, update, site };
}

const deletionQueued = (ctx: Ctx, fileId: number) =>
  !!ctx.sqlite
    .prepare("SELECT 1 FROM jobs WHERE unique_key = ?1")
    .get(`storage.deletePermanent.${fileId}`);
const visibility = (ctx: Ctx, fileId: number) =>
  ctx.sqlite
    .prepare<{ visibility: string }, [number]>("SELECT visibility FROM files WHERE id = ?1")
    .get(fileId)!.visibility;

describe("the site's own pictures", () => {
  for (const [key, purpose, field] of [
    ["logoFileId", "site_logo", "logo"],
    ["iconFileId", "site_icon", "icon"],
    ["backdropFileId", "site_backdrop", "backdrop"],
  ] as const)
    test(`${key}: set, keep, replace and remove`, async () => {
      const { ctx, admin, upload, update, site } = await setup();
      expect(readSiteSettings(ctx)[key]).toBeNull();
      const first = await upload(admin, purpose);
      expect((await update(admin, { [key]: first }))[key as "logoFileId"]).toBe(first);
      expect(visibility(ctx, first)).toBe("public");
      expect((await site())[field]).toEqual({ fileId: first, url: `/api/v1/files/${first}` });
      // Saving the same id again changes nothing and deletes nothing.
      await update(admin, { [key]: first, siteName: "Renamed" });
      expect(deletionQueued(ctx, first)).toBe(false);
      expect(readSiteSettings(ctx)[key]).toBe(first);
      // A new file replaces it and the old one goes away.
      const second = await upload(admin, purpose);
      await update(admin, { [key]: second });
      expect(deletionQueued(ctx, first)).toBe(true);
      expect((await site())[field]?.fileId).toBe(second);
      // null removes it.
      await update(admin, { [key]: null });
      expect(deletionQueued(ctx, second)).toBe(true);
      expect((await site())[field]).toBeNull();
      expect(readSiteSettings(ctx)[key]).toBeNull();
    });

  test("an update that does not name a picture leaves it alone", async () => {
    const { ctx, admin, upload, update, site } = await setup();
    const logo = await upload(admin, "site_logo");
    const icon = await upload(admin, "site_icon");
    await update(admin, { logoFileId: logo, iconFileId: icon });
    await update(admin, { siteName: "Renamed" });
    await update(admin, { backdropFileId: null });
    expect(readSiteSettings(ctx)).toMatchObject({ logoFileId: logo, iconFileId: icon });
    expect(deletionQueued(ctx, logo)).toBe(false);
    expect(deletionQueued(ctx, icon)).toBe(false);
    expect((await site()).logo?.fileId).toBe(logo);
  });

  test("the file must be the actor's own unattached upload of the matching purpose", async () => {
    const { ctx, admin, upload, update } = await setup();
    const logo = await upload(admin, "site_logo");
    await expect(update(admin, { iconFileId: logo })).rejects.toBeInstanceOf(NotFoundError);
    await expect(update(admin, { logoFileId: 9999 })).rejects.toBeInstanceOf(NotFoundError);
    const otherAdmin = userActor(insertUser(ctx, { groupId: 4 }));
    await expect(update(otherAdmin, { logoFileId: logo })).rejects.toBeInstanceOf(NotFoundError);
    // A failed change leaves everything as it was, including the other keys of the request.
    await expect(update(admin, { siteName: "Nope", iconFileId: logo })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(readSiteSettings(ctx).siteName).toBe("Sermo");
    expect(visibility(ctx, logo)).toBe("unattached");
    await update(admin, { logoFileId: logo });
    await expect(update(admin, { backdropFileId: logo })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("only settings administrators change them", async () => {
    const { admin, member, upload, update } = await setup();
    const logo = await upload(admin, "site_logo");
    await expect(update(GUEST, { logoFileId: logo })).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(update(member, { logoFileId: logo })).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("settings stored before the pictures existed still parse", async () => {
    const { ctx, admin, update } = await setup();
    const stored = {
      maxUploadBytes: 1024,
      allowedUploadTypes: {
        attachment: ["image/png"],
        avatar: ["image/png"],
        cover: ["image/png"],
        node_icon: ["image/png"],
        node_cover: ["image/png"],
      },
      firstPostsToModerate: 2,
      moderateLinksFromNewMembers: false,
      newMemberDays: 7,
      warningBanThreshold: 0,
      warningBanDays: 7,
      threadTitleTemplate: "{title} | {site}",
      nodeTitleTemplate: "{title} | {site}",
      profileTitleTemplate: "{username} | {site}",
      indexNowKey: null,
      siteName: "Old site",
      defaultLanguage: "en",
      newMemberMentionLimit: 3,
      profilePostsEnabled: true,
      notificationRetentionDays: 90,
      notificationDefaults: {},
      emailHourlyCap: 20,
      conversationEmailIncludesBody: false,
      digestInactiveDays: 3,
    };
    ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(stored));
    expect(readSiteSettings(ctx)).toMatchObject({
      siteName: "Old site",
      logoFileId: null,
      iconFileId: null,
      backdropFileId: null,
    });
    const got = await execute(ctx, getOperation("settings.get"), admin, {});
    expect(got.logoFileId).toBeNull();
    const site = (await execute(ctx, getOperation("site.get"), GUEST, {})) as { name: string };
    expect(site.name).toBe("Old site");
    await update(admin, { siteName: "New site" });
    expect(readSiteSettings(ctx)).toMatchObject({ siteName: "New site", logoFileId: null });
  });
});
