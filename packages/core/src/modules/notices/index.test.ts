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

const rule = (...conditions: object[]) => ({ match: "all", conditions });
const GUESTS = rule({ criterion: "is_guest", value: 1 });
const MEMBERS = rule({ criterion: "is_guest", value: 0 });
const inGroup = (id: number) => rule({ criterion: "in_group", ids: [id] });

const FIELDS = {
  title: "Notice",
  body: "Hello [B]there[/B]",
  rule: rule(),
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
      rule: MEMBERS,
      dismissible: false,
    });
    expect(updated.title).toBe("Changed");
    expect(updated.rule).toEqual(MEMBERS);
    expect((await run(ctx, "notices.list", admin)).items).toHaveLength(1);
    await run(ctx, "notices.delete", admin, { noticeId: made.id });
    expect((await run(ctx, "notices.list", admin)).items).toHaveLength(0);
    await expect(run(ctx, "notices.delete", admin, { noticeId: made.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("the rule must be valid and cheap to check; the end must follow the start", async () => {
    const { ctx, admin, create } = setup();
    const refused = [
      inGroup(9999),
      rule({ criterion: "made_up", value: 1 }),
      rule({ criterion: "post_count" }),
      rule({ criterion: "is_guest", value: 2 }),
      // Summing warnings is not allowed while a page is served.
      rule({ criterion: "warning_points_below", value: 3 }),
    ];
    for (const bad of refused)
      await expect(create({ rule: bad })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ startsAt: "2030-01-02T00:00:00.000Z", endsAt: "2030-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await create({ rule: inGroup(3) })).rule).toEqual(inGroup(3));
    const made = await create();
    await expect(
      run(ctx, "notices.update", admin, {
        ...FIELDS,
        noticeId: made.id,
        rule: refused[4],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const listed = (await run(ctx, "notices.list", admin)).items;
    expect(listed.find((item: { id: number }) => item.id === made.id).rule).toEqual(rule());
  });
});

describe("notices.current", () => {
  test("rules: everyone, guests, members and a group (primary or secondary)", async () => {
    const { ctx, admin, moderator, member, memberUser, create, titles } = setup();
    await create({ title: "E", rule: rule() });
    await create({ title: "G", rule: GUESTS });
    await create({ title: "M", rule: MEMBERS });
    await create({ title: "Mods", rule: inGroup(3) });
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

  test("a list of members, any/all matching and the member's own facts", async () => {
    const { ctx, moderator, member, memberUser, create, titles } = setup();
    const other = insertUser(ctx);
    await create({ title: "Listed", rule: rule({ criterion: "is_member", ids: [memberUser.id] }) });
    await create({
      title: "Guests or mods",
      rule: { match: "any", conditions: [...GUESTS.conditions, ...inGroup(3).conditions] },
    });
    await create({ title: "Not mods", rule: rule({ criterion: "not_in_group", ids: [3] }) });
    await create({ title: "Rich", rule: rule({ criterion: "credits_at_least", value: 50 }) });
    expect(await titles(member)).toEqual(["Not mods", "Listed"]);
    expect(await titles(userActor(other))).toEqual(["Not mods"]);
    expect(await titles(moderator)).toEqual(["Guests or mods"]);
    expect(await titles(GUEST)).toEqual(["Not mods", "Guests or mods"]);
    ctx.sqlite.prepare("UPDATE users SET credits = 50 WHERE id = ?1").run(memberUser.id);
    expect(await titles(member)).toEqual(["Rich", "Not mods", "Listed"]);
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
    const guests = await create({ rule: GUESTS });
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
