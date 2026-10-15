import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { RESTRICTION_PERMANENT } from "../../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { runDueJobs } from "../jobs";
import { runHourlyTasks } from "../jobs/scheduler";
import { addWarning, listWarnings, registerModerationJobs } from ".";
import { sweepWarningActions, warningSql } from "./warning-actions";

const DAY = 86_400_000;
const op = (name: string) => getOperation(name);

type Type = { id: number; name: string; nameEn: string; nameEs: string; points: number };
type Action = { id: number; threshold: number; groupTitle: string | null };

function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const createType = (input: Record<string, unknown> = {}) =>
    execute(ctx, op("warningTypes.create"), admin, {
      nameEn: "Spam",
      nameEs: "Correo basura",
      points: 2,
      expiryDays: 30,
      defaultReason: "Posting spam",
      ...input,
    }) as Promise<Type>;
  const createAction = (input: Record<string, unknown>) =>
    execute(ctx, op("warningActions.create"), admin, {
      threshold: 3,
      kind: "ban",
      days: 2,
      ...input,
    }) as Promise<Action>;
  const group = (title: string, rank = 10) =>
    ctx.sqlite
      .prepare<{ id: number }, [string, number]>(
        "INSERT INTO groups (title, rank) VALUES (?1, ?2) RETURNING id",
      )
      .get(title, rank)!.id;
  const groupsOf = (userId: number) =>
    ctx.sqlite
      .prepare<{ group_id: number }, [number]>(
        "SELECT group_id FROM user_groups WHERE user_id = ?1 ORDER BY group_id",
      )
      .all(userId)
      .map((row) => row.group_id);
  const fires = (userId: number) =>
    ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM warning_action_fires WHERE user_id = ?1",
      )
      .get(userId)!.n;
  const bans = (userId: number) =>
    ctx.sqlite
      .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM bans WHERE user_id = ?1")
      .get(userId)!.n;
  const warn = (userId: number, points: number, reason = "Rule", expiresAt?: number | null) =>
    addWarning(ctx, admin, userId, points, reason, expiresAt);
  return { ctx, admin, moderator, createType, createAction, group, groupsOf, fires, bans, warn };
}

