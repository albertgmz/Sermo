import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { type Ctx, closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { moveCredits } from "../../shared/credits";
import { expireShopBatch } from "../shop/expiry";
import { heldSql } from "../shop/held";
import { insertCatalogImage, insertPaletteColor } from "./catalog-fixtures";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
const run = (ctx: Ctx, name: string, actor: object, input: object = {}): Promise<any> =>
  execute(ctx, getOperation(name), actor as never, input);

/** A member with credits, a shop of one frame, one name colour and two covers. */
async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const memberRow = insertUser(ctx);
  const member = userActor(memberRow);
  writeTx(ctx, () =>
    moveCredits(ctx, [{ userId: memberRow.id, amount: 1000, type: "adjustment" }]),
  );
  const frame = insertCatalogImage(ctx, "frame");
  const otherFrame = insertCatalogImage(ctx, "frame");
  const color = insertPaletteColor(ctx, { kind: "name", color: "#aa5500" });
  const accent = insertPaletteColor(ctx, { kind: "accent", color: "#00aa55" });
  const cover = insertCatalogImage(ctx, "profile_cover");
  const category = await run(ctx, "shopCategories.create", admin, { name: "Looks" });
  const sell = (effect: object, fields: object = {}) =>
    run(ctx, "shopItems.create", admin, {
      categoryId: category.id,
      name: "Look",
      price: 10,
      effect,
      ...fields,
    });
  const buy = (itemId: number, as: object = member, extra: object = {}) =>
    run(ctx, "shop.buy", as, { itemId, ...extra });
  const permit = (userId: number, permission: string, value: "allow" | "unset" = "allow") =>
    run(ctx, "permissions.set", admin, { userId, entries: [{ permission, value }] });
  return {
    ctx,
    admin,
    member,
    memberRow,
    frame,
    otherFrame,
    color,
    accent,
    cover,
    sell,
    buy,
    permit,
    get: (as: object = member) => run(ctx, "appearance.get", as),
    set: (input: object, as: object = member) => run(ctx, "appearance.set", as, input),
    worn: (id = memberRow.id) =>
      ctx.sqlite
        .prepare(
          "SELECT accent_color_id, name_color_id, frame_id, cover_preset_id FROM users WHERE id = ?1",
        )
        .get(id),
  };
}
type World = Awaited<ReturnType<typeof world>>;

