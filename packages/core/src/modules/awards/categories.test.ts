import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { ruleThreshold as threshold } from "../../shared/criteria";
import { customMember, setEntry } from "../permissions/group-fixture";
import { categorySql } from "./categories";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const memberRow = insertUser(ctx);
  const member = userActor(memberRow);
  const as = (actor: typeof admin, name: string, input: unknown = {}) =>
    execute(ctx, getOperation(name), actor, input);
  const call = (name: string, input: unknown = {}) => as(admin, name, input);
  return { ctx, admin, member, memberId: memberRow.id, as, call };
}
const ids = (list: { items: { id: number }[] }) => list.items.map((item) => item.id);
const logged = (ctx: ReturnType<typeof createTestContext>) =>
  ctx.sqlite
    .prepare("SELECT action, target_type, target_id FROM moderator_log ORDER BY id")
    .all() as { action: string; target_type: string; target_id: number }[];
const atLeast = (criterion: string, value: number) => ({
  match: "all",
  conditions: [{ criterion, value }],
});

describe("award categories", () => {
  test("are listed by position then id, and a new one without a position goes last", async () => {
    const { ctx, call } = setup();
    const posts = await call("awardCategories.create", { title: "By posts", position: 5 });
    const welcome = await call("awardCategories.create", { title: "Welcome", position: 1 });
    const tie = await call("awardCategories.create", { title: "Also five", position: 5 });
    const last = await call("awardCategories.create", { title: "Specials" });
    expect(last.position).toBe(6);
    expect(last.description).toBe("");
    expect(ids(await call("awardCategories.list"))).toEqual([
      welcome.id,
      posts.id,
      tie.id,
      last.id,
    ]);

    const moved = await call("awardCategories.update", {
      categoryId: welcome.id,
      title: "Welcome aboard",
      description: "The first steps.",
      position: 9,
    });
    expect(moved).toMatchObject({ title: "Welcome aboard", description: "The first steps." });
    expect(ids(await call("awardCategories.list"))).toEqual([
      posts.id,
      tie.id,
      last.id,
      welcome.id,
    ]);
    // Only the fields sent change.
    expect(
      await call("awardCategories.update", { categoryId: welcome.id, title: "Hello" }),
    ).toMatchObject({ title: "Hello", description: "The first steps.", position: 9 });

    await call("awardCategories.delete", { categoryId: tie.id });
    expect(ids(await call("awardCategories.list"))).toEqual([posts.id, last.id, welcome.id]);
    await expect(
      call("awardCategories.update", { categoryId: tie.id, title: "Gone" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(call("awardCategories.delete", { categoryId: tie.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(logged(ctx).map((row) => row.action)).toEqual([
      "awardCategory.create",
      "awardCategory.create",
      "awardCategory.create",
      "awardCategory.create",
      "awardCategory.update",
      "awardCategory.update",
      "awardCategory.delete",
    ]);
    expect(logged(ctx).at(-1)).toMatchObject({ target_type: "award_category", target_id: tie.id });
  });

  test("a new category after one at the highest position still ends last", async () => {
    const { call } = setup();
    const top = await call("awardCategories.create", { title: "Top", position: 1_000_000 });
    const next = await call("awardCategories.create", { title: "Next" });
    expect(next.position).toBe(1_000_000);
    expect(ids(await call("awardCategories.list"))).toEqual([top.id, next.id]);
  });

  test("count the awards the viewer can see", async () => {
    const { member, as, call } = setup();
    const category = await call("awardCategories.create", { title: "Mixed" });
    await call("awards.create", { name: "On", tier: "bronze", categoryId: category.id });
    await call("awards.create", {
      name: "Off",
      tier: "bronze",
      categoryId: category.id,
      isActive: false,
    });
    expect((await call("awardCategories.list")).items[0].awardCount).toBe(2);
    expect((await as(member, "awardCategories.list")).items[0].awardCount).toBe(1);
    expect((await as(GUEST, "awardCategories.list")).items[0].awardCount).toBe(1);
  });

  test("only award managers write them; the list needs profile.view", async () => {
    const { ctx, member, as, call } = setup();
    const category = await call("awardCategories.create", { title: "Kept" });
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    for (const actor of [member, moderator]) {
      await expect(as(actor, "awardCategories.create", { title: "No" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        as(actor, "awardCategories.update", { categoryId: category.id, title: "No" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        as(actor, "awardCategories.delete", { categoryId: category.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(as(GUEST, "awardCategories.create", { title: "No" })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(ids(await call("awardCategories.list"))).toEqual([category.id]);
    // A guest who may not view profiles sees no catalog, as with the awards themselves.
    setEntry(ctx, 1, "profile.view", 0);
    await expect(as(GUEST, "awardCategories.list")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(GUEST, "awards.list")).rejects.toBeInstanceOf(ForbiddenError);
    expect(logged(ctx)).toHaveLength(1);
  });

  test("deleting one leaves its awards without a category, listed last", async () => {
    const { call } = setup();
    const doomed = await call("awardCategories.create", { title: "Doomed" });
    const kept = await call("awardCategories.create", { title: "Kept" });
    const moved = await call("awards.create", {
      name: "Moved",
      tier: "gold",
      categoryId: doomed.id,
    });
    const stays = await call("awards.create", { name: "Stays", tier: "gold", categoryId: kept.id });
    expect(ids(await call("awards.list"))).toEqual([moved.id, stays.id]);
    await call("awardCategories.delete", { categoryId: doomed.id });
    expect((await call("awards.get", { awardId: moved.id })).category).toBeNull();
    expect((await call("awards.get", { awardId: stays.id })).category).toEqual({
      id: kept.id,
      title: "Kept",
    });
    expect(ids(await call("awards.list"))).toEqual([stays.id, moved.id]);
  });
});

describe("an award's category", () => {
  test("is set, changed, kept and cleared through the award, and must exist", async () => {
    const { member, memberId, as, call } = setup();
    const posts = await call("awardCategories.create", { title: "By posts" });
    const other = await call("awardCategories.create", { title: "Other" });
    const award = await call("awards.create", {
      name: "Writer",
      tier: "silver",
      categoryId: posts.id,
    });
    expect(award.category).toEqual({ id: posts.id, title: "By posts" });
    expect((await call("awards.update", { awardId: award.id, xp: 5 })).category?.id).toBe(posts.id);
    expect(
      (await call("awards.update", { awardId: award.id, categoryId: other.id })).category?.id,
    ).toBe(other.id);
    await call("awardCategories.update", { categoryId: other.id, title: "Renamed" });
    // Every read of an award carries the category's current title.
    const grant = await call("awards.grant", { userId: memberId, awardId: award.id });
    expect(grant.award.category).toEqual({ id: other.id, title: "Renamed" });
    expect(
      (await as(member, "awards.member", { userId: memberId })).items[0].award.category,
    ).toEqual({ id: other.id, title: "Renamed" });
    expect(
      (await call("awards.holders", { awardId: award.id })).items[0].award.category?.title,
    ).toBe("Renamed");
    expect(
      (await call("awards.update", { awardId: award.id, categoryId: null })).category,
    ).toBeNull();
    for (const attempt of [
      call("awards.create", { name: "Lost", tier: "bronze", categoryId: 999 }),
      call("awards.update", { awardId: award.id, categoryId: 999 }),
    ])
      await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    expect((await call("awards.get", { awardId: award.id })).category).toBeNull();
    expect((await call("awards.list")).items).toHaveLength(1);
  });
});

describe("the catalog order", () => {
  test("groups by category position, easiest first inside, uncategorized last", async () => {
    const { member, as, call } = setup();
    const posts = await call("awardCategories.create", { title: "By posts", position: 2 });
    const welcome = await call("awardCategories.create", { title: "Welcome", position: 1 });
    const empty = await call("awardCategories.create", { title: "Empty", position: 0 });
    const make = async (name: string, fields: Record<string, unknown>) =>
      (await call("awards.create", { name, tier: "bronze", ...fields })).id;
    // A ladder: thresholds decide whatever the XP; a manual award comes after the rungs.
    const p1000 = await make("1000 posts", {
      categoryId: posts.id,
      xp: 5,
      rule: atLeast("post_count", 1000),
    });
    const manual = await make("Hand-picked", { categoryId: posts.id, xp: 1 });
    const p10 = await make("10 posts", {
      categoryId: posts.id,
      xp: 50,
      rule: atLeast("post_count", 10),
    });
    const p100 = await make("100 posts", {
      categoryId: posts.id,
      xp: 20,
      rule: atLeast("post_count", 100),
    });
    // No thresholds: XP ascending, then name.
    const hello = await make("Hello", { categoryId: welcome.id, xp: 10 });
    const avatar = await make("Avatar", { categoryId: welcome.id, xp: 10 });
    const first = await make("First", { categoryId: welcome.id, xp: 2 });
    // A yes/no condition is no threshold.
    const verified = await make("Verified", {
      categoryId: welcome.id,
      xp: 1,
      rule: { match: "all", conditions: [{ criterion: "email_verified", value: 1 }] },
    });
    const loose = await make("Loose", { xp: 0 });
    const expected = [verified, first, avatar, hello, p10, p100, p1000, manual, loose];
    expect(ids(await call("awards.list"))).toEqual(expected);
    // The order does not depend on seeing the rules.
    expect(ids(await as(member, "awards.list"))).toEqual(expected);
    expect(ids(await as(GUEST, "awards.list"))).toEqual(expected);
    // Moving a category moves its awards.
    await call("awardCategories.update", { categoryId: posts.id, position: 0 });
    expect(ids(await call("awards.list"))).toEqual([
      p10,
      p100,
      p1000,
      manual,
      verified,
      first,
      avatar,
      hello,
      loose,
    ]);
    expect(empty.awardCount).toBe(0);
  });

  test("a threshold is the number of the first at-least condition", () => {
    expect(threshold({ match: "all", conditions: [] })).toBeNull();
    expect(
      threshold({
        match: "all",
        conditions: [
          { criterion: "email_verified", value: 1 },
          { criterion: "days_registered", value: 30 },
          { criterion: "post_count", value: 5 },
        ],
      }),
    ).toBe(30);
    expect(
      threshold({ match: "any", conditions: [{ criterion: "credits_at_most", value: 9 }] }),
    ).toBeNull();
  });
});

test("category queries use the primary key and the awards' category index", () => {
  const { ctx } = setup();
  const small = { allow: ["award_categories"], allowTempBTree: true };
  expectNoTableScan(ctx, categorySql.list, [0], small);
  expectNoTableScan(ctx, categorySql.category, [1, 1]);
  expectNoTableScan(ctx, categorySql.exists, [1]);
  expectNoTableScan(ctx, categorySql.next, [], small);
  const plan = ctx.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${categorySql.list}`)
    .all(0)
    .map((row) => (row as { detail: string }).detail)
    .join("\n");
  expect(plan).toContain("awards_category");
});

describe("a category write is judged on the actor's permissions in its transaction", () => {
  for (const name of ["create", "update", "delete"] as const)
    test(`awardCategories.${name} is refused when admin.awards was taken away meanwhile`, async () => {
      const { ctx, call } = setup();
      const staff = customMember(ctx, ["site.view", "profile.view", "admin.awards"]);
      const category = await call("awardCategories.create", { title: "Target" });
      const database = sharedDatabase(ctx);
      try {
        const here = database.open();
        const elsewhere = database.open();
        const actor = resolvedActor(here, staff.row.id);
        // Warm: this process has read what the member may do.
        await execute(here, getOperation("awardCategories.list"), actor, {});
        setEntry(elsewhere, staff.groupId, "admin.awards", 0);
        const snapshot = () =>
          JSON.stringify(elsewhere.sqlite.prepare("SELECT * FROM award_categories").all());
        const before = snapshot();
        const input = { title: "Changed", categoryId: category.id };
        await expect(
          execute(
            here,
            getOperation(`awardCategories.${name}`),
            actor,
            name === "create"
              ? { title: "New" }
              : name === "delete"
                ? { categoryId: category.id }
                : input,
          ),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(snapshot()).toBe(before);
      } finally {
        database.close();
      }
    });
});
