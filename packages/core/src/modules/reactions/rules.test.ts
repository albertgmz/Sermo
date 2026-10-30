import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import type { Rule } from "../../shared/criteria";
import { lockHint } from "../../shared/criteria/hint";
import { countStatements } from "../feed/fixtures.test";
import { readSiteSettings, storeSiteSettings } from "../settings";
import {
  reactionsRemoveOp,
  reactionsSetOp,
  reactionTypesCreateOp,
  reactionTypesListOp,
  reactionTypesUpdateOp,
} from "./index";

const everyone: Rule = { match: "all", conditions: [] };
const posts = (value: number): Rule => ({
  match: "all",
  conditions: [{ criterion: "post_count", value }],
});

function fixture() {
  const ctx = createTestContext();
  storeSiteSettings(ctx, { ...readSiteSettings(ctx), defaultLanguage: "en" });
  const author = insertUser(ctx);
  const reactor = insertUser(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  const support = insertNode(ctx, { title: "Support" });
  const lounge = insertNode(ctx, { title: "Lounge" });
  const category = insertNode(ctx, { title: "Category", type: "category" });
  const now = ctx.now();
  const post = (nodeId: number) => {
    const thread = ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Thread', ?3, ?3, ?2) RETURNING id",
      )
      .get(nodeId, author.id, now)!.id;
    const id = ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, ?3) RETURNING id",
      )
      .get(thread, author.id, now)!.id;
    ctx.sqlite
      .prepare("UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2")
      .run(id, thread);
    return id;
  };
  const wallPost = ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?1, ?2, 'b', 'b') RETURNING id",
    )
    .get(author.id, now)!.id;
  return {
    ctx,
    author,
    reactor,
    admin,
    support,
    lounge,
    category,
    supportPost: post(support.id),
    loungePost: post(lounge.id),
    wallPost,
    as: userActor(admin),
    reactorActor: userActor(reactor),
  };
}
type Fixture = ReturnType<typeof fixture>;

const create = (f: Fixture, fields: Record<string, unknown> = {}) =>
  execute(f.ctx, reactionTypesCreateOp, f.as, {
    title: "Crown",
    emoji: "C",
    ...fields,
  } as never);
const react = (f: Fixture, typeId: number, contentId: number, contentType = "post" as const) =>
  execute(f.ctx, reactionsSetOp, f.reactorActor, {
    contentType,
    contentId,
    reactionTypeId: typeId,
  });
const setPosts = (ctx: Ctx, userId: number, count: number) =>
  ctx.sqlite.prepare("UPDATE users SET post_count = ?1 WHERE id = ?2").run(count, userId);
const listFor = async (f: Fixture, actor = f.reactorActor) =>
  (await execute(f.ctx, reactionTypesListOp, actor, {})).items;

