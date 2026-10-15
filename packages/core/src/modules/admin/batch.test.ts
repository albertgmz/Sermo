import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { expectNoTableScan, insertUser } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { getAuth } from "../auth";
import { batchSql } from "./batch";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

const inGroup = (id: number) => ({
  kind: "criteria" as const,
  rule: { match: "all" as const, conditions: [{ criterion: "in_group", ids: [id] }] },
});

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const rival = await w.register("Rival", 4);
  const moderator = await w.register("Moderator", 3);
  const boss = await w.register("Boss", 2);
  w.ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(boss.id);
  // A group made by hand that manages members and bans for at most a week; it outranks moderators.
  const helpers = await w.run("groups.create", founder.actor, { title: "Helpers", rank: 60 });
  await w.run("permissions.set", founder.actor, {
    groupId: helpers.id,
    entries: [
      { permission: "admin.members", value: "allow" },
      { permission: "member.ban", value: "allow" },
      { permission: "member.banMaxDays", value: 7 },
      { permission: "member.editProfile", value: "allow" },
    ],
  });
  const helper = await w.register("Helper", helpers.id);
  const names = ["Alpha", "Bravo", "Charlie", "Delta"];
  const members = [];
  for (const name of names) members.push(await w.register(name));
  const chosen = await w.run("groups.create", founder.actor, { title: "Chosen", rank: 20 });
  // The way the panel does it: preview a selection, then apply to the ids the preview returned.
  const preview = (selection: object, actor: object = founder.actor) =>
    w.run("users.batchPreview", actor, { selection });
  const apply = (actor: object, userIds: number[], action: object, extra: object = {}) =>
    w.run("users.batchUpdate", actor, { userIds, action, ...extra });
  const batch = async (actor: object, selection: object, action: object, extra: object = {}) =>
    apply(
      actor,
      (await preview(selection)).items.map((item: { id: number }) => item.id),
      action,
      extra,
    );
  const list = (...who: (string | number)[]) => ({
    kind: "list" as const,
    members: who.map(String),
  });
  const entries = (id: number) => w.logOf(id).map((entry) => entry.action);
  const stored = (id: number) =>
    w.ctx.sqlite
      .prepare<Record<string, unknown>, [number]>("SELECT * FROM users WHERE id = ?1")
      .get(id)!;
  return {
    ...w,
    founder,
    rival,
    moderator,
    boss,
    helper,
    helpers,
    members,
    chosen,
    batch,
    preview,
    apply,
    list,
    entries,
    stored,
  };
}

