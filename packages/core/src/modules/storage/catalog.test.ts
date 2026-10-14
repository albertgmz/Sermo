import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp, { type Sharp } from "sharp";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { CATALOG_FILE_PURPOSES } from "../../db/schema";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { createStorage, localDriver } from "./index";

sharp.cache(false);

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** A picture with a transparent left half, so that alpha is observable in the results. */
function picture(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set([220, 40, 40, x < width / 2 ? 0 : 255], (y * width + x) * 4);
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

// The GIF every decoder knows: one white pixel.
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-catalog-files-"));
  dirs.push(dir);
  const ctx = createTestContext();
  const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const memberRow = insertUser(ctx);
  const moderatorRow = insertUser(ctx, { groupId: 3 });
  return {
    dir,
    ctx,
    storage,
    admin,
    memberRow,
    moderatorRow,
    member: userActor(memberRow),
    moderator: userActor(moderatorRow),
  };
}

const files = (ctx: Ctx, id: number) =>
  ctx.sqlite
    .prepare<
      {
        id: number;
        variant: string | null;
        content_type: string;
        width: number;
        height: number;
        storage_key: string;
      },
      [number]
    >(
      "SELECT id, variant, content_type, width, height, storage_key FROM files WHERE id = ?1 OR parent_file_id = ?1 ORDER BY parent_file_id IS NOT NULL, variant",
    )
    .all(id);

// Reaction pictures are stored unscaled and refuse large input: their own tests are below.
const SCALED_PURPOSES = CATALOG_FILE_PURPOSES.filter((purpose) => purpose !== "reaction_image");

describe("catalog uploads are renditions of the right size", () => {
  const expectations: Record<
    (typeof SCALED_PURPOSES)[number],
    { type: string; box: [number, number]; variants: [string, [number, number]][] }
  > = {
    frame: { type: "image/webp", box: [512, 512], variants: [["frame_256", [256, 256]]] },
    cover_preset: { type: "image/webp", box: [1600, 600], variants: [["cover_small", [800, 300]]] },
    thread_cover: { type: "image/webp", box: [1600, 600], variants: [["cover_small", [800, 300]]] },
    award_image: { type: "image/webp", box: [960, 540], variants: [["art_small", [480, 270]]] },
    shop_image: { type: "image/webp", box: [960, 540], variants: [["art_small", [480, 270]]] },
    site_logo: { type: "image/webp", box: [640, 160], variants: [] },
    site_icon: {
      type: "image/png",
      box: [512, 512],
      variants: [
        ["icon_192", [192, 192]],
        ["icon_48", [48, 48]],
      ],
    },
    site_backdrop: {
      type: "image/webp",
      box: [2560, 1440],
      variants: [["backdrop_small", [1280, 720]]],
    },
  };

  for (const purpose of SCALED_PURPOSES)
    test(purpose, async () => {
      const { ctx, storage, admin } = await setup();
      const expected = expectations[purpose];
      const upload = await storage.upload(
        admin,
        stream(await picture(3000, 1600)),
        "image/png",
        purpose,
      );
      expect(upload.contentType).toBe(expected.type);
      const rows = files(ctx, upload.id);
      const [main, ...variants] = rows;
      expect(main!.content_type).toBe(expected.type);
      if (purpose === "site_icon") expect([main!.width, main!.height]).toEqual([512, 512]);
      else {
        expect(main!.width).toBeLessThanOrEqual(expected.box[0]);
        expect(main!.height).toBeLessThanOrEqual(expected.box[1]);
        // Fit inside keeps the proportions: 3000x1600 is limited by one side.
        expect(main!.width === expected.box[0] || main!.height === expected.box[1]).toBe(true);
      }
      expect(variants.map((variant) => variant.variant)).toEqual(
        expected.variants.map(([name]) => name).sort(),
      );
      for (const variant of variants) {
        const [, box] = expected.variants.find(([name]) => name === variant.variant)!;
        expect(variant.content_type).toBe(expected.type);
        expect(variant.width).toBeLessThanOrEqual(box[0]);
        expect(variant.height).toBeLessThanOrEqual(box[1]);
      }
      // Re-encoded pixels keep their transparency (except where the format has none to give).
      const stored = sharp(await storage.download(admin, upload.id));
      expect((await stored.metadata()).hasAlpha).toBe(true);
      const { data, info } = await sharp(await storage.download(admin, upload.id))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(data[3]).toBe(0);
      expect(data[(info.width - 1) * 4 + 3]).toBe(255);
    });

  test("a frame keeps its opening in meta; the other purposes keep none", async () => {
    const { ctx, storage, admin } = await setup();
    const fixture = await readFile(
      join(import.meta.dir, "..", "images", "fixtures", "frames", "598.png"),
    );
    const frame = await storage.upload(admin, stream(fixture), "image/png", "frame");
    const meta = ctx.sqlite
      .prepare<{ meta: string | null }, [number]>("SELECT meta FROM files WHERE id = ?1")
      .get(frame.id)!.meta;
    const { opening } = JSON.parse(meta!);
    expect(opening.radius).toBeGreaterThan(0);
    expect(opening.centerX).toBeGreaterThan(0.3);
    expect(opening.centerX).toBeLessThan(0.7);
    // A picture with no opening records null.
    const flat = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const opaque = await storage.upload(admin, stream(flat), "image/png", "frame");
    expect(
      JSON.parse(
        ctx.sqlite
          .prepare<{ meta: string }, [number]>("SELECT meta FROM files WHERE id = ?1")
          .get(opaque.id)!.meta,
      ),
    ).toEqual({ opening: null });
    const cover = await storage.upload(admin, stream(flat), "image/png", "thread_cover");
    expect(
      ctx.sqlite
        .prepare<{ meta: string | null }, [number]>("SELECT meta FROM files WHERE id = ?1")
        .get(cover.id)!.meta,
    ).toBeNull();
  });
});

