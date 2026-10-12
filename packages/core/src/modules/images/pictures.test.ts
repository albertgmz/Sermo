import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { createStorage, localDriver } from "../storage";

sharp.cache(false);

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const png = () =>
  sharp({
    create: { width: 40, height: 30, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
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
  const dir = await mkdtemp(join(tmpdir(), "sermo-pictures-"));
  dirs.push(dir);
  const ctx = createTestContext();
  const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const memberRow = insertUser(ctx);
  const member = userActor(memberRow);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const upload = async (actor: typeof admin, purpose: string) =>
    (await storage.upload(actor, stream(await png()), "image/png", purpose as never)).id;
  const run = (name: string, actor: typeof admin, input: object) =>
    execute(ctx, getOperation(name), actor, input);
  return { ctx, memberRow, member, admin, moderator, upload, run };
}

const deletionQueued = (ctx: Ctx, fileId: number) =>
  !!ctx.sqlite
    .prepare("SELECT 1 FROM jobs WHERE unique_key = ?1")
    .get(`storage.deletePermanent.${fileId}`);
const editedEvents = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM domain_events WHERE type = 'content.edited'",
    )
    .get()!.n;
const logged = (ctx: Ctx, action: string) =>
  ctx.sqlite
    .prepare<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM moderator_log WHERE action = ?1")
    .get(action)!.n;

describe("removing a picture", () => {
  test("avatar and cover: null clears the column, deletes the file and tells the world", async () => {
    const { ctx, memberRow, member, run, upload } = await setup();
    for (const [operation, purpose, column] of [
      ["images.setAvatar", "avatar", "avatar_file_id"],
      ["images.setCover", "cover", "cover_file_id"],
    ] as const) {
      const fileId = await upload(member, purpose);
      const set = (await run(operation, member, { fileId })) as { fileId: number; url: string };
      expect(set).toEqual({ fileId, url: `/api/v1/files/${fileId}` });
      const events = editedEvents(ctx);
      expect(await run(operation, member, { fileId: null })).toBeNull();
      expect(
        ctx.sqlite
          .prepare<{ value: number | null }, [number]>(
            `SELECT ${column} AS value FROM users WHERE id = ?1`,
          )
          .get(memberRow.id)!.value,
      ).toBeNull();
      expect(deletionQueued(ctx, fileId)).toBe(true);
      expect(editedEvents(ctx)).toBe(events + 1);
      // Nothing is set any more: clearing again changes nothing.
      expect(await run(operation, member, { fileId: null })).toBeNull();
      expect(editedEvents(ctx)).toBe(events + 1);
    }
  });

  test("node icon and cover: administrators only", async () => {
    const { ctx, member, admin, moderator, run, upload } = await setup();
    const node = insertNode(ctx, {});
    for (const [operation, purpose, column] of [
      ["images.setNodeIcon", "node_icon", "icon_file_id"],
      ["images.setNodeCover", "node_cover", "cover_file_id"],
    ] as const) {
      const fileId = await upload(admin, purpose);
      await run(operation, admin, { nodeId: node.id, fileId });
      for (const actor of [member, moderator])
        await expect(
          run(operation, actor, { nodeId: node.id, fileId: null }),
        ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(operation, GUEST, { nodeId: node.id, fileId: null })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      expect(await run(operation, admin, { nodeId: node.id, fileId: null })).toBeNull();
      expect(
        ctx.sqlite
          .prepare<{ value: number | null }, [number]>(
            `SELECT ${column} AS value FROM nodes WHERE id = ?1`,
          )
          .get(node.id)!.value,
      ).toBeNull();
      expect(deletionQueued(ctx, fileId)).toBe(true);
      // One entry for setting it, one for removing it.
      expect(logged(ctx, `node.${purpose}`)).toBe(2);
    }
  });

  test("a guest cannot remove an avatar", async () => {
    const { run } = await setup();
    await expect(run("images.setAvatar", GUEST, { fileId: null })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe("award and shop item pictures", () => {
  async function withTargets() {
    const s = await setup();
    const now = s.ctx.now();
    const award = s.ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "INSERT INTO awards (name, tier, created_at, updated_at) VALUES ('Veteran', 'gold', ?1, ?1) RETURNING id",
      )
      .get(now)!.id;
    const category = s.ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('Art', ?1, ?1) RETURNING id",
      )
      .get(now)!.id;
    const item = s.ctx.sqlite
      .prepare<{ id: number }, [string, number, number]>(
        "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (?2, 'Badge', 5, ?1, ?3, ?3) RETURNING id",
      )
      .get(JSON.stringify({ type: "frame", frame: "x" }), category, now)!.id;
    return { ...s, award, item };
  }

  test("set, replace and remove an award picture", async () => {
    const { ctx, admin, run, upload, award } = await withTargets();
    const first = await upload(admin, "award_image");
    expect(await run("images.setAwardImage", admin, { awardId: award, fileId: first })).toEqual({
      fileId: first,
      url: `/api/v1/files/${first}`,
    });
    const read = async () =>
      ((await run("awards.get", admin, { awardId: award })) as { image: unknown }).image;
    expect(await read()).toEqual({ fileId: first, url: `/api/v1/files/${first}` });
    const updatedAt = () =>
      ctx.sqlite
        .prepare<{ updated_at: number }, [number]>("SELECT updated_at FROM awards WHERE id = ?1")
        .get(award)!.updated_at;
    const before = updatedAt();
    ctx.clock.advance(1000);
    const second = await upload(admin, "award_image");
    await run("images.setAwardImage", admin, { awardId: award, fileId: second });
    expect(deletionQueued(ctx, first)).toBe(true);
    expect(updatedAt()).toBe(before + 1000);
    expect(await run("images.setAwardImage", admin, { awardId: award, fileId: null })).toBeNull();
    expect(await read()).toBeNull();
    expect(deletionQueued(ctx, second)).toBe(true);
    expect(logged(ctx, "award.image")).toBe(3);
    // Clearing again changes nothing.
    await run("images.setAwardImage", admin, { awardId: award, fileId: null });
    expect(logged(ctx, "award.image")).toBe(3);
    const listed = (await run("awards.list", admin, {})) as { items: { image: unknown }[] };
    expect(listed.items.every((entry) => entry.image === null)).toBe(true);
  });

  test("set and remove a shop item picture", async () => {
    const { ctx, admin, run, upload, item } = await withTargets();
    const file = await upload(admin, "shop_image");
    const reference = { fileId: file, url: `/api/v1/files/${file}` };
    expect(await run("images.setShopItemImage", admin, { itemId: item, fileId: file })).toEqual(
      reference,
    );
    const read = async () =>
      ((await run("shopItems.get", admin, { itemId: item })) as { image: unknown }).image;
    expect(await read()).toEqual(reference);
    expect(await run("images.setShopItemImage", admin, { itemId: item, fileId: null })).toBeNull();
    expect(await read()).toBeNull();
    expect(deletionQueued(ctx, file)).toBe(true);
    expect(logged(ctx, "shop.item.image")).toBe(2);
  });

  test("permissions, targets and files are checked", async () => {
    const { ctx, member, moderator, admin, run, upload, award, item } = await withTargets();
    const awardFile = await upload(admin, "award_image");
    const shopFile = await upload(admin, "shop_image");
    const calls: [string, object][] = [
      ["images.setAwardImage", { awardId: award, fileId: awardFile }],
      ["images.setShopItemImage", { itemId: item, fileId: shopFile }],
    ];
    for (const [name, input] of calls) {
      await expect(run(name, GUEST, input)).rejects.toBeInstanceOf(UnauthenticatedError);
      for (const actor of [member, moderator])
        await expect(run(name, actor, input)).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Holding admin.awards alone opens the award picture and nothing else.
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Awards', 10) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.awards'",
      )
      .run(group);
    const awardsAdmin = userActor(insertUser(ctx, { groupId: group }));
    await expect(run("images.setShopItemImage", awardsAdmin, calls[1]![1])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const ownFile = await upload(awardsAdmin, "award_image");
    await run("images.setAwardImage", awardsAdmin, { awardId: award, fileId: ownFile });
    // Unknown target, wrong purpose, a file that is no longer unattached.
    await expect(
      run("images.setAwardImage", admin, { awardId: 9999, fileId: awardFile }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      run("images.setShopItemImage", admin, { itemId: 9999, fileId: shopFile }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      run("images.setAwardImage", admin, { awardId: award, fileId: shopFile }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      run("images.setAwardImage", admin, { awardId: award, fileId: ownFile }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
