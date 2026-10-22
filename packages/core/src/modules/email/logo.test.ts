import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { readSiteSettings } from "../settings";
import { createStorage, localDriver } from "../storage";
import { ensureMailLogo, rememberStorage } from "../storage/mail-logo";
import { siteBranding } from "./branding";

sharp.cache(false);

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A transparent canvas with one opaque red block: the shape of a logo drawn without a background. */
const transparentLogo = () =>
  sharp({
    create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: { create: { width: 100, height: 60, channels: 4, background: "#d02020" } },
        left: 20,
        top: 20,
      },
    ])
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

test("the mail shows the site's transparent logo as a PNG that keeps its transparency", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-mail-logo-"));
  dirs.push(dir);
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const logo = (
    await storage.upload(admin, stream(await transparentLogo()), "image/png", "site_logo")
  ).id;
  await execute(ctx, getOperation("settings.update"), admin, { logoFileId: logo });

  const url = siteBranding(ctx, readSiteSettings(ctx)).logoUrl!;
  const fileId = Number(url.split("/").pop());
  expect(fileId).not.toBe(logo);

  const served = storage.serve(GUEST, fileId, new Headers());
  expect(served.headers.get("content-type")).toBe("image/png");
  const { data, info } = await sharp(Buffer.from(await served.arrayBuffer()))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  const pixel = (x: number, y: number) => [
    ...data.subarray((y * info.width + x) * 4).subarray(0, 4),
  ];
  // The corner is transparent, not opaque black; the block keeps its colour.
  expect(pixel(1, 1)[3]).toBe(0);
  expect(pixel(Math.round(info.width / 2) - 40, Math.round(info.height / 2))).toEqual([
    208, 32, 32, 255,
  ]);
});

test("a logo stored before the PNG copy existed gets one on first use, and later mails reuse it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-mail-logo-"));
  dirs.push(dir);
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  const config = { driver: localDriver(join(dir, "files")), tempDir: dir };
  const storage = createStorage(ctx, config);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const logo = (
    await storage.upload(admin, stream(await transparentLogo()), "image/png", "site_logo")
  ).id;
  await execute(ctx, getOperation("settings.update"), admin, { logoFileId: logo });
  // As stored by an earlier version: the WebP alone.
  ctx.sqlite.prepare("DELETE FROM files WHERE parent_file_id = ?1").run(logo);
  const settings = readSiteSettings(ctx);
  expect(siteBranding(ctx, settings).logoUrl).toBe(
    `https://forum.example.test/api/v1/files/${logo}`,
  );
  const copies = () =>
    ctx.sqlite
      .prepare<{ id: number; content_type: string; visibility: string }, [number]>(
        "SELECT id, content_type, visibility FROM files WHERE parent_file_id = ?1 AND variant = 'mail_logo'",
      )
      .all(logo);

  rememberStorage(ctx, config);
  await Promise.all([ensureMailLogo(ctx, logo), ensureMailLogo(ctx, logo)]);
  const [copy, ...more] = copies();
  expect(more).toEqual([]);
  expect(copy).toMatchObject({ content_type: "image/png", visibility: "public" });
  expect(siteBranding(ctx, settings).logoUrl).toBe(
    `https://forum.example.test/api/v1/files/${copy!.id}`,
  );
  await ensureMailLogo(ctx, logo);
  expect(copies().map((row) => row.id)).toEqual([copy!.id]);
});

test("a logo whose bytes cannot be read stays as stored, and the failure is logged once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-mail-logo-"));
  dirs.push(dir);
  const ctx = createTestContext();
  const config = { driver: localDriver(join(dir, "files")), tempDir: dir };
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const logo = (
    await createStorage(ctx, config).upload(
      admin,
      stream(await transparentLogo()),
      "image/png",
      "site_logo",
    )
  ).id;
  ctx.sqlite.prepare("DELETE FROM files WHERE parent_file_id = ?1").run(logo);
  await rm(join(dir, "files"), { recursive: true, force: true });
  rememberStorage(ctx, config);
  const logged = spyOn(console, "error").mockImplementation(() => {});
  await ensureMailLogo(ctx, logo);
  await ensureMailLogo(ctx, logo);
  expect(logged).toHaveBeenCalledTimes(1);
  logged.mockRestore();
});