describe("who may upload what", () => {
  const permissionOf: Record<(typeof CATALOG_FILE_PURPOSES)[number], string> = {
    frame: "admin.appearance",
    cover_preset: "admin.appearance",
    thread_cover: "admin.appearance",
    award_image: "admin.awards",
    shop_image: "admin.shop",
    site_logo: "admin.settings",
    site_icon: "admin.settings",
    site_backdrop: "admin.settings",
    reaction_image: "admin.reactionTypes",
  };

  test("guests, members and moderators are refused; administrators may", async () => {
    const { ctx, storage, admin, member, moderator, memberRow, moderatorRow } = await setup();
    const bytes = await picture(40, 40);
    for (const purpose of CATALOG_FILE_PURPOSES) {
      await expect(
        storage.upload(GUEST, stream(bytes), "image/png", purpose),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      for (const actor of [member, moderator])
        await expect(
          storage.upload(actor, stream(bytes), "image/png", purpose),
        ).rejects.toBeInstanceOf(ForbiddenError);
      await storage.upload(admin, stream(bytes), "image/png", purpose);
    }
    // Nothing the refused uploads sent was stored.
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number, number]>(
          "SELECT COUNT(*) AS n FROM files WHERE uploader_id IN (?1, ?2)",
        )
        .get(memberRow.id, moderatorRow.id)!.n,
    ).toBe(0);
  });

  test("each purpose needs exactly its own permission", async () => {
    const { ctx, storage } = await setup();
    const bytes = await picture(40, 40);
    const definitions = [
      "admin.appearance",
      "admin.awards",
      "admin.shop",
      "admin.settings",
      "admin.reactionTypes",
    ];
    for (const holding of definitions) {
      const group = ctx.sqlite
        .prepare<{ id: number }, [string]>(
          "INSERT INTO groups (title, rank) VALUES (?1, 10) RETURNING id",
        )
        .get(`Holds ${holding}`)!.id;
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = ?2",
        )
        .run(group, holding);
      const actor = userActor(insertUser(ctx, { groupId: group }));
      for (const purpose of CATALOG_FILE_PURPOSES) {
        const attempt = storage.upload(actor, stream(bytes), "image/png", purpose);
        if (permissionOf[purpose] === holding) await attempt;
        else await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      }
    }
  });

  test("only JPEG, PNG and WebP are accepted, whatever the member settings say", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-catalog-types-"));
    dirs.push(dir);
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const storage = createStorage(ctx, {
      driver: localDriver(join(dir, "files")),
      tempDir: dir,
      allowedTypesByPurpose: { avatar: ["image/gif"] },
    });
    for (const purpose of CATALOG_FILE_PURPOSES)
      await expect(storage.upload(admin, stream(gif), "image/gif", purpose)).rejects.toBeInstanceOf(
        ValidationError,
      );
    // Member purposes still follow the settings; catalog purposes ignore a settings list's absence.
    await storage.upload(admin, stream(gif), "image/gif", "avatar");
    const webp = await sharp(await picture(30, 30))
      .webp()
      .toBuffer();
    const jpeg = await sharp(await picture(30, 30))
      .flatten()
      .jpeg()
      .toBuffer();
    await storage.upload(admin, stream(webp), "image/webp", "frame");
    await storage.upload(admin, stream(jpeg), "image/jpeg", "site_backdrop");
  });
});