describe("users.batchPreview", () => {
  test("a list names members by id or username, once each, in order, and reports what matched nobody", async () => {
    const w = await world();
    const [alpha, bravo] = w.members;
    const preview = await w.run("users.batchPreview", w.founder.actor, {
      selection: w.list("bravo", alpha!.id, "Nobody", bravo!.id, "999999"),
    });
    expect(preview).toEqual({
      items: [
        { id: bravo!.id, username: "Bravo" },
        { id: alpha!.id, username: "Alpha" },
      ],
      unknown: ["Nobody", "999999"],
      next: null,
    });
  });

  test("criteria go through the criteria engine: the first 100 matches, then where to resume", async () => {
    const w = await world();
    const [alpha, bravo] = w.members;
    for (const member of [alpha!, bravo!])
      await w.run("users.setGroups", w.founder.actor, {
        userId: member.id,
        secondaryGroupIds: [w.chosen.id],
        actorPassword: PASSWORD,
      });
    const few = await w.run("users.batchPreview", w.founder.actor, {
      selection: inGroup(w.chosen.id),
    });
    expect(few.items.map((item: { id: number }) => item.id)).toEqual([alpha!.id, bravo!.id]);
    expect(few.next).toBeNull();

    const many = [];
    for (let i = 0; i < 120; i++) many.push(insertUser(w.ctx).id);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO user_groups (user_id, group_id, created_at) SELECT value, ?2, 1 FROM json_each(?1)",
      )
      .run(JSON.stringify(many), w.chosen.id);
    const first = await w.run("users.batchPreview", w.founder.actor, {
      selection: inGroup(w.chosen.id),
    });
    expect(first.items).toHaveLength(100);
    expect(first.next).toBe(first.items.at(-1).id);
    const rest = await w.run("users.batchPreview", w.founder.actor, {
      selection: { ...inGroup(w.chosen.id), after: first.next },
    });
    expect(rest.items).toHaveLength(22);
    expect(rest.next).toBeNull();
  });

  test("never selects an erased account, and an empty rule is refused", async () => {
    const w = await world();
    const [alpha] = w.members;
    w.ctx.sqlite.prepare("UPDATE users SET erased_at = 1 WHERE id = ?1").run(alpha!.id);
    const all = {
      kind: "criteria",
      rule: { match: "all", conditions: [{ criterion: "post_count", value: 0 }] },
    };
    const preview = await w.run("users.batchPreview", w.founder.actor, { selection: all });
    expect(preview.items.map((item: { id: number }) => item.id)).not.toContain(alpha!.id);
    await expect(
      w.run("users.batchPreview", w.founder.actor, {
        selection: { kind: "criteria", rule: { match: "all", conditions: [] } },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Ids the engine cannot know are refused up front.
    await expect(
      w.run("users.batchPreview", w.founder.actor, { selection: inGroup(999_999) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("the scan reads the members through the primary key", async () => {
    const w = await world();
    expectNoTableScan(w.ctx, batchSql.scan, [0, 200]);
  });

  test("is for those who manage members", async () => {
    const w = await world();
    const selection = w.list("Alpha");
    await expect(w.run("users.batchPreview", GUEST, { selection })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [w.members[0]!.actor, w.moderator.actor])
      await expect(w.run("users.batchPreview", actor, { selection })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    expect((await w.run("users.batchPreview", w.helper.actor, { selection })).items).toHaveLength(
      1,
    );
  });
});

describe("users.batchUpdate", () => {
  test("sets the primary group, adds and removes a secondary one: one log entry per member changed", async () => {
    const w = await world();
    const ids = w.members.map((m) => m.id);
    const set = await w.batch(
      w.founder.actor,
      w.list(...ids),
      { type: "setGroup", groupId: w.chosen.id },
      { actorPassword: PASSWORD },
    );
    expect(set).toMatchObject({ done: 4, skipped: 0, failed: 0 });
    for (const id of ids) {
      expect(w.stored(id).group_id).toBe(w.chosen.id);
      expect(w.entries(id)).toEqual(["user.groups"]);
    }
    // Again: nothing to change, and nothing logged.
    const again = await w.batch(
      w.founder.actor,
      w.list(...ids),
      { type: "setGroup", groupId: w.chosen.id },
      { actorPassword: PASSWORD },
    );
    expect(again).toMatchObject({ done: 0, skipped: 4 });
    expect(again.items[0].message).toBe("Already in that primary group.");
    for (const id of ids) expect(w.entries(id)).toEqual(["user.groups"]);

    await w.batch(
      w.founder.actor,
      w.list(...ids),
      { type: "addGroup", groupId: 3 },
      { actorPassword: PASSWORD },
    );
    const held = await w.run("users.getGroups", w.founder.actor, { userId: ids[0] });
    expect(held.secondaryGroupIds).toEqual([3]);
    const removed = await w.batch(
      w.founder.actor,
      w.list(...ids),
      { type: "removeGroup", groupId: 3 },
      { actorPassword: PASSWORD },
    );
    expect(removed.done).toBe(4);
    expect(
      (await w.run("users.getGroups", w.founder.actor, { userId: ids[0] })).secondaryGroupIds,
    ).toEqual([]);
    const missing = await w.batch(
      w.founder.actor,
      w.list(ids[0]!),
      { type: "removeGroup", groupId: 3 },
      { actorPassword: PASSWORD },
    );
    expect(missing.items[0]).toMatchObject({
      status: "skipped",
      message: "Does not hold that group by hand.",
    });
  });

  test("a group needs the actor's own password, as users.setGroups does", async () => {
    const w = await world();
    const interactive = { ...(w.founder.actor as object), interactive: true };
    await expect(
      w.batch(interactive, w.list("Alpha"), { type: "setGroup", groupId: w.chosen.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(w.stored(w.members[0]!.id).group_id).toBe(2);
    expect(
      await w.batch(
        interactive,
        w.list("Alpha"),
        { type: "setGroup", groupId: w.chosen.id },
        { actorPassword: PASSWORD },
      ),
    ).toMatchObject({ done: 1 });
  });

  test("a group at or above the actor's rank cannot be given: every member is reported", async () => {
    const w = await world();
    const result = await w.batch(
      w.helper.actor,
      w.list("Alpha", "Bravo"),
      { type: "setGroup", groupId: 4 },
      { actorPassword: PASSWORD },
    );
    expect(result).toMatchObject({ done: 0, skipped: 2 });
    expect(w.stored(w.members[0]!.id).group_id).toBe(2);
  });

  test("sets and clears the custom title, removes signatures and avatars", async () => {
    const w = await world();
    const [alpha, bravo] = w.members;
    const titled = await w.batch(w.founder.actor, w.list("Alpha", "Bravo"), {
      type: "setTitle",
      title: "  Founding   member ",
    });
    expect(titled).toMatchObject({ done: 2 });
    expect(w.stored(alpha!.id).custom_title).toBe("Founding member");
    expect(w.entries(alpha!.id)).toEqual(["member.profile"]);
    const same = await w.batch(w.founder.actor, w.list("Alpha"), {
      type: "setTitle",
      title: "Founding member",
    });
    expect(same.items[0]).toMatchObject({ status: "skipped", message: "Already has that title." });
    expect(w.entries(alpha!.id)).toEqual(["member.profile"]);
    await expect(
      w.batch(w.founder.actor, w.list("Alpha"), { type: "setTitle", title: "x".repeat(60) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      await w.batch(w.founder.actor, w.list("Alpha", "Bravo"), { type: "setTitle", title: null }),
    ).toMatchObject({ done: 2 });
    expect(w.stored(alpha!.id).custom_title).toBeNull();

    await w.run("users.adminUpdateProfile", w.founder.actor, {
      userId: alpha!.id,
      signature: "Signed",
    });
    const signatures = await w.batch(w.founder.actor, w.list("Alpha", "Bravo"), {
      type: "removeSignature",
    });
    expect(signatures.items.map((item: { status: string }) => item.status)).toEqual([
      "done",
      "skipped",
    ]);
    expect(w.stored(alpha!.id).signature_source).toBeNull();

    const avatar = w.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, attached_at) VALUES ('fake', 'k' || ?2, 1, 'image/png', 'h', ?1, 'avatar', 'public', ?2, ?2) RETURNING id",
      )
      .get(bravo!.id, w.ctx.now())!.id;
    w.ctx.sqlite
      .prepare("UPDATE users SET avatar_file_id = ?1 WHERE id = ?2")
      .run(avatar, bravo!.id);
    const avatars = await w.batch(w.founder.actor, w.list("Alpha", "Bravo"), {
      type: "removeAvatar",
    });
    expect(avatars.items.map((item: { status: string }) => item.status)).toEqual([
      "skipped",
      "done",
    ]);
    expect(w.stored(bravo!.id).avatar_file_id).toBeNull();
  });

  test("bans for a time within the actor's reach, lifts bans in force, and logs each", async () => {
    const w = await world();
    const [alpha, bravo] = w.members;
    const ban = (actor: object, days: number | null, extra: object = {}) =>
      w.batch(
        actor,
        w.list("Alpha", "Bravo"),
        { type: "ban", days, notify: false },
        { reason: "Spam run", ...extra },
      );
    // A reason is needed, and a helper's reach is a week.
    await expect(
      w.batch(w.helper.actor, w.list("Alpha"), { type: "ban", days: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(ban(w.helper.actor, 30)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ban(w.helper.actor, null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.stored(alpha!.id).banned_until).toBeNull();

    const banned = await ban(w.helper.actor, 3);
    expect(banned).toMatchObject({ done: 2 });
    const until = w.stored(alpha!.id).banned_until as number;
    expect(until).toBeGreaterThan(w.ctx.now() + 2 * 86_400_000);
    expect(until).toBeLessThanOrEqual(w.ctx.now() + 3 * 86_400_000);
    expect(w.entries(alpha!.id)).toEqual(["ban.add"]);
    expect(w.logOf(alpha!.id)[0]).toMatchObject({ reason: "Spam run" });

    // A permanent ban by an administrator is beyond a helper's reach to lift.
    await ban(w.founder.actor, null);
    expect(w.stored(bravo!.id).banned_permanently).toBe(1);
    const lifted = await w.batch(
      w.helper.actor,
      w.list("Bravo", "Charlie"),
      { type: "liftBans", notify: false },
      { reason: "Mistake" },
    );
    expect(lifted.items.map((item: { status: string }) => item.status)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(lifted.items[1].message).toBe("Has no ban in force.");
    expect(w.stored(bravo!.id).banned_permanently).toBe(1);
    const byAdmin = await w.batch(
      w.founder.actor,
      w.list("Alpha", "Bravo"),
      { type: "liftBans", notify: false },
      { reason: "Mistake" },
    );
    expect(byAdmin).toMatchObject({ done: 2 });
    expect(w.stored(bravo!.id).banned_permanently).toBe(0);
    expect(w.logOf(bravo!.id).filter((entry) => entry.action === "ban.lift")).toHaveLength(2);
  });

  test("erases accounts with the actor's password and a reason", async () => {
    const w = await world();
    const [alpha, bravo] = w.members;
    const erase = (extra: object) =>
      w.batch(w.founder.actor, w.list("Alpha", "Bravo"), { type: "delete" }, extra);
    await expect(erase({ actorPassword: PASSWORD })).rejects.toBeInstanceOf(ValidationError);
    await expect(erase({ reason: "Clean up" })).rejects.toBeInstanceOf(ValidationError);
    await expect(erase({ reason: "Clean up", actorPassword: "nope nope" })).rejects.toBeDefined();
    expect(w.stored(alpha!.id).erased_at).toBeNull();

    const result = await erase({ reason: "Clean up", actorPassword: PASSWORD });
    expect(result).toMatchObject({ done: 2, skipped: 0, failed: 0 });
    for (const m of [alpha!, bravo!]) {
      expect(w.stored(m.id).erased_at).not.toBeNull();
      expect(w.entries(m.id)).toEqual(["member.erase", "ban.add"]);
    }
    // An erased account is skipped by a second run (it answers to its number now).
    const again = await w.batch(
      w.founder.actor,
      w.list(alpha!.id, bravo!.id),
      { type: "delete" },
      { reason: "Clean up", actorPassword: PASSWORD },
    );
    expect(again).toMatchObject({ done: 0, skipped: 2 });
    expect(again.items[0].message).toBe("This member's account was erased.");
  });

  test("skips who the actor may not act on, super admins and the actor, and goes on with the rest", async () => {
    const w = await world();
    const result = await w.batch(
      w.helper.actor,
      w.list("Helper", "Boss", "Rival", "Alpha", "Moderator"),
      { type: "setTitle", title: "Checked" },
    );
    const byName = Object.fromEntries(
      result.items.map((item: { name: string }) => [item.name, item]),
    );
    expect(byName.Helper).toMatchObject({
      status: "skipped",
      message: "You cannot apply this to yourself.",
    });
    expect(byName.Boss).toMatchObject({
      status: "skipped",
      message: "A super admin is never changed in a batch.",
    });
    // Equal or higher rank: the single action's hierarchy refuses.
    expect(byName.Rival.status).toBe("skipped");
    expect(byName.Alpha.status).toBe("done");
    expect(byName.Moderator.status).toBe("done");
    expect(result).toMatchObject({ done: 2, skipped: 3, failed: 0 });
    expect(w.entries(w.rival.id)).toEqual([]);
    expect(w.entries(w.boss.id)).toEqual([]);
    expect(w.stored(w.boss.id).custom_title).toBeNull();

    // A super admin acting is still not allowed on themselves or on another super admin.
    w.ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(w.founder.id);
    const bySuper = await w.batch(w.founder.actor, w.list("Founder", "Boss", "Rival"), {
      type: "setTitle",
      title: "Owner's pick",
    });
    expect(bySuper.items.map((item: { status: string }) => item.status)).toEqual([
      "skipped",
      "skipped",
      "done",
    ]);
  });

  test("an id that is no member is a failure of that line only", async () => {
    const w = await world();
    const result = await w.apply(w.founder.actor, [w.members[0]!.id, 999_999], {
      type: "setTitle",
      title: "Hi",
    });
    expect(result).toMatchObject({ done: 1, failed: 1 });
    expect(result.items.at(-1)).toEqual({
      userId: null,
      name: "999999",
      status: "failed",
      message: "No member has this id.",
    });
  });

  test("acts on the ids that were previewed, not on a selection read again", async () => {
    const w = await world();
    const [alpha, bravo] = w.members;
    for (const member of [alpha!])
      await w.run("users.setGroups", w.founder.actor, {
        userId: member.id,
        secondaryGroupIds: [w.chosen.id],
        actorPassword: PASSWORD,
      });
    const previewed = await w.preview(inGroup(w.chosen.id));
    expect(previewed.items.map((item: { id: number }) => item.id)).toEqual([alpha!.id]);
    // The rule matches someone else by the time of the apply: only the previewed one is changed.
    await w.run("users.setGroups", w.founder.actor, {
      userId: bravo!.id,
      secondaryGroupIds: [w.chosen.id],
      actorPassword: PASSWORD,
    });
    const result = await w.apply(w.founder.actor, [alpha!.id], {
      type: "setTitle",
      title: "Previewed",
    });
    expect(result).toMatchObject({ done: 1 });
    expect(w.stored(alpha!.id).custom_title).toBe("Previewed");
    expect(w.stored(bravo!.id).custom_title).toBeNull();
  });

  test("refuses a rule that holds a criterion too heavy for a request, naming it", async () => {
    const w = await world();
    const heavy = {
      kind: "criteria",
      rule: { match: "all", conditions: [{ criterion: "warning_points_below", value: 5 }] },
    };
    await expect(w.preview(heavy)).rejects.toThrow(/warning_points_below.*too heavy/);
  });

  test("finishes an erasure that stopped part way, and skips one that is complete", async () => {
    const w = await world();
    const [alpha] = w.members;
    const authContext = await getAuth(w.ctx).$context;
    const original = authContext.internalAdapter.deleteAccounts;
    authContext.internalAdapter.deleteAccounts = async () => {
      throw new Error("injected");
    };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const run = () =>
      w.apply(
        w.founder.actor,
        [alpha!.id],
        { type: "delete" },
        { reason: "Clean up", actorPassword: PASSWORD },
      );
    try {
      expect(await run()).toMatchObject({ failed: 1 });
    } finally {
      authContext.internalAdapter.deleteAccounts = original;
      logged.mockRestore();
    }
    expect(w.stored(alpha!.id).erased_at).not.toBeNull();
    expect(w.stored(alpha!.id).username).toBe("Alpha");
    // Again: the half-done erasure is finished, not skipped as erased.
    expect(await run()).toMatchObject({ done: 1 });
    expect(w.stored(alpha!.id).username).toBe("Deleted member " + alpha!.id);
    const again = await run();
    expect(again).toMatchObject({ skipped: 1 });
    expect(w.entries(alpha!.id).filter((entry) => entry === "member.erase")).toHaveLength(1);
  });

  test("works through criteria in runs of a hundred, resuming where the preview stopped", async () => {
    const w = await world();
    const many = [];
    for (let i = 0; i < 130; i++) many.push(insertUser(w.ctx).id);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO user_groups (user_id, group_id, created_at) SELECT value, ?2, 1 FROM json_each(?1)",
      )
      .run(JSON.stringify(many), w.chosen.id);
    const action = { type: "setTitle", title: "Chosen one" };
    const first = await w.preview(inGroup(w.chosen.id));
    expect(first.items).toHaveLength(100);
    expect(
      await w.apply(
        w.founder.actor,
        first.items.map((i: { id: number }) => i.id),
        action,
      ),
    ).toMatchObject({ done: 100, skipped: 0, failed: 0 });
    const second = await w.preview({ ...inGroup(w.chosen.id), after: first.next });
    expect(second.items).toHaveLength(30);
    expect(second.next).toBeNull();
    expect(
      await w.apply(
        w.founder.actor,
        second.items.map((i: { id: number }) => i.id),
        action,
      ),
    ).toMatchObject({ done: 30 });
  });

  test("is for those who manage members, and bans need the ban permission as well", async () => {
    const w = await world();
    const action = { type: "setTitle", title: "Hi" };
    await expect(w.batch(GUEST, w.list("Alpha"), action)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [w.members[0]!.actor, w.moderator.actor])
      await expect(w.batch(actor, w.list("Bravo"), action)).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.stored(w.members[1]!.id).custom_title).toBeNull();
    await w.run("permissions.set", w.founder.actor, {
      groupId: w.helpers.id,
      entries: [{ permission: "member.ban", value: "unset" }],
    });
    await expect(
      w.batch(w.helper.actor, w.list("Alpha"), { type: "ban", days: 1 }, { reason: "No right" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a helper revoked meanwhile changes nobody", async () => {
    const w = await world();
    const database = sharedDatabase(w.ctx);
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, w.helper.id);
    // The process that took the request holds the permissions warm, as a running server does.
    expect(can(here, actor, "admin.members", { target: GUEST })).toBe(true);
    await execute(elsewhere, getOperation("permissions.set"), w.founder.actor, {
      groupId: w.helpers.id,
      entries: [
        { permission: "admin.members", value: "unset" },
        { permission: "member.ban", value: "unset" },
        { permission: "member.editProfile", value: "unset" },
      ],
    });
    const snapshot = () =>
      JSON.stringify([
        here.sqlite
          .prepare("SELECT id, group_id, custom_title, banned_until, erased_at FROM users")
          .all(),
        here.sqlite.prepare("SELECT target_id, action FROM moderator_log").all(),
        here.sqlite.prepare("SELECT user_id FROM user_groups").all(),
      ]);
    const before = snapshot();
    const actions = [
      { type: "setGroup", groupId: w.chosen.id },
      { type: "addGroup", groupId: w.chosen.id },
      { type: "setTitle", title: "Stale" },
      { type: "ban", days: 1, notify: false },
      { type: "delete" },
    ];
    for (const action of actions) {
      const result = await execute(here, getOperation("users.batchUpdate"), actor, {
        userIds: [w.members[0]!.id, w.members[1]!.id],
        action,
        reason: "Stale",
        actorPassword: PASSWORD,
      }).catch((error) => error);
      // Held when the request began: the transaction re-reads and every member is refused.
      if (result instanceof ForbiddenError) continue;
      expect(result).toMatchObject({ done: 0, skipped: 2 });
    }
    expect(snapshot()).toBe(before);
    database.close();
  });
});
