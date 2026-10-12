import { describe, expect, test } from "bun:test";
import { GROUP_IDS } from "../../db/schema";
import { ForbiddenError, ValidationError } from "../../errors";
import { execute, getOperation } from "../../index";
import { createTestContext, insertUser, userActor } from "../../testing";

function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  const member = userActor(insertUser(ctx));
  const run = (name: string, actor: typeof admin, input: object) =>
    execute(ctx, getOperation(name), actor, input) as Promise<Record<string, unknown>>;
  const color = async (kind: string, isActive = true) =>
    (
      await run("paletteColors.create", admin, {
        kind,
        name: `c${kind}`,
        color: "#112233",
        ...(kind === "accent" ? { foreground: "#ffffff" } : {}),
        isActive,
      })
    ).id as number;
  return { ctx, admin, member, run, color };
}

describe("a group's name colour and staff flag", () => {
  test("create stores both and every read returns them", async () => {
    const w = world();
    const colorId = await w.color("name");
    const created = await w.run("groups.create", w.admin, {
      title: "Crew",
      rank: 20,
      nameColorId: colorId,
      isStaff: true,
    });
    expect(created).toMatchObject({ nameColorId: colorId, isStaff: true });
    const got = await w.run("groups.get", w.admin, { groupId: created.id });
    expect(got).toMatchObject({ nameColorId: colorId, isStaff: true });
    const list = (await w.run("groups.list", w.admin, {})) as unknown as {
      items: { id: number; isStaff: boolean }[];
    };
    expect(list.items.find((group) => group.id === created.id)?.isStaff).toBe(true);
    const plain = await w.run("groups.create", w.admin, { title: "Plain", rank: 5 });
    expect(plain).toMatchObject({ nameColorId: null, isStaff: false });
  });

  test("the built-in moderator and administrator groups are staff", async () => {
    const w = world();
    const list = (await w.run("groups.list", w.admin, {})) as unknown as {
      items: { builtin: string | null; isStaff: boolean }[];
    };
    const staff = list.items.filter((group) => group.isStaff).map((group) => group.builtin);
    expect(staff.sort()).toEqual(["admin", "moderator"]);
  });

  test("update changes only what is sent and null clears the colour", async () => {
    const w = world();
    const colorId = await w.color("name");
    const group = await w.run("groups.create", w.admin, { title: "Crew", rank: 20 });
    const set = await w.run("groups.update", w.admin, {
      groupId: group.id,
      nameColorId: colorId,
      isStaff: true,
    });
    expect(set).toMatchObject({ nameColorId: colorId, isStaff: true, title: "Crew" });
    const renamed = await w.run("groups.update", w.admin, { groupId: group.id, title: "Crew 2" });
    expect(renamed).toMatchObject({ nameColorId: colorId, isStaff: true, title: "Crew 2" });
    const cleared = await w.run("groups.update", w.admin, { groupId: group.id, nameColorId: null });
    expect(cleared).toMatchObject({ nameColorId: null, isStaff: true });
  });

  test("the colour must be an active colour of the name catalog", async () => {
    const w = world();
    const accent = await w.color("accent");
    const inactive = await w.color("name", false);
    await expect(
      w.run("groups.create", w.admin, { title: "A", rank: 1, nameColorId: accent }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      w.run("groups.create", w.admin, { title: "A", rank: 1, nameColorId: 9999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const group = await w.run("groups.create", w.admin, { title: "A", rank: 1 });
    await expect(
      w.run("groups.update", w.admin, { groupId: group.id, nameColorId: inactive }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a colour already on the group stays when it is later deactivated", async () => {
    const w = world();
    const colorId = await w.color("name");
    const group = await w.run("groups.create", w.admin, {
      title: "A",
      rank: 1,
      nameColorId: colorId,
    });
    await w.run("paletteColors.update", w.admin, { colorId, isActive: false });
    const updated = await w.run("groups.update", w.admin, { groupId: group.id, title: "B" });
    expect(updated.nameColorId).toBe(colorId);
  });

  test("a name colour a group uses is in use: deleting it only deactivates it", async () => {
    const w = world();
    const colorId = await w.color("name");
    await w.run("groups.create", w.admin, { title: "A", rank: 1, nameColorId: colorId });
    const deleted = await w.run("paletteColors.delete", w.admin, { colorId });
    expect(deleted.deactivated).toBe(true);
    const free = await w.color("name");
    expect((await w.run("paletteColors.delete", w.admin, { colorId: free })).deactivated).toBe(
      false,
    );
  });

  test("members cannot change either", async () => {
    const w = world();
    await expect(
      w.run("groups.create", w.member, { title: "A", rank: 1, isStaff: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