describe("reaction pictures", () => {
  /** A sheet of distinct pixels: any rescaling or shifting shows. */
  const sheet = (width: number, height: number) => {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++)
      pixels.set([i % 251, (i * 7) % 253, i % 13, 255], i * 4);
    return { pixels, raw: { raw: { width, height, channels: 4 as const } } };
  };

  test("png and webp are stored as given, without any rescaling", async () => {
    const { ctx, storage, admin } = await setup();
    const { pixels, raw } = sheet(96, 32);
    for (const [type, encode] of [
      ["image/png", (input: Sharp) => input.png().toBuffer()],
      ["image/webp", (input: Sharp) => input.webp({ lossless: true }).toBuffer()],
    ] as const) {
      const upload = await storage.upload(
        admin,
        stream(await encode(sharp(pixels, raw))),
        type,
        "reaction_image",
      );
      const rows = files(ctx, upload.id);
      expect(rows).toHaveLength(1);
      expect([rows[0]!.width, rows[0]!.height]).toEqual([96, 32]);
      const stored = await sharp(await storage.download(admin, upload.id))
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(stored.equals(pixels)).toBe(true);
    }
  });

  test("a picture at the limit passes and one pixel more is refused", async () => {
    const { storage, admin } = await setup();
    const flat = (width: number, height: number) =>
      sharp({
        create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
      })
        .png()
        .toBuffer();
    const upload = await storage.upload(
      admin,
      stream(await flat(2048, 16)),
      "image/png",
      "reaction_image",
    );
    expect(upload.id).toBeGreaterThan(0);
    for (const [width, height] of [
      [2049, 16],
      [16, 2049],
    ] as const)
      await expect(
        storage.upload(admin, stream(await flat(width, height)), "image/png", "reaction_image"),
      ).rejects.toBeInstanceOf(ValidationError);
  });

  test("jpeg, gif and animated images are refused", async () => {
    const { storage, admin } = await setup();
    const jpeg = await sharp(await picture(30, 30))
      .flatten()
      .jpeg()
      .toBuffer();
    await expect(
      storage.upload(admin, stream(jpeg), "image/jpeg", "reaction_image"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      storage.upload(admin, stream(gif), "image/gif", "reaction_image"),
    ).rejects.toBeInstanceOf(ValidationError);
    const { pixels } = sheet(16, 32);
    const animated = await sharp(pixels, {
      raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
    })
      .webp()
      .toBuffer();
    expect((await sharp(animated, { pages: -1 }).metadata()).pages).toBe(2);
    await expect(
      storage.upload(admin, stream(animated), "image/webp", "reaction_image"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("storage quota", () => {
  test("catalog files neither need nor use the uploader's attachment quota", async () => {
    const { ctx, storage } = await setup();
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Curators', 10) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.appearance'",
      )
      .run(group);
    // Room for one 60-byte attachment, less than any picture.
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 100 FROM permission_definitions WHERE key = 'attachment.storageQuota'",
      )
      .run(group);
    const curatorRow = insertUser(ctx, { groupId: group });
    const curator = userActor(curatorRow);
    const text = (n: number) => stream(Buffer.from("x".repeat(n)));
    const picture1 = await storage.upload(
      curator,
      stream(await picture(300, 300)),
      "image/png",
      "frame",
    );
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT SUM(byte_size) AS n FROM files WHERE uploader_id = ?1",
        )
        .get(curatorRow.id)!.n,
    ).toBeGreaterThan(100);
    expect(picture1.id).toBeGreaterThan(0);
    // The attachment headroom is untouched: 60 bytes fit, a second 60 do not.
    await storage.upload(curator, text(60), "text/plain");
    await expect(storage.upload(curator, text(60), "text/plain")).rejects.toThrow(/quota/);
    // More catalog pictures still go in with the attachment quota used up.
    await storage.upload(curator, stream(await picture(300, 300)), "image/png", "thread_cover");
  });

  test("a member at the quota is unaffected", async () => {
    const { ctx, storage, member } = await setup();
    ctx.sqlite
      .prepare(
        "UPDATE permission_entries SET value = 100 WHERE group_id = 2 AND user_id = 0 AND node_id = 0 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'attachment.storageQuota')",
      )
      .run();
    await storage.upload(member, stream(Buffer.from("x".repeat(60))), "text/plain");
    await expect(
      storage.upload(member, stream(Buffer.from("x".repeat(60))), "text/plain"),
    ).rejects.toThrow(/quota/);
    await expect(
      storage.upload(member, stream(await picture(20, 20)), "image/png", "frame"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("serving", () => {
  test("an attached catalog file is immutable; an avatar keeps its one hour", async () => {
    const { ctx, storage, admin, member } = await setup();
    const bytes = await picture(80, 80);
    const frame = await storage.upload(admin, stream(bytes), "image/png", "frame");
    const avatar = await storage.upload(member, stream(bytes), "image/png", "avatar");
    // Not attached yet: only the uploader sees it, and it is not cached.
    expect(() => storage.serve(GUEST, frame.id)).toThrow(NotFoundError);
    expect(storage.serve(admin, frame.id).headers.get("cache-control")).toBe("private, no-store");
    ctx.sqlite
      .prepare("UPDATE files SET visibility = 'public', attached_at = ?1 WHERE id IN (?2, ?3)")
      .run(ctx.now(), frame.id, avatar.id);
    ctx.sqlite
      .prepare(
        "UPDATE files SET visibility = 'public', attached_at = ?1 WHERE parent_file_id IN (?2, ?3)",
      )
      .run(ctx.now(), frame.id, avatar.id);
    const served = storage.serve(GUEST, frame.id);
    expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(served.headers.get("content-type")).toBe("image/webp");
    const variant = ctx.sqlite
      .prepare<{ id: number }, [number]>("SELECT id FROM files WHERE parent_file_id = ?1")
      .get(frame.id)!;
    expect(storage.serve(GUEST, variant.id).headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(storage.serve(GUEST, avatar.id).headers.get("cache-control")).toBe(
      "public, max-age=3600",
    );
  });
});