describe("reaction type rules", () => {
  test("a type with no rule and no forums is given by everyone, as before", async () => {
    const f = fixture();
    const type = await create(f);
    expect(type.rule).toEqual(everyone);
    expect(type.forumIds).toEqual([]);
    expect(type.hideWhenLocked).toBe(false);
    expect((await react(f, type.id, f.loungePost)).mine).toBe(type.id);
  });

  test("a member who fails the rule is refused, one who meets it reacts", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(500) });
    setPosts(f.ctx, f.reactor.id, 499);
    expect(react(f, type.id, f.loungePost)).rejects.toThrow(ForbiddenError);
    setPosts(f.ctx, f.reactor.id, 500);
    expect((await react(f, type.id, f.loungePost)).mine).toBe(type.id);
  });

  test("a rule is decided with the any/all match", async () => {
    const f = fixture();
    const type = await create(f, {
      rule: {
        match: "any",
        conditions: [
          { criterion: "post_count", value: 500 },
          { criterion: "reaction_score", value: 10 },
        ],
      },
    });
    expect(react(f, type.id, f.loungePost)).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite.prepare("UPDATE users SET reaction_score = 10 WHERE id = ?1").run(f.reactor.id);
    expect((await react(f, type.id, f.loungePost)).mine).toBe(type.id);
  });

  test("a group rule follows the member's groups", async () => {
    const f = fixture();
    const vip = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('VIP', 5) RETURNING id",
      )
      .get()!.id;
    const type = await create(f, {
      rule: { match: "all", conditions: [{ criterion: "in_group", ids: [vip] }] },
    });
    expect(react(f, type.id, f.loungePost)).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(f.reactor.id, vip);
    expect((await react(f, type.id, f.loungePost)).mine).toBe(type.id);
  });

  test("a type limited to forums is refused elsewhere and given in them", async () => {
    const f = fixture();
    const type = await create(f, { forumIds: [f.support.id] });
    expect(react(f, type.id, f.loungePost)).rejects.toThrow(ForbiddenError);
    expect((await react(f, type.id, f.supportPost)).mine).toBe(type.id);
  });

  test("content outside forums counts as elsewhere: refused when forums are listed, open when none", async () => {
    const f = fixture();
    const limited = await create(f, { forumIds: [f.support.id] });
    const open = await create(f, { title: "Open", emoji: "O" });
    expect(react(f, limited.id, f.wallPost, "profile_post" as never)).rejects.toThrow(
      ForbiddenError,
    );
    expect((await react(f, open.id, f.wallPost, "profile_post" as never)).mine).toBe(open.id);
  });

  test("the rule and the forum list both have to allow it", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(5), forumIds: [f.support.id] });
    setPosts(f.ctx, f.reactor.id, 5);
    expect(react(f, type.id, f.loungePost)).rejects.toThrow(ForbiddenError);
    setPosts(f.ctx, f.reactor.id, 4);
    expect(react(f, type.id, f.supportPost)).rejects.toThrow(ForbiddenError);
    setPosts(f.ctx, f.reactor.id, 5);
    expect((await react(f, type.id, f.supportPost)).mine).toBe(type.id);
  });

  test("a reaction already given stays and counts after its giver loses access", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(5), score: 3 });
    setPosts(f.ctx, f.reactor.id, 5);
    await react(f, type.id, f.loungePost);
    setPosts(f.ctx, f.reactor.id, 0);
    // Giving the same one again is not refused and changes nothing.
    const again = await react(f, type.id, f.loungePost);
    expect(again).toMatchObject({ mine: type.id, total: 1 });
    const score = () =>
      f.ctx.sqlite
        .prepare<{ reaction_score: number }, [number]>(
          "SELECT reaction_score FROM users WHERE id = ?1",
        )
        .get(f.author.id)!.reaction_score;
    expect(score()).toBe(3);
    // It can be taken back, and then cannot be given again.
    const removed = await execute(f.ctx, reactionsRemoveOp, f.reactorActor, {
      contentType: "post",
      contentId: f.loungePost,
    });
    expect(removed.total).toBe(0);
    expect(score()).toBe(0);
    expect(react(f, type.id, f.loungePost)).rejects.toThrow(ForbiddenError);
  });

  test("changing a locked reaction to an open one works, and back is refused", async () => {
    const f = fixture();
    const locked = await create(f, { rule: posts(5) });
    const open = await create(f, { title: "Like", emoji: "L" });
    setPosts(f.ctx, f.reactor.id, 5);
    await react(f, locked.id, f.loungePost);
    setPosts(f.ctx, f.reactor.id, 0);
    expect((await react(f, open.id, f.loungePost)).mine).toBe(open.id);
    expect(react(f, locked.id, f.loungePost)).rejects.toThrow(ForbiddenError);
  });
});