describe("warning types", () => {
  test("administrators manage them, moderators read them, others are refused", async () => {
    const w = world();
    const member = userActor(insertUser(w.ctx));
    const type = await w.createType();
    expect(type).toMatchObject({ name: "Spam", nameEn: "Spam", nameEs: "Correo basura" });
    const list = (actor: Parameters<typeof execute>[2]) =>
      execute(w.ctx, op("warningTypes.list"), actor, {}) as Promise<{ items: Type[] }>;
    expect((await list(w.moderator)).items.map((item) => item.id)).toEqual([type.id]);
    expect((await list(w.admin)).items).toHaveLength(1);
    await expect(list(member)).rejects.toThrow(ForbiddenError);
    await expect(list(GUEST)).rejects.toThrow(UnauthenticatedError);
    for (const name of ["warningTypes.create", "warningTypes.update", "warningTypes.delete"])
      for (const actor of [w.moderator, member, GUEST])
        await expect(
          execute(w.ctx, op(name), actor, {
            typeId: type.id,
            nameEn: "X",
            nameEs: "X",
            points: 1,
          }),
        ).rejects.toThrow(actor === GUEST ? UnauthenticatedError : ForbiddenError);
    const updated = (await execute(w.ctx, op("warningTypes.update"), w.admin, {
      typeId: type.id,
      nameEn: "Spamming",
      nameEs: "Envío de spam",
      points: 4,
      expiryDays: null,
      defaultReason: "",
      locked: true,
    })) as Type & { expiryDays: number | null; locked: boolean };
    expect(updated).toMatchObject({
      nameEn: "Spamming",
      points: 4,
      expiryDays: null,
      locked: true,
    });
    await expect(
      execute(w.ctx, op("warningTypes.update"), w.admin, {
        typeId: 999,
        nameEn: "X",
        nameEs: "X",
        points: 1,
      }),
    ).rejects.toThrow(NotFoundError);
    await execute(w.ctx, op("warningTypes.delete"), w.admin, { typeId: type.id });
    expect((await list(w.admin)).items).toHaveLength(0);
    await expect(
      execute(w.ctx, op("warningTypes.delete"), w.admin, { typeId: type.id }),
    ).rejects.toThrow(NotFoundError);
  });

  test("the name follows the viewer's language", async () => {
    const w = world();
    await w.createType();
    const spanish = insertUser(w.ctx, { groupId: 3 });
    w.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(spanish.id);
    const list = (await execute(w.ctx, op("warningTypes.list"), userActor(spanish), {})) as {
      items: Type[];
    };
    expect(list.items[0]!.name).toBe("Correo basura");
    const member = insertUser(w.ctx);
    const types = (await execute(w.ctx, op("warningTypes.list"), w.admin, {})) as {
      items: Type[];
    };
    expect(types.items[0]!.name).toBe("Spam");
    await execute(w.ctx, op("warnings.create"), w.admin, {
      userId: member.id,
      typeId: types.items[0]!.id,
      notify: false,
    });
    w.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(member.id);
    const own = listWarnings(w.ctx, userActor(member), member.id);
    expect(own.items[0]).toMatchObject({ type_name: "Correo basura" });
    const english = listWarnings(w.ctx, w.admin, member.id);
    expect(english.items[0]).toMatchObject({ type_name: "Spam" });
    const viewerEs = listWarnings(w.ctx, userActor(spanish), member.id);
    expect(viewerEs.items[0]).toMatchObject({ type_name: "Correo basura" });
  });

  test("a warning takes the type's points, expiry and reason unless they are adjusted", async () => {
    const w = world();
    const member = insertUser(w.ctx);
    const type = await w.createType();
    const give = (input: Record<string, unknown>) =>
      execute(w.ctx, op("warnings.create"), w.moderator, {
        userId: member.id,
        notify: false,
        ...input,
      });
    await give({ typeId: type.id });
    await give({ typeId: type.id, points: 5, reason: "Worse", expiresAt: null });
    const rows = w.ctx.sqlite
      .prepare<
        {
          points: number;
          reason: string;
          created_at: number;
          expires_at: number | null;
          type_id: number;
        },
        [number]
      >("SELECT * FROM warnings WHERE user_id = ?1 ORDER BY id")
      .all(member.id);
    expect(rows[0]).toMatchObject({
      points: 2,
      reason: "Posting spam",
      type_id: type.id,
    });
    expect(rows[0]!.expires_at).toBe(rows[0]!.created_at + 30 * DAY);
    expect(rows[1]).toMatchObject({ points: 5, reason: "Worse", expires_at: null });
    const listed = listWarnings(w.ctx, w.admin, member.id).items;
    expect(listed[0]).toMatchObject({ type_id: type.id, type_name: "Spam" });
  });

  test("a locked type fixes points and expiry", async () => {
    const w = world();
    const member = insertUser(w.ctx);
    const type = await w.createType({ locked: true });
    const give = (input: Record<string, unknown>) =>
      execute(w.ctx, op("warnings.create"), w.moderator, {
        userId: member.id,
        typeId: type.id,
        notify: false,
        ...input,
      });
    await expect(give({ points: 3 })).rejects.toThrow("fixes its points");
    await expect(give({ expiresAt: null })).rejects.toThrow("fixes its points");
    await expect(give({ expiresAt: new Date(w.ctx.now() + DAY).toISOString() })).rejects.toThrow(
      "fixes its points",
    );
    expect(await give({ points: 2, reason: "Because" })).toMatchObject({ activePoints: 2 });
    // The reason stays free.
    expect(
      w.ctx.sqlite.prepare<{ reason: string }, []>("SELECT reason FROM warnings").get()!.reason,
    ).toBe("Because");
  });

  test("a custom warning needs points and a reason; an unknown type is refused", async () => {
    const w = world();
    const member = insertUser(w.ctx);
    const give = (input: Record<string, unknown>) =>
      execute(w.ctx, op("warnings.create"), w.moderator, {
        userId: member.id,
        notify: false,
        ...input,
      });
    await expect(give({ reason: "No points" })).rejects.toThrow("Positive points");
    await expect(give({ points: 1 })).rejects.toThrow("Positive points");
    await expect(give({ typeId: 77 })).rejects.toThrow(NotFoundError);
    const empty = await w.createType({ defaultReason: "" });
    await expect(give({ typeId: empty.id })).rejects.toThrow("Positive points");
    expect(await give({ typeId: empty.id, reason: "Typed" })).toMatchObject({ activePoints: 2 });
    expect(await give({ points: 1, reason: "Custom" })).toMatchObject({ activePoints: 3 });
    expect(
      w.ctx.sqlite
        .prepare<{ type_id: number | null; expires_at: number | null }, []>(
          "SELECT type_id, expires_at FROM warnings ORDER BY id DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ type_id: null, expires_at: null });
  });

  test("deleting a type in use keeps its warnings, as custom ones", async () => {
    const w = world();
    const member = insertUser(w.ctx);
    const type = await w.createType();
    await execute(w.ctx, op("warnings.create"), w.admin, {
      userId: member.id,
      typeId: type.id,
      notify: false,
    });
    await execute(w.ctx, op("warningTypes.delete"), w.admin, { typeId: type.id });
    expect(listWarnings(w.ctx, w.admin, member.id).items[0]).toMatchObject({
      points: 2,
      reason: "Posting spam",
      type_id: null,
      type_name: null,
    });
  });
});

describe("warning actions", () => {
  test("only administrators manage them", async () => {
    const w = world();
    const member = userActor(insertUser(w.ctx));
    const action = await w.createAction({});
    const input = { threshold: 5, kind: "ban", days: null };
    for (const actor of [w.moderator, member, GUEST]) {
      const refused = actor === GUEST ? UnauthenticatedError : ForbiddenError;
      await expect(execute(w.ctx, op("warningActions.list"), actor, {})).rejects.toThrow(refused);
      await expect(execute(w.ctx, op("warningActions.create"), actor, input)).rejects.toThrow(
        refused,
      );
      await expect(
        execute(w.ctx, op("warningActions.update"), actor, { actionId: action.id, ...input }),
      ).rejects.toThrow(refused);
      await expect(
        execute(w.ctx, op("warningActions.delete"), actor, { actionId: action.id }),
      ).rejects.toThrow(refused);
    }
    const updated = (await execute(w.ctx, op("warningActions.update"), w.admin, {
      actionId: action.id,
      ...input,
    })) as Action;
    expect(updated.threshold).toBe(5);
    const listed = (await execute(w.ctx, op("warningActions.list"), w.admin, {})) as {
      items: Action[];
    };
    expect(listed.items.map((item) => item.id)).toEqual([action.id]);
    await execute(w.ctx, op("warningActions.delete"), w.admin, { actionId: action.id });
    await expect(
      execute(w.ctx, op("warningActions.delete"), w.admin, { actionId: action.id }),
    ).rejects.toThrow(NotFoundError);
  });

  test("an action has exactly the fields its kind needs", async () => {
    const w = world();
    const bad: Record<string, unknown>[] = [
      { kind: "ban", restrictionKind: "posting" },
      { kind: "ban", groupId: 2 },
      { kind: "group" },
      { kind: "group", groupId: 2, restrictionKind: "posting" },
      { kind: "restriction" },
      { kind: "restriction", restrictionKind: "posting", groupId: 2 },
    ];
    for (const input of bad)
      await expect(w.createAction({ days: null, ...input })).rejects.toThrow(/needs|takes no/);
    await expect(w.createAction({ kind: "group", groupId: 9999 })).rejects.toThrow(NotFoundError);
    await expect(w.createAction({ kind: "group", groupId: 1 })).rejects.toThrow("guest group");
  });

  test("the group must rank below the administrator and not decide administration", async () => {
    const w = world();
    // The administrator group is the highest rank: nobody hands it out.
    await expect(w.createAction({ kind: "group", groupId: 4 })).rejects.toThrow(ForbiddenError);
    const above = w.group("Above", 100_000);
    await expect(w.createAction({ kind: "group", groupId: above })).rejects.toThrow(ForbiddenError);
    const admins = w.group("Administration", 20);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'admin.permissions'), 0, ?1, 0, 1)",
      )
      .run(admins);
    await expect(w.createAction({ kind: "group", groupId: admins })).rejects.toThrow(
      "administers permissions",
    );
    const fine = w.group("Probation");
    expect(await w.createAction({ kind: "group", groupId: fine })).toMatchObject({
      groupTitle: "Probation",
    });
  });

  test("a group used by an action cannot be deleted", async () => {
    const w = world();
    const group = w.group("Probation");
    const action = await w.createAction({ kind: "group", groupId: group });
    await expect(
      execute(w.ctx, op("groups.delete"), w.admin, { groupId: group, actorPassword: "x" }),
    ).rejects.toThrow();
    expect(w.ctx.sqlite.prepare("SELECT id FROM groups WHERE id = ?1").get(group)).not.toBeNull();
    await execute(w.ctx, op("warningActions.delete"), w.admin, { actionId: action.id });
  });

  test("a ban fires once at the crossing and not again above it", async () => {
    const w = world();
    await w.createAction({ threshold: 3, kind: "ban", days: 2 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 2);
    expect(w.bans(member.id)).toBe(0);
    w.warn(member.id, 1);
    expect(w.bans(member.id)).toBe(1);
    expect(
      w.ctx.sqlite
        .prepare<{ banned_until: number }, [number]>("SELECT banned_until FROM users WHERE id = ?1")
        .get(member.id)!.banned_until,
    ).toBe(w.ctx.now() + 2 * DAY);
    w.warn(member.id, 5);
    expect(w.bans(member.id)).toBe(1);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'ban.threshold'",
        )
        .get()!.n,
    ).toBe(1);
  });

  test("a permanent ban has no end", async () => {
    const w = world();
    await w.createAction({ threshold: 1, kind: "ban", days: null });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1);
    expect(
      w.ctx.sqlite
        .prepare<{ banned_permanently: number }, [number]>(
          "SELECT banned_permanently FROM users WHERE id = ?1",
        )
        .get(member.id)!.banned_permanently,
    ).toBe(1);
  });

  test("several actions fire together, each once, lowest threshold first", async () => {
    const w = world();
    const group = w.group("Probation");
    await w.createAction({ threshold: 2, kind: "group", groupId: group, days: null });
    await w.createAction({
      threshold: 4,
      kind: "restriction",
      restrictionKind: "posting",
      days: 3,
    });
    await w.createAction({ threshold: 4, kind: "ban", days: 1 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1);
    expect(w.fires(member.id)).toBe(0);
    w.warn(member.id, 1);
    expect(w.groupsOf(member.id)).toEqual([group]);
    w.warn(member.id, 5);
    expect(w.fires(member.id)).toBe(3);
    expect(w.bans(member.id)).toBe(1);
    expect(
      w.ctx.sqlite
        .prepare<{ restricted_posting_until: number }, [number]>(
          "SELECT restricted_posting_until FROM users WHERE id = ?1",
        )
        .get(member.id)!.restricted_posting_until,
    ).toBe(w.ctx.now() + 3 * DAY);
    w.warn(member.id, 1);
    expect(w.bans(member.id)).toBe(1);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM user_restrictions WHERE user_id = ?1",
        )
        .get(member.id)!.n,
    ).toBe(1);
  });

  test("a permanent restriction is stored without an end", async () => {
    const w = world();
    await w.createAction({
      threshold: 1,
      kind: "restriction",
      restrictionKind: "conversations",
      days: null,
    });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1);
    expect(
      w.ctx.sqlite
        .prepare<{ restricted_conversations_until: number }, [number]>(
          "SELECT restricted_conversations_until FROM users WHERE id = ?1",
        )
        .get(member.id)!.restricted_conversations_until,
    ).toBe(RESTRICTION_PERMANENT);
  });

  test("an action crossed by a warning with a type fires like any other", async () => {
    const w = world();
    await w.createAction({ threshold: 2, kind: "ban", days: 1 });
    const type = await w.createType({ points: 2 });
    const member = insertUser(w.ctx);
    await execute(w.ctx, op("warnings.create"), w.moderator, {
      userId: member.id,
      typeId: type.id,
      notify: false,
    });
    expect(w.bans(member.id)).toBe(1);
  });

  test("a timed group goes when the points fall below the threshold, and fires again on a new crossing", async () => {
    const w = world();
    const group = w.group("Probation");
    await w.createAction({ threshold: 3, kind: "group", groupId: group, days: 30 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 3, "First", w.ctx.now() + 5 * DAY);
    expect(w.groupsOf(member.id)).toEqual([group]);
    // Still inside the warning's life: nothing to lift.
    w.ctx.clock.advance(4 * DAY);
    expect(sweepWarningActions(w.ctx)).toBe(0);
    expect(w.groupsOf(member.id)).toEqual([group]);
    w.ctx.clock.advance(2 * DAY);
    expect(sweepWarningActions(w.ctx)).toBe(1);
    expect(w.groupsOf(member.id)).toEqual([]);
    expect(w.fires(member.id)).toBe(0);
    expect(sweepWarningActions(w.ctx)).toBe(0);
    w.warn(member.id, 3);
    expect(w.groupsOf(member.id)).toEqual([group]);
  });

  test("the next warning notices points that expired before the sweep ran", async () => {
    const w = world();
    await w.createAction({ threshold: 3, kind: "ban", days: 1 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 3, "First", w.ctx.now() + DAY);
    expect(w.bans(member.id)).toBe(1);
    w.ctx.clock.advance(2 * DAY);
    // The ban ran out, the warning expired; no job ran. Two points do not reach the threshold.
    w.warn(member.id, 2);
    expect(w.bans(member.id)).toBe(1);
    expect(w.fires(member.id)).toBe(0);
    w.warn(member.id, 1);
    expect(w.bans(member.id)).toBe(2);
  });

  test("a bans is not lifted when the points fall", async () => {
    const w = world();
    await w.createAction({ threshold: 1, kind: "ban", days: 10 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1, "Rule", w.ctx.now() + DAY);
    w.ctx.clock.advance(2 * DAY);
    expect(sweepWarningActions(w.ctx)).toBe(1);
    expect(
      w.ctx.sqlite
        .prepare<{ lifted_at: number | null }, [number]>(
          "SELECT lifted_at FROM bans WHERE user_id = ?1",
        )
        .get(member.id)!.lifted_at,
    ).toBeNull();
    expect(
      w.ctx.sqlite
        .prepare<{ banned_until: number }, [number]>("SELECT banned_until FROM users WHERE id = ?1")
        .get(member.id)!.banned_until,
    ).toBeGreaterThan(w.ctx.now());
  });

  test("a permanent group stays, and so does one the member already held", async () => {
    const w = world();
    const permanent = w.group("Watched");
    const held = w.group("Probation");
    await w.createAction({ threshold: 1, kind: "group", groupId: permanent, days: null });
    await w.createAction({ threshold: 1, kind: "group", groupId: held, days: 30 });
    const member = insertUser(w.ctx);
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, ?3)")
      .run(member.id, held, 1);
    w.warn(member.id, 1, "Rule", w.ctx.now() + DAY);
    expect(w.groupsOf(member.id).sort()).toEqual([permanent, held].sort());
    w.ctx.clock.advance(2 * DAY);
    expect(sweepWarningActions(w.ctx)).toBe(2);
    expect(w.groupsOf(member.id).sort()).toEqual([permanent, held].sort());
  });

  test("a timed group ends on its date while the action stays in effect", async () => {
    const w = world();
    const group = w.group("Probation");
    await w.createAction({ threshold: 2, kind: "group", groupId: group, days: 3 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 2);
    expect(w.groupsOf(member.id)).toEqual([group]);
    w.ctx.clock.advance(2 * DAY);
    expect(sweepWarningActions(w.ctx)).toBe(0);
    w.ctx.clock.advance(2 * DAY);
    expect(sweepWarningActions(w.ctx)).toBe(1);
    expect(w.groupsOf(member.id)).toEqual([]);
    // Still above the threshold, so it does not fire again.
    expect(w.fires(member.id)).toBe(1);
    w.warn(member.id, 1);
    expect(w.groupsOf(member.id)).toEqual([]);
  });

  test("two actions that add the same group lift it together, and a permanent one keeps it", async () => {
    const w = world();
    const group = w.group("Probation");
    await w.createAction({ threshold: 1, kind: "group", groupId: group, days: 30 });
    await w.createAction({ threshold: 2, kind: "group", groupId: group, days: 30 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1, "Short", w.ctx.now() + DAY);
    w.warn(member.id, 1, "Long", w.ctx.now() + 3 * DAY);
    expect(w.groupsOf(member.id)).toEqual([group]);
    w.ctx.clock.advance(2 * DAY);
    sweepWarningActions(w.ctx);
    // One point left: the second action is lifted, the first still holds the group.
    expect(w.groupsOf(member.id)).toEqual([group]);
    w.ctx.clock.advance(2 * DAY);
    sweepWarningActions(w.ctx);
    expect(w.groupsOf(member.id)).toEqual([]);

    const other = insertUser(w.ctx);
    await w.createAction({ threshold: 3, kind: "group", groupId: group, days: null });
    w.warn(other.id, 1, "Short", w.ctx.now() + DAY);
    w.warn(other.id, 2, "Long", w.ctx.now() + 30 * DAY);
    expect(w.groupsOf(other.id)).toEqual([group]);
    w.ctx.clock.advance(2 * DAY);
    sweepWarningActions(w.ctx);
    w.ctx.clock.advance(40 * DAY);
    sweepWarningActions(w.ctx);
    expect(w.groupsOf(other.id)).toEqual([group]);
  });

  test("a hand edit of the member's groups makes the membership theirs", async () => {
    const w = world();
    const group = w.group("Probation");
    await w.createAction({ threshold: 1, kind: "group", groupId: group, days: 30 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1, "Rule", w.ctx.now() + DAY);
    w.ctx.clock.advance(1000);
    // What users.setGroups does: the member's secondary groups are written again.
    w.ctx.sqlite.prepare("DELETE FROM user_groups WHERE user_id = ?1").run(member.id);
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, ?3)")
      .run(member.id, group, w.ctx.now());
    w.ctx.clock.advance(2 * DAY);
    sweepWarningActions(w.ctx);
    expect(w.groupsOf(member.id)).toEqual([group]);
  });

  test("deleting an action ends the timed groups it added and keeps the permanent ones", async () => {
    const w = world();
    const timedGroup = w.group("Probation");
    const permanentGroup = w.group("Watched");
    const timed = await w.createAction({
      threshold: 1,
      kind: "group",
      groupId: timedGroup,
      days: 30,
    });
    const permanent = await w.createAction({
      threshold: 1,
      kind: "group",
      groupId: permanentGroup,
      days: null,
    });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1);
    expect(w.groupsOf(member.id).sort()).toEqual([timedGroup, permanentGroup].sort());
    await execute(w.ctx, op("warningActions.delete"), w.admin, { actionId: timed.id });
    expect(w.groupsOf(member.id)).toEqual([permanentGroup]);
    await execute(w.ctx, op("warningActions.delete"), w.admin, { actionId: permanent.id });
    expect(w.groupsOf(member.id)).toEqual([permanentGroup]);
    expect(w.fires(member.id)).toBe(0);
  });

  test("a member who holds the immunity permission is skipped", async () => {
    const w = world();
    await w.createAction({ threshold: 1, kind: "ban", days: 1 });
    const group = w.group("Immune", 15);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'member.immuneToAutoBan'), 0, ?1, 0, 1)",
      )
      .run(group);
    const immune = insertUser(w.ctx, { groupId: group });
    w.warn(immune.id, 1);
    expect(w.bans(immune.id)).toBe(0);
    const ordinary = insertUser(w.ctx);
    w.warn(ordinary.id, 1);
    expect(w.bans(ordinary.id)).toBe(1);
  });

  test("the warning is refused with its action: hierarchy and a group that came to administer", async () => {
    const w = world();
    // Hierarchy comes from the warning itself: nobody warns a member ranked at or above them.
    const peer = insertUser(w.ctx, { groupId: 4 });
    await w.createAction({ threshold: 1, kind: "ban", days: 1 });
    expect(() => addWarning(w.ctx, w.moderator, peer.id, 1, "No")).toThrow(ForbiddenError);
    // A group that came to decide administration after the action was made is refused when fired.
    const group = w.group("Later");
    await w.createAction({ threshold: 2, kind: "group", groupId: group });
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'admin.permissions'), 0, ?1, 0, 1)",
      )
      .run(group);
    const member = insertUser(w.ctx);
    w.warn(member.id, 1);
    expect(() => w.warn(member.id, 1)).toThrow(ConflictError);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM warnings WHERE user_id = ?1")
        .get(member.id)!.n,
    ).toBe(1);
    expect(w.groupsOf(member.id)).toEqual([]);
  });
});

