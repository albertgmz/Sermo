import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { noticesSql } from "./index";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

const FIELDS = {
  title: "Notice",
  body: "Hello **there**",
  audience: "everyone",
  groupId: null,
  dismissible: true,
  active: true,
  startsAt: null,
  endsAt: null,
};

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const memberUser = insertUser(ctx);
  const member = userActor(memberUser);
  const create = (input: object = {}, actor = admin) =>
    run(ctx, "notices.create", actor, { ...FIELDS, ...input });
  const titles = async (actor: Parameters<typeof execute>[2]) =>
    (await run(ctx, "notices.current", actor)).items.map((item: { title: string }) => item.title);
  return { ctx, admin, moderator, member, memberUser, create, titles };
}

describe("notices management", () => {
  test("guests, members and moderators are refused; an administrator manages", async () => {
    const { ctx, admin, moderator, member, create } = setup();
    const made = await create();
    expect(made.bodyHtml).toContain("<strong>there</strong>");
    for (const name of ["notices.list", "notices.create", "notices.update", "notices.delete"]) {
      const input = { ...FIELDS, noticeId: made.id };
      await expect(run(ctx, name, GUEST, input)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(run(ctx, name, member, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(ctx, name, moderator, input)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const updated = await run(ctx, "notices.update", admin, {
      ...FIELDS,
      noticeId: made.id,
      title: "Changed",
      audience: "members",
      dismissible: false,
    });
    expect(updated.title).toBe("Changed");
    expect(updated.audience).toBe("members");
    expect((await run(ctx, "notices.list", admin)).items).toHaveLength(1);
    await run(ctx, "notices.delete", admin, { noticeId: made.id });
    expect((await run(ctx, "notices.list", admin)).items).toHaveLength(0);
    await expect(run(ctx, "notices.delete", admin, { noticeId: made.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a group audience needs an existing group; the end must follow the start", async () => {
    const { create } = setup();
    await expect(create({ audience: "group", groupId: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(create({ audience: "group", groupId: 9999 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      create({ startsAt: "2030-01-02T00:00:00.000Z", endsAt: "2030-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await create({ audience: "group", groupId: 3 })).groupId).toBe(3);
    expect((await create({ audience: "guests", groupId: 3 })).groupId).toBeNull();
  });
});

describe("notices.current", () => {
  test("audiences: everyone, guests, members and a group (primary or secondary)", async () => {
    const { ctx, admin, moderator, member, memberUser, create, titles } = setup();
    await create({ title: "E", audience: "everyone" });
    await create({ title: "G", audience: "guests" });
    await create({ title: "M", audience: "members" });
    await create({ title: "Mods", audience: "group", groupId: 3 });
    expect(await titles(GUEST)).toEqual(["G", "E"]);
    expect(await titles(member)).toEqual(["M", "E"]);
    expect(await titles(moderator)).toEqual(["Mods", "M", "E"]);
    expect(await titles(admin)).toEqual(["M", "E"]);
    expect(await titles(tokenActor(memberUser))).toEqual(["M", "E"]);
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, ?2)")
      .run(memberUser.id, ctx.now());
    expect(await titles(member)).toEqual(["Mods", "M", "E"]);
  });

  test("inactive notices and those outside their dates are not shown", async () => {
    const { ctx, create, member, titles } = setup();
    const now = ctx.now();
    const at = (offset: number) => new Date(now + offset).toISOString();
    await create({ title: "Off", active: false });
    await create({ title: "Future", startsAt: at(60_000) });
    await create({ title: "Past", endsAt: at(-60_000) });
    await create({ title: "Window", startsAt: at(-60_000), endsAt: at(60_000) });
    await create({ title: "Open" });
    expect(await titles(member)).toEqual(["Open", "Window"]);
    expect(await titles(GUEST)).toEqual(["Open", "Window"]);
  });

  test("the queries read only the small notices table or an index", () => {
    const { ctx } = setup();
    expectNoTableScan(ctx, noticesSql.current, [Date.now()], { allow: ["notices"] });
    expectNoTableScan(ctx, noticesSql.dismissed, [1]);
  });
});

describe("notices.dismiss", () => {
  test("hides a dismissible notice for that member only, and repeating is harmless", async () => {
    const { ctx, member, admin, create, titles } = setup();
    const made = await create({ title: "Hide me" });
    await run(ctx, "notices.dismiss", member, { noticeId: made.id });
    await run(ctx, "notices.dismiss", member, { noticeId: made.id });
    expect(await titles(member)).toEqual([]);
    expect(await titles(admin)).toEqual(["Hide me"]);
    expect(await titles(GUEST)).toEqual(["Hide me"]);
  });

  test("editing does not bring it back; deleting removes the dismissals", async () => {
    const { ctx, member, admin, create, titles } = setup();
    const made = await create();
    await run(ctx, "notices.dismiss", member, { noticeId: made.id });
    await run(ctx, "notices.update", admin, { ...FIELDS, noticeId: made.id, title: "Edited" });
    expect(await titles(member)).toEqual([]);
    await run(ctx, "notices.delete", admin, { noticeId: made.id });
    expect(ctx.sqlite.prepare("SELECT id FROM notice_dismissals").all()).toHaveLength(0);
  });

  test("a notice that is not dismissible, not shown, or unknown is not found; guests sign in", async () => {
    const { ctx, member, create } = setup();
    const fixed = await create({ dismissible: false });
    const guests = await create({ audience: "guests" });
    const off = await create({ active: false });
    for (const id of [fixed.id, guests.id, off.id, 9999])
      await expect(run(ctx, "notices.dismiss", member, { noticeId: id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    await expect(run(ctx, "notices.dismiss", GUEST, { noticeId: fixed.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