describe("appearance.get", () => {
  test("requires an account", async () => {
    const w = await world();
    await expect(run(w.ctx, "appearance.get", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("a new member wears nothing and may pick only accents", async () => {
    const w = await world();
    const mine = await w.get();
    expect(mine).toMatchObject({
      accentId: null,
      nameColorId: null,
      frameId: null,
      coverPresetId: null,
    });
    expect(mine.available.accents.map((x: { id: number }) => x.id)).toContain(w.accent);
    expect(mine.available).toMatchObject({ nameColors: [], frames: [], covers: [] });
    expect(
      mine.available.accents.every(
        (x: { kind: string; isActive: boolean }) => x.kind === "accent" && x.isActive,
      ),
    ).toBe(true);
  });

  test("lists what the member holds, the gallery only with the permission, and never inactive accents", async () => {
    const w = await world();
    const frame = await w.sell({ type: "frame", frameId: w.frame });
    const color = await w.sell({ type: "nameColor", colorId: w.color });
    await w.buy(frame.id);
    await w.buy(color.id);
    const inactiveAccent = insertPaletteColor(w.ctx, { kind: "accent", active: false });
    insertCatalogImage(w.ctx, "profile_cover", { active: false });
    insertCatalogImage(w.ctx, "profile_cover", { picture: false });
    let mine = await w.get();
    expect(mine.available.frames.map((x: { id: number }) => x.id)).toEqual([w.frame]);
    expect(mine.available.nameColors.map((x: { id: number }) => x.id)).toEqual([w.color]);
    expect(mine.available.accents.map((x: { id: number }) => x.id)).not.toContain(inactiveAccent);
    expect(mine.available.covers).toEqual([]);
    await w.permit(w.memberRow.id, "profile.coverPreset");
    mine = await w.get();
    expect(mine.available.covers.map((x: { id: number }) => x.id)).toEqual([w.cover]);
  });

  test("a consumable is held while units remain, and an expired temporary item is not", async () => {
    const w = await world();
    const units = await w.sell({ type: "frame", frameId: w.frame }, { isConsumable: true });
    await w.buy(units.id, w.member, { quantity: 2 });
    expect((await w.get()).available.frames).toHaveLength(1);
    const temporary = await w.sell(
      { type: "nameColor", colorId: w.color },
      { durationSeconds: 60 },
    );
    await w.buy(temporary.id);
    expect((await w.get()).available.nameColors).toHaveLength(1);
    w.ctx.clock.advance(61_000);
    expect((await w.get()).available.nameColors).toHaveLength(0);
  });

  test("what is worn stays in the current ids when it is no longer offered", async () => {
    const w = await world();
    const frame = await w.sell({ type: "frame", frameId: w.frame });
    await w.buy(frame.id);
    await w.set({ frameId: w.frame });
    w.ctx.sqlite.prepare("UPDATE catalog_images SET is_active = 0 WHERE id = ?1").run(w.frame);
    w.ctx.sqlite
      .prepare("UPDATE shop_inventory SET state = 'used' WHERE user_id = ?1")
      .run(w.memberRow.id);
    const mine = await w.get();
    expect(mine.frameId).toBe(w.frame);
    expect(mine.available.frames).toEqual([]);
  });
});

describe("appearance.set", () => {
  test("requires an account and the right to edit one's profile", async () => {
    const w = await world();
    await expect(w.set({ accentId: w.accent }, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    const denied = insertUser(w.ctx);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, 0, id, -1 FROM permission_definitions WHERE key = 'profile.editOwn'",
      )
      .run(denied.id);
    await expect(w.set({ accentId: w.accent }, userActor(denied))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // An unconfirmed member may wear what they hold, like any profile edit.
    const unconfirmed = userActor(insertUser(w.ctx, { groupId: 5 }));
    expect(await w.set({ accentId: w.accent }, unconfirmed)).toMatchObject({ accentId: w.accent });
  });

  test("an accent is any active accent, and only the keys sent change", async () => {
    const w = await world();
    const frame = await w.sell({ type: "frame", frameId: w.frame });
    await w.buy(frame.id);
    await w.set({ frameId: w.frame });
    const before = w.ctx.sqlite
      .prepare<{ content_updated_at: number }, [number]>(
        "SELECT content_updated_at FROM users WHERE id = ?1",
      )
      .get(w.memberRow.id)!.content_updated_at;
    w.ctx.clock.advance(5000);
    const result = await w.set({ accentId: w.accent });
    expect(result).toMatchObject({ accentId: w.accent, frameId: w.frame });
    expect(w.worn()).toMatchObject({ accent_color_id: w.accent, frame_id: w.frame });
    expect(
      w.ctx.sqlite
        .prepare<{ content_updated_at: number }, [number]>(
          "SELECT content_updated_at FROM users WHERE id = ?1",
        )
        .get(w.memberRow.id)!.content_updated_at,
    ).toBe(before + 5000);
    expect(
      w.ctx.sqlite
        .prepare(
          "SELECT 1 FROM domain_events WHERE type = 'content.edited' AND target_type = 'profile' AND target_id = ?1 AND created_at = ?2",
        )
        .get(w.memberRow.id, w.ctx.now()),
    ).not.toBeNull();
    expect(await w.set({ accentId: null })).toMatchObject({ accentId: null, frameId: w.frame });
    expect(await w.set({})).toMatchObject({ frameId: w.frame });
    await expect(w.set({ accentId: w.color })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.set({ accentId: 999999 })).rejects.toBeInstanceOf(NotFoundError);
    const inactive = insertPaletteColor(w.ctx, { kind: "accent", active: false });
    await expect(w.set({ accentId: inactive })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a frame or name colour must be held; an id of another kind is not found", async () => {
    const w = await world();
    await expect(w.set({ frameId: w.frame })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.set({ nameColorId: w.color })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.set({ frameId: w.cover })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.set({ frameId: 999999 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.set({ nameColorId: w.accent })).rejects.toBeInstanceOf(NotFoundError);
    expect(w.worn()).toMatchObject({ frame_id: null, name_color_id: null });
    const frame = await w.sell({ type: "frame", frameId: w.frame });
    const color = await w.sell({ type: "nameColor", colorId: w.color });
    await w.buy(frame.id);
    await w.buy(color.id);
    expect(await w.set({ frameId: w.frame, nameColorId: w.color })).toMatchObject({
      frameId: w.frame,
      nameColorId: w.color,
    });
    await expect(w.set({ frameId: w.otherFrame })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await w.set({ frameId: null, nameColorId: null })).toMatchObject({
      frameId: null,
      nameColorId: null,
    });
  });

  test("a held frame without a picture cannot be worn", async () => {
    const w = await world();
    const bare = insertCatalogImage(w.ctx, "frame", { picture: false, active: false });
    const frame = await w.sell({ type: "frame", frameId: w.frame });
    await w.buy(frame.id);
    w.ctx.sqlite
      .prepare("UPDATE shop_items SET effect = ?1 WHERE id = ?2")
      .run(JSON.stringify({ type: "frame", frameId: bare }), frame.id);
    await expect(w.set({ frameId: bare })).rejects.toBeInstanceOf(ConflictError);
  });

  test("a cover from the gallery needs profile.coverPreset and an active entry with a picture", async () => {
    const w = await world();
    await expect(w.set({ coverPresetId: w.cover })).rejects.toBeInstanceOf(ForbiddenError);
    await w.permit(w.memberRow.id, "profile.coverPreset");
    expect(await w.set({ coverPresetId: w.cover })).toMatchObject({ coverPresetId: w.cover });
    for (const id of [
      insertCatalogImage(w.ctx, "profile_cover", { active: false }),
      insertCatalogImage(w.ctx, "profile_cover", { picture: false }),
      w.frame,
      999999,
    ])
      await expect(w.set({ coverPresetId: id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await w.set({ coverPresetId: null })).toMatchObject({ coverPresetId: null });
    // Staff have the permission by default.
    const moderator = userActor(insertUser(w.ctx, { groupId: 3 }));
    expect(await w.set({ coverPresetId: w.cover }, moderator)).toMatchObject({
      coverPresetId: w.cover,
    });
  });

  test("a member who loses profile.coverPreset keeps the choice stored but it is no longer shown", async () => {
    const w = await world();
    await w.permit(w.memberRow.id, "profile.coverPreset");
    await w.set({ coverPresetId: w.cover });
    await w.permit(w.memberRow.id, "profile.coverPreset", "unset");
    expect(w.worn()).toMatchObject({ cover_preset_id: w.cover });
    const mine = await w.get();
    expect(mine.coverPresetId).toBeNull();
    expect(mine.available.covers).toEqual([]);
    // Taking it off needs no permission.
    expect(await w.set({ coverPresetId: null })).toMatchObject({ coverPresetId: null });
  });

  test("what is worn shows on the member's card at once", async () => {
    const w = await world();
    const frame = await w.sell({ type: "frame", frameId: w.frame });
    const color = await w.sell({ type: "nameColor", colorId: w.color });
    await w.buy(frame.id);
    await w.buy(color.id);
    await w.set({ frameId: w.frame, nameColorId: w.color });
    const [card] = (await run(w.ctx, "users.cards", GUEST, { userIds: [w.memberRow.id] })).items;
    expect(card.nameColor).toBe("#aa5500");
    expect(card.frame).toMatchObject({ url: expect.stringContaining("/api/v1/files/") });
    await w.set({ frameId: null, nameColorId: null });
    const [bare] = (await run(w.ctx, "users.cards", GUEST, { userIds: [w.memberRow.id] })).items;
    expect(bare).toMatchObject({ frame: null, nameColor: null });
  });
});

describe("things come off when they are no longer held", () => {
  async function wearing(w: World, fields: object = {}) {
    const frame = await w.sell({ type: "frame", frameId: w.frame }, fields);
    const color = await w.sell({ type: "nameColor", colorId: w.color }, fields);
    await w.buy(frame.id);
    await w.buy(color.id);
    await w.set({ frameId: w.frame, nameColorId: w.color });
    return { frame, color };
  }
  const expire = (w: World) => {
    while (expireShopBatch(w.ctx) > 0);
  };

  test("the expiry job takes off an item that ran out, in the same transaction", async () => {
    const w = await world();
    await wearing(w, { durationSeconds: 60 });
    w.ctx.clock.advance(61_000);
    expire(w);
    expect(w.worn()).toMatchObject({ frame_id: null, name_color_id: null });
    expect(
      w.ctx.sqlite
        .prepare<{ content_updated_at: number }, [number]>(
          "SELECT content_updated_at FROM users WHERE id = ?1",
        )
        .get(w.memberRow.id)!.content_updated_at,
    ).toBe(w.ctx.now());
  });

  test("another row that still holds the same frame keeps it on", async () => {
    const w = await world();
    const short = await w.sell({ type: "frame", frameId: w.frame }, { durationSeconds: 60 });
    const lasting = await w.sell({ type: "frame", frameId: w.frame });
    await w.buy(short.id);
    await w.buy(lasting.id);
    await w.set({ frameId: w.frame });
    w.ctx.clock.advance(61_000);
    expire(w);
    expect(w.worn()).toMatchObject({ frame_id: w.frame });
  });

  test("only the look that ran out comes off", async () => {
    const w = await world();
    const short = await w.sell({ type: "frame", frameId: w.frame }, { durationSeconds: 60 });
    const lasting = await w.sell({ type: "nameColor", colorId: w.color });
    await w.buy(short.id);
    await w.buy(lasting.id);
    await w.set({ frameId: w.frame, nameColorId: w.color });
    w.ctx.clock.advance(61_000);
    expire(w);
    expect(w.worn()).toMatchObject({ frame_id: null, name_color_id: w.color });
  });

  test("an item bought again after it expired can be worn again", async () => {
    const w = await world();
    const { frame } = await wearing(w, { durationSeconds: 60 });
    w.ctx.clock.advance(61_000);
    expire(w);
    await w.buy(frame.id);
    expect(await w.set({ frameId: w.frame })).toMatchObject({ frameId: w.frame });
  });
});

describe("holding queries use the inventory index", () => {
  test("the held frame and colour lookups do not scan", async () => {
    const w = await world();
    for (const sql of [heldSql.frame, heldSql.nameColor]) expectNoTableScan(w.ctx, sql, [1, 0]);
    expectNoTableScan(w.ctx, heldSql.worn, [1]);
  });
});

describe("catalog entries named by a shop item are in use", () => {
  test("deleting a frame, cover or colour that an item sells deactivates it", async () => {
    const w = await world();
    const cover = insertCatalogImage(w.ctx, "thread_cover");
    await w.sell({ type: "frame", frameId: w.frame });
    await w.sell({ type: "threadCover", coverId: cover });
    await w.sell({ type: "nameColor", colorId: w.color });
    const spareFrame = insertCatalogImage(w.ctx, "frame");
    const spareColor = insertPaletteColor(w.ctx, { kind: "name" });
    expect(await run(w.ctx, "catalogImages.delete", w.admin, { imageId: w.frame })).toEqual({
      ok: true,
      deactivated: true,
    });
    expect(await run(w.ctx, "catalogImages.delete", w.admin, { imageId: cover })).toEqual({
      ok: true,
      deactivated: true,
    });
    expect(await run(w.ctx, "paletteColors.delete", w.admin, { colorId: w.color })).toEqual({
      ok: true,
      deactivated: true,
    });
    expect(await run(w.ctx, "catalogImages.delete", w.admin, { imageId: spareFrame })).toEqual({
      ok: true,
      deactivated: false,
    });
    expect(await run(w.ctx, "paletteColors.delete", w.admin, { colorId: spareColor })).toEqual({
      ok: true,
      deactivated: false,
    });
  });
});

describe("appearance.set against a stale actor", () => {
  async function scenario() {
    const w = await world();
    const frame = await w.sell({ type: "frame", frameId: w.frame }, { durationSeconds: 60 });
    await w.buy(frame.id);
    // The gallery comes with a group, which another process can take the member out of.
    const gallery = await run(w.ctx, "groups.create", w.admin, { title: "Gallery", rank: 5 });
    await run(w.ctx, "permissions.set", w.admin, {
      groupId: gallery.id,
      entries: [{ permission: "profile.coverPreset", value: "allow" }],
    });
    await run(w.ctx, "users.setGroups", w.admin, {
      userId: w.memberRow.id,
      secondaryGroupIds: [gallery.id],
    });
    const database = sharedDatabase(w.ctx);
    const here = database.open();
    const elsewhere = database.open();
    const { clock } = w.ctx;
    return { w, database, here, elsewhere, clock, actor: resolvedActor(here, w.memberRow.id) };
  }
  const snapshot = (ctx: Ctx) =>
    JSON.stringify(
      ctx.sqlite
        .prepare(
          "SELECT accent_color_id, name_color_id, frame_id, cover_preset_id, content_updated_at FROM users ORDER BY id",
        )
        .all(),
    );

  test("a ban placed elsewhere refuses every change", async () => {
    const s = await scenario();
    try {
      await run(s.elsewhere, "bans.create", s.w.admin, {
        userId: s.w.memberRow.id,
        reason: "Fraud",
        expiresAt: null,
      });
      const before = snapshot(s.elsewhere);
      for (const input of [{ accentId: s.w.accent }, { coverPresetId: s.w.cover }])
        await expect(run(s.here, "appearance.set", s.actor, input)).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      expect(snapshot(s.elsewhere)).toBe(before);
    } finally {
      s.database.close();
    }
  });

  test("a cover permission revoked elsewhere refuses the cover", async () => {
    const s = await scenario();
    try {
      await run(s.elsewhere, "users.setGroups", s.w.admin, {
        userId: s.w.memberRow.id,
        secondaryGroupIds: [],
      });
      const before = snapshot(s.elsewhere);
      await expect(
        run(s.here, "appearance.set", s.actor, { coverPresetId: s.w.cover }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(snapshot(s.elsewhere)).toBe(before);
      expect(await run(s.here, "appearance.set", s.actor, { accentId: s.w.accent })).toMatchObject({
        accentId: s.w.accent,
      });
    } finally {
      s.database.close();
    }
  });

  test("a frame that expired elsewhere can no longer be put on", async () => {
    const s = await scenario();
    try {
      expect(await run(s.here, "appearance.set", s.actor, { frameId: s.w.frame })).toMatchObject({
        frameId: s.w.frame,
      });
      s.clock.advance(61_000);
      while (expireShopBatch(s.elsewhere) > 0);
      expect(
        s.elsewhere.sqlite
          .prepare("SELECT frame_id FROM users WHERE id = ?1")
          .get(s.w.memberRow.id),
      ).toEqual({ frame_id: null });
      await expect(
        run(s.here, "appearance.set", s.actor, { frameId: s.w.frame }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      s.database.close();
    }
  });
});