test("a warning's lookups use an index", () => {
  const { ctx } = world();
  expectNoTableScan(ctx, warningSql.activePoints, [1, 0]);
  expectNoTableScan(ctx, warningSql.due, [5, 1]);
  expectNoTableScan(ctx, warningSql.below, [1, 0]);
});

describe("the sweep job", () => {
  async function lifted(ctx: Ctx) {
    registerModerationJobs(ctx);
    await runHourlyTasks(ctx);
    return runDueJobs(ctx);
  }

  test("the hourly tasks queue it and it settles actions whose points expired", async () => {
    const w = world();
    const group = w.group("Probation");
    await w.createAction({ threshold: 1, kind: "group", groupId: group, days: 30 });
    const member = insertUser(w.ctx);
    w.warn(member.id, 1, "Rule", w.ctx.now() + DAY);
    w.ctx.clock.advance(2 * DAY);
    expect(await lifted(w.ctx)).toBeGreaterThan(0);
    expect(w.groupsOf(member.id)).toEqual([]);
    expect(w.fires(member.id)).toBe(0);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'moderation.warningSweep' AND status = 'done'",
        )
        .get()!.n,
    ).toBe(1);
  });
});

describe("stale administrators", () => {
  test("the writes re-check admin.settings inside the transaction", async () => {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const staffGroup = (await execute(fixture, op("groups.create"), founder, {
      title: "Settings",
      rank: 40,
    })) as { id: number };
    await execute(fixture, op("permissions.set"), founder, {
      groupId: staffGroup.id,
      entries: [{ permission: "admin.settings", value: "allow" }],
    });
    const staff = insertUser(fixture, { groupId: staffGroup.id });
    const type = (await execute(fixture, op("warningTypes.create"), founder, {
      nameEn: "A",
      nameEs: "A",
      points: 1,
    })) as Type;
    const action = (await execute(fixture, op("warningActions.create"), founder, {
      threshold: 1,
      kind: "ban",
    })) as Action;
    const database = sharedDatabase(fixture);
    const here = database.open();
    const elsewhere = database.open();
    try {
      const actor = resolvedActor(here, staff.id);
      await execute(elsewhere, op("permissions.set"), founder, {
        groupId: staffGroup.id,
        entries: [{ permission: "admin.settings", value: "unset" }],
      });
      const attempts: [string, Record<string, unknown>][] = [
        ["warningTypes.create", { nameEn: "B", nameEs: "B", points: 1 }],
        ["warningTypes.update", { typeId: type.id, nameEn: "B", nameEs: "B", points: 1 }],
        ["warningTypes.delete", { typeId: type.id }],
        ["warningActions.create", { threshold: 2, kind: "ban" }],
        ["warningActions.update", { actionId: action.id, threshold: 2, kind: "ban" }],
        ["warningActions.delete", { actionId: action.id }],
      ];
      for (const [name, input] of attempts)
        await expect(execute(here, op(name), actor, input)).rejects.toThrow(ForbiddenError);
      expect(
        elsewhere.sqlite
          .prepare<{ n: number }, []>("SELECT count(*) AS n FROM warning_types")
          .get()!.n,
      ).toBe(1);
      expect(
        elsewhere.sqlite
          .prepare<{ n: number }, []>("SELECT count(*) AS n FROM warning_actions")
          .get()!.n,
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
