import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { invalidate } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { frameGeometry } from "../images/frame-geometry";
import { createStorage, localDriver } from "../storage";
import { catalogImageById, paletteColorById } from "./index";
import { catalogs, inUseSql } from "./store";

sharp.cache(false);

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const run = (
  ctx: Ctx,
  name: string,
  actor: Parameters<typeof execute>[2],
  input: object,
): Promise<unknown> => execute(ctx, getOperation(name), actor, input);

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** An opaque picture: a frame made from it has no opening. */
const solid = (width = 64, height = 48) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
    .png()
    .toBuffer();
const frameFixture = () =>
  readFile(join(import.meta.dir, "..", "images", "fixtures", "frames", "598.png"));

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-appearance-"));
  dirs.push(dir);
  const ctx = createTestContext();
  const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = userActor(insertUser(ctx));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  // Holds another administrator permission, but not admin.appearance.
  const group = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Award team', 10) RETURNING id",
    )
    .get()!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.awards'",
    )
    .run(group);
  const awardsOnly = userActor(insertUser(ctx, { groupId: group }));
  const upload = (actor: typeof admin, purpose: string, bytes: Uint8Array) =>
    storage.upload(actor, stream(bytes), "image/png", purpose as never);
  return { ctx, storage, admin, member, moderator, awardsOnly, upload };
}

type CatalogKind = "frame" | "profile_cover" | "thread_cover";
const addImage = async (
  s: Awaited<ReturnType<typeof setup>>,
  kind: CatalogKind,
  extra: object = {},
) => {
  const purpose = { frame: "frame", profile_cover: "cover_preset", thread_cover: "thread_cover" }[
    kind
  ];
  const file = await s.upload(s.admin, purpose, await solid());
  return (await run(s.ctx, "catalogImages.create", s.admin, {
    kind,
    name: `${kind} one`,
    fileId: file.id,
    ...(kind === "frame" ? { placement: { width: 150, left: -25, top: -25, scale: 90 } } : {}),
    ...extra,
  })) as { id: number; image: { fileId: number } | null; isActive: boolean };
};

const row = <T>(ctx: Ctx, sql: string, ...params: (number | string)[]) =>
  ctx.sqlite.prepare<T, (number | string)[]>(sql).get(...params);

describe("the seeded palette", () => {
  test("a new site holds the default palette, readable by guests", async () => {
    const { ctx } = await setup();
    expect(row<{ n: number }>(ctx, "SELECT COUNT(*) AS n FROM palette_colors")!.n).toBe(25);
    const names = await run(ctx, "paletteColors.list", GUEST, { kind: "name" });
    expect((names as { items: unknown[] }).items).toHaveLength(11);
    const site = (await run(ctx, "site.get", GUEST, {})) as {
      name: string;
      logo: null;
      palette: {
        accents: { name: string; color: string; foreground: string }[];
        nameColors: unknown[];
        prefixColors: unknown[];
      };
    };
    expect(site.name).toBe("Sermo");
    expect(site.logo).toBeNull();
    expect(site.palette.accents.map((color) => color.name)).toEqual([
      "Red",
      "Orange",
      "Amber",
      "Emerald",
      "Sky",
      "Violet",
    ]);
    expect(site.palette.accents[5]).toMatchObject({ color: "#8452f6", foreground: "#ffffff" });
    expect(site.palette.nameColors).toHaveLength(11);
    expect(site.palette.prefixColors).toHaveLength(8);
  });
});

