import { afterEach, describe, expect, test } from "bun:test";
import { ConflictError, ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";
import { assertOtherSuperAdmin } from "./super-admin";

afterEach(closeAll);

async function world() {
  const w = await accounts();
  const owner = await w.register("Owner", 4);
  const peer = await w.register("Peer", 4);
  const plain = await w.register("Plain", 4);
  const member = await w.register("Member");
  const flag = (id: number, value = 1) =>
    w.ctx.sqlite.prepare("UPDATE users SET is_super_admin = ?1 WHERE id = ?2").run(value, id);
  flag(owner.id);
  const groups = (as: { actor: object }, userId: number) =>
    w.run("users.setGroups", as.actor, { userId, secondaryGroupIds: [3] });
  const setSuper = (
    as: { actor: object },
    userId: number,
    superAdmin: boolean,
    actorPassword = PASSWORD,
  ) => w.run("users.setSuperAdmin", as.actor, { userId, superAdmin, actorPassword });
  const isSuper = (id: number) =>
    !!w.ctx.sqlite
      .prepare<{ is_super_admin: number }, [number]>(
        "SELECT is_super_admin FROM users WHERE id = ?1",
      )
      .get(id)!.is_super_admin;
  return { ...w, owner, peer, plain, member, flag, groups, setSuper, isSuper };
}

describe("super admin hierarchy", () => {
  test("a super admin edits their own groups and sessions", async () => {
    const w = await world();
    const own = await w.groups(w.owner, w.owner.id);
    expect(own).toMatchObject({ primaryGroupId: 4, secondaryGroupIds: [3] });
    expect(await w.run("users.getGroups", w.owner.actor, { userId: w.owner.id })).toMatchObject({
      userId: w.owner.id,
    });
    const sessions = await w.run("users.adminSessions", w.owner.actor, { userId: w.owner.id });
    expect(sessions.items).toHaveLength(1);
    expect(await w.run("users.adminRevokeSessions", w.owner.actor, { userId: w.owner.id })).toEqual(
      { revoked: 1 },
    );
  });

  test("a super admin edits another administrator, whatever the group ranks", async () => {
    const w = await world();
    expect(await w.groups(w.owner, w.peer.id)).toMatchObject({ secondaryGroupIds: [3] });
    const sessions = await w.run("users.adminSessions", w.owner.actor, { userId: w.peer.id });
    expect(sessions.items).toHaveLength(1);
    w.ctx.sqlite.prepare("INSERT INTO groups (id, title, rank) VALUES (90, 'Above', 99999)").run();
    expect(
      await w.run("users.setGroups", w.owner.actor, {
        userId: w.member.id,
        secondaryGroupIds: [90],
      }),
    ).toMatchObject({ secondaryGroupIds: [90] });
  });

  test("a plain administrator is refused on another administrator and on a super admin", async () => {
    const w = await world();
    // The super admin ranks below the plain administrator: the flag decides, not the rank.
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE id = ?1").run(w.owner.id);
    for (const target of [w.peer, w.owner, w.plain]) {
      await expect(w.groups(w.plain, target.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        w.run("users.getGroups", w.plain.actor, { userId: target.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        w.run("users.adminSessions", w.plain.actor, { userId: target.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(w.setSuper(w.plain, target.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(w.isSuper(w.plain.id)).toBe(false);
  });

  test("a plain administrator still edits members below them", async () => {
    const w = await world();
    expect(await w.groups(w.plain, w.member.id)).toMatchObject({ secondaryGroupIds: [3] });
    expect(
      (await w.run("users.adminSessions", w.plain.actor, { userId: w.member.id })).items,
    ).toHaveLength(1);
  });

  test("an administrator editing their own groups is refused unless they are a super admin", async () => {
    const w = await world();
    await expect(w.groups(w.plain, w.plain.id)).rejects.toBeInstanceOf(ForbiddenError);
    w.flag(w.plain.id);
    expect(await w.groups(w.plain, w.plain.id)).toMatchObject({ secondaryGroupIds: [3] });
  });
});

describe("users.setSuperAdmin", () => {
  test("a super admin grants and removes the flag, and it is logged", async () => {
    const w = await world();
    expect(await w.setSuper(w.owner, w.plain.id, true)).toEqual({ ok: true });
    expect(w.isSuper(w.plain.id)).toBe(true);
    // The new super admin acts on the owner at once.
    expect(await w.groups(w.plain, w.owner.id)).toMatchObject({ userId: w.owner.id });
    expect(await w.setSuper(w.owner, w.plain.id, false)).toEqual({ ok: true });
    expect(w.isSuper(w.plain.id)).toBe(false);
    const log = w.logOf(w.plain.id).filter((row) => row.action === "user.superAdmin");
    expect(log.map((row) => row.details)).toEqual([{ superAdmin: true }, { superAdmin: false }]);
    const shown = await w.run("users.adminGet", w.owner.actor, { userId: w.member.id });
    expect(shown).toMatchObject({ isSuperAdmin: false, canSetSuperAdmin: true });
    const ownerView = await w.run("users.adminGet", w.peer.actor, { userId: w.owner.id });
    expect(ownerView).toMatchObject({
      isSuperAdmin: true,
      canSetSuperAdmin: false,
      canEdit: false,
    });
    const plainView = await w.run("users.adminGet", w.peer.actor, { userId: w.member.id });
    expect(plainView).toMatchObject({ isSuperAdmin: false, canSetSuperAdmin: false });
  });

  test("only a super admin, with the right password", async () => {
    const w = await world();
    await expect(w.setSuper(w.plain, w.member.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.setSuper(w.member, w.member.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.setSuper(w.owner, w.member.id, true, "wrong-wrong-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(w.isSuper(w.member.id)).toBe(false);
  });

  test("the last super admin cannot be removed, another can", async () => {
    const w = await world();
    await expect(w.setSuper(w.owner, w.owner.id, false)).rejects.toBeInstanceOf(ConflictError);
    expect(w.isSuper(w.owner.id)).toBe(true);
    await w.setSuper(w.owner, w.peer.id, true);
    await w.setSuper(w.owner, w.owner.id, false);
    expect(w.isSuper(w.owner.id)).toBe(false);
    await expect(w.setSuper(w.peer, w.peer.id, false)).rejects.toBeInstanceOf(ConflictError);
  });

  test("an erased member cannot be granted it", async () => {
    const w = await world();
    await w.run("users.adminErase", w.owner.actor, {
      userId: w.member.id,
      actorPassword: PASSWORD,
      reason: "Gone",
    });
    await expect(w.setSuper(w.owner, w.member.id, true)).rejects.toBeInstanceOf(ConflictError);
    expect(w.isSuper(w.member.id)).toBe(false);
    expect(await w.run("users.adminGet", w.owner.actor, { userId: w.member.id })).toMatchObject({
      canSetSuperAdmin: false,
    });
  });

  test("erasing a super admin clears the flag; the last one has no other to stand in", async () => {
    const w = await world();
    await w.setSuper(w.owner, w.peer.id, true);
    await w.run("users.adminErase", w.owner.actor, {
      userId: w.peer.id,
      actorPassword: PASSWORD,
      reason: "Gone",
    });
    expect(w.isSuper(w.peer.id)).toBe(false);
    expect(w.isSuper(w.owner.id)).toBe(true);
    // Nobody but the owner is left: removing or erasing the owner would leave none.
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).toThrow(ConflictError);
    expect(() => assertOtherSuperAdmin(w.ctx, w.member.id)).not.toThrow();
    // An erased account holding a stale flag is not another super admin.
    w.flag(w.peer.id);
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).toThrow(ConflictError);
  });

  test("an actor who lost the flag elsewhere is refused", async () => {
    const w = await world();
    await w.setSuper(w.owner, w.peer.id, true);
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, w.peer.id);
      await execute(
        elsewhere,
        getOperation("users.setSuperAdmin"),
        resolvedActor(elsewhere, w.owner.id),
        { userId: w.peer.id, superAdmin: false, actorPassword: PASSWORD },
      );
      await expect(
        execute(here, getOperation("users.setSuperAdmin"), stale, {
          userId: w.member.id,
          superAdmin: true,
          actorPassword: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare<{ is_super_admin: number }, [number]>(
            "SELECT is_super_admin FROM users WHERE id = ?1",
          )
          .get(w.member.id)!.is_super_admin,
      ).toBe(0);
    } finally {
      database.close();
    }
  });
});

describe("a usable super admin always remains", () => {
  const ban = (w: Awaited<ReturnType<typeof world>>, id: number) =>
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(id);

  test("a banned, erased or powerless flag holder is not another super admin", async () => {
    const w = await world();
    w.flag(w.peer.id);
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).not.toThrow();
    ban(w, w.peer.id);
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).toThrow(ConflictError);
    w.ctx.sqlite
      .prepare("UPDATE users SET banned_permanently = 0, banned_until = ?1 WHERE id = ?2")
      .run(w.ctx.now() + 60_000, w.peer.id);
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).toThrow(ConflictError);
    w.ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(w.ctx.now() - 1, w.peer.id);
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).not.toThrow();
    // A flag without admin.members cannot administer.
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE id = ?1").run(w.peer.id);
    expect(() => assertOtherSuperAdmin(w.ctx, w.owner.id)).toThrow(ConflictError);
  });

  test("removing the flag is refused when the other holder is banned", async () => {
    const w = await world();
    w.flag(w.peer.id);
    ban(w, w.peer.id);
    await expect(w.setSuper(w.owner, w.owner.id, false)).rejects.toBeInstanceOf(ConflictError);
    expect(w.isSuper(w.owner.id)).toBe(true);
  });

  test("users.setGroups refuses a change that leaves no usable super admin", async () => {
    const w = await world();
    w.flag(w.peer.id);
    ban(w, w.peer.id);
    await expect(
      w.run("users.setGroups", w.owner.actor, { userId: w.owner.id, primaryGroupId: 2 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      w.ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(w.owner.id)!.group_id,
    ).toBe(4);
    // With another usable super admin the same change goes through.
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 0 WHERE id = ?1").run(w.peer.id);
    expect(
      await w.run("users.setGroups", w.owner.actor, { userId: w.owner.id, primaryGroupId: 2 }),
    ).toMatchObject({ primaryGroupId: 2 });
  });

  test("taking admin.members from the group of the last usable super admin is refused", async () => {
    const w = await world();
    await expect(
      w.run("permissions.set", w.owner.actor, {
        groupId: 4,
        entries: [{ permission: "admin.members", value: "never" }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