describe("reaction type picker state", () => {
  test("a type is open, locked with a hint, or hidden, by the viewer's standing", async () => {
    const f = fixture();
    const locked = await create(f, { title: "Fire", emoji: "F", rule: posts(500) });
    const hidden = await create(f, {
      title: "Star",
      emoji: "S",
      rule: posts(500),
      hideWhenLocked: true,
    });
    const open = await create(f, { title: "Like", emoji: "L" });
    const mine = new Set([locked.id, hidden.id, open.id]);
    const state = async (actor = f.reactorActor) =>
      Object.fromEntries(
        (await listFor(f, actor))
          .filter((t) => mine.has(t.id))
          .map((t) => [t.id, [t.access, t.lockHint]]),
      );
    expect(await state()).toEqual({
      [locked.id]: ["locked", "Unlocks with: Post count: 500 or more"],
      [hidden.id]: ["hidden", null],
      [open.id]: ["open", null],
    });
    setPosts(f.ctx, f.reactor.id, 500);
    expect(await state()).toEqual({
      [locked.id]: ["open", null],
      [hidden.id]: ["open", null],
      [open.id]: ["open", null],
    });
    // A guest has no facts: every ruled type is locked for them too.
    expect((await state(GUEST))[locked.id]).toEqual([
      "locked",
      "Unlocks with: Post count: 500 or more",
    ]);
  });

  test("the hint is in the viewer's language and joins conditions by the match", async () => {
    const f = fixture();
    const all = await create(f, {
      rule: {
        match: "all",
        conditions: [
          { criterion: "post_count", value: 500 },
          { criterion: "days_registered", value: 30 },
        ],
      },
    });
    const hint = async () => (await listFor(f)).find((t) => t.id === all.id)!.lockHint;
    expect(await hint()).toBe(
      "Unlocks with: Post count: 500 or more and Days registered: 30 or more",
    );
    f.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(f.reactor.id);
    expect(await hint()).toBe(
      "Se desbloquea con: Número de publicaciones: 500 o más y Días de registro: 30 o más",
    );
  });

  test("the client can name the language of the hints", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(500) });
    const hint = async (language?: "en" | "es") =>
      (
        await execute(f.ctx, reactionTypesListOp, f.reactorActor, language ? { language } : {})
      ).items.find((t) => t.id === type.id)!.lockHint;
    expect(await hint("es")).toBe("Se desbloquea con: Número de publicaciones: 500 o más");
    expect(await hint("en")).toBe("Unlocks with: Post count: 500 or more");
    expect(await hint()).toBe("Unlocks with: Post count: 500 or more");
  });

  test("a yes/no criterion and an or-match are phrased; anything else is plain Locked", async () => {
    const f = fixture();
    const vip = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('VIP', 5) RETURNING id",
      )
      .get()!.id;
    const hintOf = async (rule: Rule) => {
      const type = await create(f, { title: `T${Math.random()}`, rule });
      return (await listFor(f)).find((t) => t.id === type.id)!.lockHint;
    };
    expect(
      await hintOf({ match: "all", conditions: [{ criterion: "has_avatar", value: 1 }] }),
    ).toBe("Unlocks with: Has an avatar");
    expect(
      await hintOf({
        match: "any",
        conditions: [
          { criterion: "post_count", value: 10 },
          { criterion: "has_avatar", value: 1 },
        ],
      }),
    ).toBe("Unlocks with: Post count: 10 or more or Has an avatar");
    // Too involved to phrase: a window, a list read in a mode, a boolean that must not hold, and
    // any group list (group titles are not public).
    for (const rule of [
      { match: "all", conditions: [{ criterion: "in_group", ids: [vip] }] },
      { match: "all", conditions: [{ criterion: "has_avatar", value: 0 }] },
      { match: "all", conditions: [{ criterion: "not_in_group", ids: [vip] }] },
      { match: "all", conditions: [{ criterion: "credits_earned", value: 5, days: 7 }] },
      { match: "all", conditions: [{ criterion: "holds_awards", ids: [1], mode: "each" }] },
      { match: "all", conditions: [{ criterion: "no_such_criterion" }] },
      { match: "all", conditions: [] },
    ] as Rule[])
      expect(lockHint("en", rule)).toBe("Locked");
    expect(lockHint("es", everyone)).toBe("Bloqueada");
  });

  test("a rename or a reorder is not stopped by a stored rule that names a group deleted since", async () => {
    const f = fixture();
    const vip = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('VIP', 5) RETURNING id",
      )
      .get()!.id;
    const type = await create(f, {
      rule: { match: "all", conditions: [{ criterion: "in_group", ids: [vip] }] },
    });
    f.ctx.sqlite.prepare("DELETE FROM groups WHERE id = ?1").run(vip);
    const moved = await execute(f.ctx, reactionTypesUpdateOp, f.as, {
      reactionTypeId: type.id,
      position: 9,
    });
    expect(moved.position).toBe(9);
    expect(moved.rule).toEqual({
      match: "all",
      conditions: [{ criterion: "in_group", ids: [vip] }],
    });
    // Saving the rule itself is checked again.
    expect(
      execute(f.ctx, reactionTypesUpdateOp, f.as, {
        reactionTypeId: type.id,
        rule: { match: "all", conditions: [{ criterion: "in_group", ids: [vip] }] },
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("only administrators see the rule", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(5), forumIds: [f.support.id] });
    const seen = (items: Awaited<ReturnType<typeof listFor>>) =>
      items.find((t) => t.id === type.id)!;
    expect(seen(await listFor(f)).rule).toBeNull();
    expect(seen(await listFor(f)).forumIds).toEqual([f.support.id]);
    expect(seen(await listFor(f, GUEST)).rule).toBeNull();
    expect(seen(await listFor(f, f.as)).rule).toEqual(posts(5));
  });

  test("an inactive type is never locked or hidden", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(5), isActive: false });
    const item = (await listFor(f)).find((t) => t.id === type.id)!;
    expect([item.access, item.lockHint]).toEqual(["open", null]);
  });
});