describe("write permissions", () => {
  test("only admin.appearance changes the catalogs", async () => {
    const s = await setup();
    const writes: [string, object][] = [
      ["catalogImages.create", { kind: "frame", name: "x", fileId: 1 }],
      ["catalogImages.update", { imageId: 1, name: "y" }],
      ["catalogImages.delete", { imageId: 1 }],
      ["paletteColors.create", { kind: "name", name: "x", color: "#112233" }],
      ["paletteColors.update", { colorId: 1, name: "y" }],
      ["paletteColors.delete", { colorId: 1 }],
    ];
    for (const [name, input] of writes) {
      await expect(run(s.ctx, name, GUEST, input)).rejects.toBeInstanceOf(UnauthenticatedError);
      for (const actor of [s.member, s.moderator, s.awardsOnly])
        await expect(run(s.ctx, name, actor, input)).rejects.toBeInstanceOf(ForbiddenError);
    }
    // The administrator group passes the check (and then meets the missing target).
    await expect(
      run(s.ctx, "catalogImages.delete", s.admin, { imageId: 99 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const created = (await run(s.ctx, "paletteColors.create", s.admin, {
      kind: "name",
      name: "Teal",
      color: "#008080",
    })) as { id: number };
    expect(created.id).toBeGreaterThan(25);
  });

  test("every write is logged for moderators", async () => {
    const s = await setup();
    const created = (await run(s.ctx, "paletteColors.create", s.admin, {
      kind: "prefix",
      name: "Teal",
      color: "#008080",
    })) as { id: number };
    await run(s.ctx, "paletteColors.update", s.admin, { colorId: created.id, name: "Dark teal" });
    await run(s.ctx, "paletteColors.delete", s.admin, { colorId: created.id });
    const image = await addImage(s, "thread_cover");
    await run(s.ctx, "catalogImages.update", s.admin, { imageId: image.id, name: "Renamed" });
    await run(s.ctx, "catalogImages.delete", s.admin, { imageId: image.id });
    const actions = s.ctx.sqlite
      .prepare<{ action: string }, []>("SELECT action FROM moderator_log ORDER BY id")
      .all()
      .map((entry) => entry.action);
    expect(actions).toEqual([
      "appearance.color.create",
      "appearance.color.update",
      "appearance.color.delete",
      "appearance.image.create",
      "appearance.image.update",
      "appearance.image.delete",
    ]);
  });
});

describe("palette colours", () => {
  test("an accent needs a foreground and the other kinds take none", async () => {
    const { ctx, admin } = await setup();
    await expect(
      run(ctx, "paletteColors.create", admin, { kind: "accent", name: "A", color: "#112233" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(ctx, "paletteColors.create", admin, {
        kind: "name",
        name: "A",
        color: "#112233",
        foreground: "#ffffff",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const accent = (await run(ctx, "paletteColors.create", admin, {
      kind: "accent",
      name: "Mint",
      color: "#AABBCC",
      foreground: "#000000",
    })) as { id: number; color: string; foreground: string };
    expect(accent.color).toBe("#aabbcc");
    await expect(
      run(ctx, "paletteColors.update", admin, { colorId: 12, foreground: "#000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const updated = (await run(ctx, "paletteColors.update", admin, {
      colorId: accent.id,
      foreground: "#111111",
      position: 3,
    })) as { foreground: string; position: number; color: string };
    expect(updated).toMatchObject({ foreground: "#111111", position: 3, color: "#aabbcc" });
  });

  test("lists hide inactive colours from everyone but administrators, in order", async () => {
    const { ctx, admin, member } = await setup();
    const first = (await run(ctx, "paletteColors.create", admin, {
      kind: "prefix",
      name: "Early",
      color: "#010101",
      position: 0,
      isActive: false,
    })) as { id: number };
    const guestView = (await run(ctx, "paletteColors.list", GUEST, { kind: "prefix" })) as {
      items: { id: number }[];
    };
    const adminView = (await run(ctx, "paletteColors.list", admin, { kind: "prefix" })) as {
      items: { id: number }[];
    };
    expect(guestView.items).toHaveLength(8);
    expect(adminView.items).toHaveLength(9);
    // Position 0 ties are broken by id: after the seeded colour at position 0, before position 1.
    expect(adminView.items[1]!.id).toBe(first.id);
    expect(
      ((await run(ctx, "paletteColors.list", member, { kind: "prefix" })) as { items: unknown[] })
        .items,
    ).toHaveLength(8);
  });

  test("delete removes an unused colour and deactivates one in use", async () => {
    const { ctx, admin } = await setup();
    const member = insertUser(ctx);
    const color = async (kind: "accent" | "name" | "prefix") =>
      (
        (await run(ctx, "paletteColors.create", admin, {
          kind,
          name: `Temp ${kind}`,
          color: "#123456",
          ...(kind === "accent" ? { foreground: "#ffffff" } : {}),
        })) as { id: number }
      ).id;
    for (const [kind, column] of [
      ["accent", "accent_color_id"],
      ["name", "name_color_id"],
    ] as const) {
      const id = await color(kind);
      ctx.sqlite.prepare(`UPDATE users SET ${column} = ?1 WHERE id = ?2`).run(id, member.id);
      expect(await run(ctx, "paletteColors.delete", admin, { colorId: id })).toEqual({
        ok: true,
        deactivated: true,
      });
      expect(paletteColorById(ctx, id)?.isActive).toBe(false);
      ctx.sqlite.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?1`).run(member.id);
      expect(await run(ctx, "paletteColors.delete", admin, { colorId: id })).toEqual({
        ok: true,
        deactivated: false,
      });
      expect(paletteColorById(ctx, id)).toBeNull();
    }
    // Nothing refers to a prefix colour yet.
    const prefix = await color("prefix");
    expect(await run(ctx, "paletteColors.delete", admin, { colorId: prefix })).toEqual({
      ok: true,
      deactivated: false,
    });
    await expect(
      run(ctx, "paletteColors.delete", admin, { colorId: prefix }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a catalog holds at most 500 entries", async () => {
    const { ctx, admin } = await setup();
    const insert = ctx.sqlite.prepare(
      "INSERT INTO palette_colors (kind, name, color, position, is_active, created_at, updated_at) VALUES ('prefix', 'p', '#000000', 0, 1, 0, 0)",
    );
    for (let i = 0; i < 500 - 8; i++) insert.run();
    await expect(
      run(ctx, "paletteColors.create", admin, { kind: "prefix", name: "x", color: "#000000" }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Another kind has its own room.
    await run(ctx, "paletteColors.create", admin, { kind: "name", name: "x", color: "#000000" });
  });
});

describe("catalog pictures", () => {
  test("a frame takes the placement measured at upload", async () => {
    const s = await setup();
    const file = await s.upload(s.admin, "frame", await frameFixture());
    const meta = row<{ meta: string; width: number; height: number }>(
      s.ctx,
      "SELECT meta, width, height FROM files WHERE id = ?1",
      file.id,
    )!;
    const { opening } = JSON.parse(meta.meta);
    expect(opening).not.toBeNull();
    const created = (await run(s.ctx, "catalogImages.create", s.admin, {
      kind: "frame",
      name: "Gold ring",
      fileId: file.id,
    })) as {
      placement: unknown;
      image: { fileId: number; url: string };
      isActive: boolean;
    };
    expect(created.placement).toEqual(frameGeometry(opening, meta.width, meta.height));
    expect(created.image).toEqual({ fileId: file.id, url: `/api/v1/files/${file.id}` });
    expect(created.isActive).toBe(true);
    // The file and its variant are public now, and a second catalog entry cannot reuse the file.
    expect(
      row<{ n: number }>(
        s.ctx,
        "SELECT COUNT(*) AS n FROM files WHERE (id = ?1 OR parent_file_id = ?1) AND visibility = 'public' AND attached_at IS NOT NULL",
        file.id,
      )!.n,
    ).toBe(2);
    await expect(
      run(s.ctx, "catalogImages.create", s.admin, {
        kind: "frame",
        name: "Again",
        fileId: file.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("an explicit placement wins, and a frame without an opening needs one", async () => {
    const s = await setup();
    const opaque = await s.upload(s.admin, "frame", await solid());
    await expect(
      run(s.ctx, "catalogImages.create", s.admin, {
        kind: "frame",
        name: "Flat",
        fileId: opaque.id,
      }),
    ).rejects.toThrow(/opening could not be measured/);
    // The failed create attached nothing.
    expect(
      row<{ visibility: string }>(s.ctx, "SELECT visibility FROM files WHERE id = ?1", opaque.id)!
        .visibility,
    ).toBe("unattached");
    const placement = { width: 120, left: -10, top: -10, scale: 80 };
    const created = (await run(s.ctx, "catalogImages.create", s.admin, {
      kind: "frame",
      name: "Flat",
      fileId: opaque.id,
      placement,
    })) as { placement: unknown };
    expect(created.placement).toEqual(placement);
  });

  test("only a frame has a placement; the file must be the right unattached upload of the actor", async () => {
    const s = await setup();
    const cover = await s.upload(s.admin, "cover_preset", await solid());
    await expect(
      run(s.ctx, "catalogImages.create", s.admin, {
        kind: "profile_cover",
        name: "c",
        fileId: cover.id,
        placement: { width: 100, left: 0, top: 0, scale: 100 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // A thread-cover file does not fit a profile-cover entry.
    const wrong = await s.upload(s.admin, "thread_cover", await solid());
    await expect(
      run(s.ctx, "catalogImages.create", s.admin, {
        kind: "profile_cover",
        name: "c",
        fileId: wrong.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Another administrator's upload.
    const otherAdmin = userActor(insertUser(s.ctx, { groupId: 4 }));
    await expect(
      run(s.ctx, "catalogImages.create", otherAdmin, {
        kind: "profile_cover",
        name: "c",
        fileId: cover.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // A variant is not a main file.
    const variant = row<{ id: number }>(
      s.ctx,
      "SELECT id FROM files WHERE parent_file_id = ?1",
      cover.id,
    )!;
    await expect(
      run(s.ctx, "catalogImages.create", s.admin, {
        kind: "profile_cover",
        name: "c",
        fileId: variant.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const created = (await run(s.ctx, "catalogImages.create", s.admin, {
      kind: "profile_cover",
      name: "Dusk",
      fileId: cover.id,
    })) as { placement: unknown };
    expect(created.placement).toBeNull();
  });

  test("lists show a guest only active pictures, in order, and the cache follows every write", async () => {
    const s = await setup();
    const list = async (actor: typeof s.admin, kind = "thread_cover") =>
      (
        (await run(s.ctx, "catalogImages.list", actor, { kind })) as {
          items: { id: number; name: string }[];
        }
      ).items;
    expect(await list(GUEST)).toEqual([]);
    const second = await addImage(s, "thread_cover", { name: "Second", position: 2 });
    const first = await addImage(s, "thread_cover", { name: "First", position: 1 });
    const hidden = await addImage(s, "thread_cover", { name: "Hidden", isActive: false });
    expect((await list(GUEST)).map((entry) => entry.name)).toEqual(["First", "Second"]);
    expect((await list(s.admin)).map((entry) => entry.name)).toEqual(["Hidden", "First", "Second"]);
    expect((await list(s.member)).map((entry) => entry.id)).toEqual([first.id, second.id]);
    // Warm reads share one cached value; a write replaces it.
    const warm = catalogs(s.ctx);
    expect(catalogs(s.ctx)).toBe(warm);
    await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: hidden.id,
      isActive: true,
      position: 0,
    });
    expect(catalogs(s.ctx)).not.toBe(warm);
    expect((await list(GUEST)).map((entry) => entry.name)).toEqual(["Hidden", "First", "Second"]);
    expect(await list(GUEST, "frame")).toEqual([]);
    expect(catalogImageById(s.ctx, first.id)?.name).toBe("First");
    expect(catalogImageById(s.ctx, 9999)).toBeNull();
  });

  test("update renames, reorders and replaces the file, deleting the old one", async () => {
    const s = await setup();
    const image = await addImage(s, "profile_cover");
    const oldFile = image.image!.fileId;
    const next = await s.upload(s.admin, "cover_preset", await solid(100, 40));
    const updated = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: image.id,
      name: "Renamed",
      fileId: next.id,
      position: 7,
      isActive: false,
    })) as { name: string; position: number; isActive: boolean; image: { fileId: number } };
    expect(updated).toMatchObject({ name: "Renamed", position: 7, isActive: false });
    expect(updated.image.fileId).toBe(next.id);
    expect(
      row<{ payload: string }>(
        s.ctx,
        "SELECT payload FROM jobs WHERE unique_key = ?1",
        `storage.deletePermanent.${oldFile}`,
      ),
    ).not.toBeNull();
    // A file of the wrong purpose does not replace it.
    const wrong = await s.upload(s.admin, "frame", await solid());
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, { imageId: image.id, fileId: wrong.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, {
        imageId: image.id,
        placement: { width: 100, left: 0, top: 0, scale: 100 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, { imageId: 999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a cover accepts a null placement on update as no change, and still refuses a real one", async () => {
    const s = await setup();
    const image = await addImage(s, "profile_cover");
    const sent = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: image.id,
      name: "Echoed",
      placement: null,
    })) as { name: string; placement: unknown };
    expect(sent).toMatchObject({ name: "Echoed", placement: null });
    const bare = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: image.id,
      position: 3,
    })) as { placement: unknown };
    expect(bare.placement).toBeNull();
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, {
        imageId: image.id,
        placement: { width: 100, left: 0, top: 0, scale: 100 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a frame's placement can be replaced, measured again, or refused when unmeasurable", async () => {
    const s = await setup();
    const measured = await s.upload(s.admin, "frame", await frameFixture());
    const frame = (await run(s.ctx, "catalogImages.create", s.admin, {
      kind: "frame",
      name: "Ring",
      fileId: measured.id,
    })) as { id: number; placement: unknown };
    const custom = { width: 200, left: -50, top: -50, scale: 60 };
    const set = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: frame.id,
      placement: custom,
    })) as { placement: unknown };
    expect(set.placement).toEqual(custom);
    const reset = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: frame.id,
      placement: null,
    })) as { placement: unknown };
    expect(reset.placement).toEqual(frame.placement);
    // Replacing the file measures the new one.
    const opaque = await s.upload(s.admin, "frame", await solid());
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, { imageId: frame.id, fileId: opaque.id }),
    ).rejects.toThrow(/opening could not be measured/);
    const replaced = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: frame.id,
      fileId: opaque.id,
      placement: custom,
    })) as { placement: unknown };
    expect(replaced.placement).toEqual(custom);
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, { imageId: frame.id, placement: null }),
    ).rejects.toThrow(/opening could not be measured/);
  });

  test("an entry without a picture cannot be made active", async () => {
    const s = await setup();
    const image = await addImage(s, "thread_cover", { isActive: false });
    s.ctx.sqlite.prepare("UPDATE catalog_images SET file_id = NULL WHERE id = ?1").run(image.id);
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, { imageId: image.id, isActive: true }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Only administrators see an entry without a picture, even when it was left active.
    s.ctx.sqlite.prepare("UPDATE catalog_images SET is_active = 1 WHERE id = ?1").run(image.id);
    invalidate(s.ctx, "appearance");
    const view = async (actor: typeof s.admin) =>
      (
        (await run(s.ctx, "catalogImages.list", actor, { kind: "thread_cover" })) as {
          items: { image: unknown }[];
        }
      ).items;
    expect(await view(GUEST)).toHaveLength(0);
    expect((await view(s.admin))[0]!.image).toBeNull();
  });

  test("delete removes an unused picture with its file and deactivates one in use", async () => {
    const s = await setup();
    const owner = insertUser(s.ctx);
    const nodeId = insertNode(s.ctx, {}).id;
    const thread = s.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'T', 0, 0, ?2) RETURNING id",
      )
      .get(nodeId, owner.id)!.id;
    const cases: [CatalogKind, string, string, number][] = [
      [
        "frame",
        "UPDATE users SET frame_id = ?1 WHERE id = ?2",
        "UPDATE users SET frame_id = NULL WHERE id = ?1",
        owner.id,
      ],
      [
        "profile_cover",
        "UPDATE users SET cover_preset_id = ?1 WHERE id = ?2",
        "UPDATE users SET cover_preset_id = NULL WHERE id = ?1",
        owner.id,
      ],
      [
        "thread_cover",
        "UPDATE threads SET cover_id = ?1 WHERE id = ?2",
        "UPDATE threads SET cover_id = NULL WHERE id = ?1",
        thread,
      ],
    ];
    for (const [kind, assign, clear, target] of cases) {
      const image = await addImage(s, kind);
      const fileId = image.image!.fileId;
      s.ctx.sqlite.prepare(assign).run(image.id, target);
      expect(await run(s.ctx, "catalogImages.delete", s.admin, { imageId: image.id })).toEqual({
        ok: true,
        deactivated: true,
      });
      expect(catalogImageById(s.ctx, image.id)).toMatchObject({ isActive: false });
      expect(
        row(s.ctx, "SELECT 1 FROM jobs WHERE unique_key = ?1", `storage.deletePermanent.${fileId}`),
      ).toBeNull();
      expect(
        row<{ deleted_at: number | null }>(
          s.ctx,
          "SELECT deleted_at FROM files WHERE id = ?1",
          fileId,
        )!.deleted_at,
      ).toBeNull();
      s.ctx.sqlite.prepare(clear).run(target);
      expect(await run(s.ctx, "catalogImages.delete", s.admin, { imageId: image.id })).toEqual({
        ok: true,
        deactivated: false,
      });
      expect(catalogImageById(s.ctx, image.id)).toBeNull();
      expect(
        row(s.ctx, "SELECT 1 FROM jobs WHERE unique_key = ?1", `storage.deletePermanent.${fileId}`),
      ).not.toBeNull();
    }
  });

  test("a replaced picture gets a new file id and the old file is queued for deletion", async () => {
    const s = await setup();
    const image = await addImage(s, "profile_cover");
    const oldId = image.image!.fileId;
    const next = await s.upload(s.admin, "cover_preset", await solid());
    const updated = (await run(s.ctx, "catalogImages.update", s.admin, {
      imageId: image.id,
      fileId: next.id,
    })) as { image: { fileId: number; url: string } };
    expect(next.id).not.toBe(oldId);
    expect(updated.image).toEqual({ fileId: next.id, url: `/api/v1/files/${next.id}` });
    expect(
      row(s.ctx, "SELECT 1 FROM jobs WHERE unique_key = ?1", `storage.deletePermanent.${oldId}`),
    ).not.toBeNull();
    // The file already in use cannot be sent again as if it were a new upload.
    await expect(
      run(s.ctx, "catalogImages.update", s.admin, { imageId: image.id, fileId: next.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("the in-use lookups hit the partial indexes", async () => {
    const { ctx } = await setup();
    for (const sql of Object.values(inUseSql)) expectNoTableScan(ctx, sql, [1]);
  });
});

describe("site.get", () => {
  test("follows palette changes and runs no catalog query when warm", async () => {
    const { ctx, admin } = await setup();
    const site = async () =>
      (await run(ctx, "site.get", GUEST, {})) as {
        palette: { nameColors: { id: number; name: string }[] };
      };
    const before = (await site()).palette.nameColors;
    const warm = catalogs(ctx);
    await site();
    expect(catalogs(ctx)).toBe(warm);
    const rose = before[0]!;
    await run(ctx, "paletteColors.update", admin, {
      colorId: rose.id,
      name: "Rosy",
      isActive: true,
    });
    expect((await site()).palette.nameColors[0]!.name).toBe("Rosy");
    await run(ctx, "paletteColors.update", admin, { colorId: rose.id, isActive: false });
    expect((await site()).palette.nameColors).toHaveLength(before.length - 1);
    await run(ctx, "paletteColors.delete", admin, { colorId: rose.id });
    expect((await site()).palette.nameColors).toHaveLength(before.length - 1);
  });

  test("carries the site's default language", async () => {
    const { ctx, admin } = await setup();
    const language = async () =>
      ((await run(ctx, "site.get", GUEST, {})) as { defaultLanguage: string }).defaultLanguage;
    expect(await language()).toBe("es");
    await run(ctx, "settings.update", admin, { defaultLanguage: "en" });
    expect(await language()).toBe("en");
  });
});