describe("saving a rule and forums", () => {
  test("a rule of heavy criteria is refused, the stored one stays", async () => {
    const f = fixture();
    const type = await create(f, { rule: posts(5) });
    expect(
      execute(f.ctx, reactionTypesUpdateOp, f.as, {
        reactionTypeId: type.id,
        rule: { match: "all", conditions: [{ criterion: "warning_points_below", value: 3 }] },
      }),
    ).rejects.toThrow(ValidationError);
    expect((await listFor(f, f.as)).find((t) => t.id === type.id)!.rule).toEqual(posts(5));
  });

  test("a rule that reads the member's history is refused, whatever else it holds", async () => {
    const f = fixture();
    const heavy = (criterion: string) => ({
      match: "all",
      conditions: [
        { criterion: "post_count", value: 1 },
        { criterion, value: 0 },
      ],
    });
    for (const criterion of ["thread_banned", "banned_before"]) {
      expect(create(f, { rule: heavy(criterion) })).rejects.toThrow(
        new RegExp(`cannot use ${criterion}`),
      );
    }
    const type = await create(f);
    expect(
      execute(f.ctx, reactionTypesUpdateOp, f.as, {
        reactionTypeId: type.id,
        rule: heavy("thread_banned"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("forums must exist and must be forums, not categories", async () => {
    const f = fixture();
    expect(create(f, { forumIds: [f.category.id] })).rejects.toThrow(ValidationError);
    expect(create(f, { forumIds: [9999] })).rejects.toThrow(ValidationError);
    const type = await create(f, { forumIds: [f.support.id, f.support.id] });
    expect(type.forumIds).toEqual([f.support.id]);
  });

  test("an update changes only what it names", async () => {
    const f = fixture();
    const type = await create(f, {
      rule: posts(5),
      forumIds: [f.support.id],
      hideWhenLocked: true,
    });
    const renamed = await execute(f.ctx, reactionTypesUpdateOp, f.as, {
      reactionTypeId: type.id,
      title: "Crowned",
    });
    expect(renamed).toMatchObject({
      title: "Crowned",
      rule: posts(5),
      forumIds: [f.support.id],
      hideWhenLocked: true,
    });
    const cleared = await execute(f.ctx, reactionTypesUpdateOp, f.as, {
      reactionTypeId: type.id,
      rule: everyone,
      forumIds: [],
      hideWhenLocked: false,
    });
    expect(cleared).toMatchObject({ rule: everyone, forumIds: [], hideWhenLocked: false });
  });

  test("a member cannot save a rule", async () => {
    const f = fixture();
    expect(
      execute(f.ctx, reactionTypesCreateOp, f.reactorActor, {
        title: "X",
        emoji: "X",
      } as never),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("what the rules cost", () => {
  // Statements of one list call once the type cache is warm.
  const listCost = async (f: Fixture, actor: Actor, language?: "en" | "es") => {
    const input = language ? { language } : {};
    await execute(f.ctx, reactionTypesListOp, actor, input);
    return countStatements(f.ctx, () => execute(f.ctx, reactionTypesListOp, actor, input));
  };

  test("the list adds one statement for a member however many types have rules, none for a guest", async () => {
    const f = fixture();
    const plain = await listCost(f, f.reactorActor);
    const guestPlain = await listCost(f, GUEST);
    for (let n = 0; n < 6; n++) {
      await create(f, {
        title: `T${n}`,
        rule: {
          match: "all",
          conditions: [
            { criterion: "post_count", value: n },
            { criterion: "days_registered", value: n },
          ],
        },
        hideWhenLocked: true,
      });
    }
    expect((await listCost(f, f.reactorActor)) - plain).toBe(1);
    // A guest has no facts to load.
    expect(await listCost(f, GUEST)).toBe(guestPlain);
  });

  test("the rules of every kind a reaction type may use cost at most three statements", async () => {
    const f = fixture();
    const base = await listCost(f, f.reactorActor, "en");
    const vip = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('VIP', 5) RETURNING id",
      )
      .get()!.id;
    for (const rule of [
      posts(1),
      { match: "all", conditions: [{ criterion: "reaction_score", value: 1 }] },
      { match: "all", conditions: [{ criterion: "days_registered", value: 1 }] },
      { match: "any", conditions: [{ criterion: "in_group", ids: [vip] }] },
      { match: "all", conditions: [{ criterion: "not_in_group", ids: [vip] }] },
      { match: "all", conditions: [{ criterion: "purchases_at_least", value: 1 }] },
    ] as Rule[])
      await create(f, { title: `T${Math.random()}`, rule });
    // the member's row, the member's groups; purchases_at_least is a count on the row
    expect((await listCost(f, f.reactorActor, "en")) - base).toBe(2);
  });

  test("a locked hint costs the viewer's language unless the client names it", async () => {
    const f = fixture();
    const base = await listCost(f, f.reactorActor);
    await create(f, { rule: posts(500) });
    await create(f, { title: "B", rule: posts(600) });
    // facts, plus the member's language and the site's, once for all the hints
    expect((await listCost(f, f.reactorActor)) - base).toBe(3);
    expect((await listCost(f, f.reactorActor, "es")) - base).toBe(1);
    const vip = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('VIP', 5) RETURNING id",
      )
      .get()!.id;
    await create(f, {
      title: "C",
      rule: { match: "all", conditions: [{ criterion: "in_group", ids: [vip] }] },
    });
    // the group rule reads the member's groups: one more statement, whatever the hints
    expect((await listCost(f, f.reactorActor, "es")) - base).toBe(2);
  });

  test("a reaction with a rule decides it from one facts statement", async () => {
    const f = fixture();
    const plain = await create(f, { title: "Plain", emoji: "P" });
    const ruled = await create(f, { rule: posts(0) });
    const statements = (typeId: number, post: number) =>
      countStatements(f.ctx, () => react(f, typeId, post));
    const withoutRule = await statements(plain.id, f.loungePost);
    const withRule = await statements(ruled.id, f.supportPost);
    expect(withRule - withoutRule).toBe(1);
  });
});
