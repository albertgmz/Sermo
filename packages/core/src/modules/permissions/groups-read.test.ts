import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { GROUP_IDS } from "../../db/schema";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { traceStatements } from "../statement-trace";
import {
  groupsCreateOp,
  groupsGetOp,
  groupsListOp,
  groupsSql,
  groupsUpdateOp,
  permissionsSetOp,
  usersSetGroupsOp,
} from "./index";

function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  return { ctx, admin };
}

/** A member holding exactly one administration permission through a personal entry. */
async function holder(w: ReturnType<typeof world>, permission: string) {
  const user = insertUser(w.ctx, {});
  await execute(w.ctx, permissionsSetOp, w.admin, {
    userId: user.id,
    entries: [{ permission, value: "allow" }],
  });
  return userActor(user);
}

describe("reading groups", () => {
  test("any of the four administration permissions opens groups.list and groups.get", async () => {
    const w = world();
    for (const permission of [
      "admin.groups",
      "admin.permissions",
      "admin.promotions",
      "admin.members",
    ]) {
      const actor = await holder(w, permission);
      const list = await execute(w.ctx, groupsListOp, actor, {});
      expect(list.items.map((g) => g.id)).toContain(GROUP_IDS.member);
      const one = await execute(w.ctx, groupsGetOp, actor, { groupId: GROUP_IDS.member });
      expect(one.title).toBe(list.items.find((g) => g.id === GROUP_IDS.member)!.title);
    }
  });

  test("a member without any of them is forbidden, a guest is not signed in, a missing group is not found", async () => {
    const w = world();
    const plain = userActor(insertUser(w.ctx, {}));
    const other = await holder(w, "forum.viewLog");
    for (const actor of [plain, other]) {
      await expect(execute(w.ctx, groupsListOp, actor, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        execute(w.ctx, groupsGetOp, actor, { groupId: GROUP_IDS.member }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(execute(w.ctx, groupsListOp, GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(execute(w.ctx, groupsGetOp, w.admin, { groupId: 999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("the writes still need admin.groups", async () => {
    const w = world();
    for (const permission of ["admin.permissions", "admin.promotions", "admin.members"]) {
      const actor = await holder(w, permission);
      await expect(execute(w.ctx, groupsCreateOp, actor, { title: "Nope" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        execute(w.ctx, groupsUpdateOp, actor, { groupId: GROUP_IDS.member, title: "Nope" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  test("memberCount counts the primary group and the hand-assigned ones, each member once", async () => {
    const w = world();
    const helpers = await execute(w.ctx, groupsCreateOp, w.admin, { title: "Helpers", rank: 5 });
    expect(helpers.memberCount).toBe(0);
    const a = insertUser(w.ctx, {});
    const b = insertUser(w.ctx, {});
    const c = insertUser(w.ctx, {});
    await execute(w.ctx, usersSetGroupsOp, w.admin, { userId: a.id, primaryGroupId: helpers.id });
    await execute(w.ctx, usersSetGroupsOp, w.admin, {
      userId: b.id,
      secondaryGroupIds: [helpers.id],
    });
    // Both ways at once is still one member.
    await execute(w.ctx, usersSetGroupsOp, w.admin, {
      userId: c.id,
      primaryGroupId: helpers.id,
      secondaryGroupIds: [helpers.id],
    });
    // A promotion grant is not a hand assignment.
    const d = insertUser(w.ctx, {});
    const promotion = await execute(w.ctx, getOperation("promotions.create"), w.admin, {
      title: "Rule",
      criteria: [{ criterion: "post_count", value: 0 }],
      groupIds: [helpers.id],
    });
    await execute(w.ctx, getOperation("promotions.apply"), w.admin, {
      userId: d.id,
      promotionId: promotion.id,
      action: "promote",
    });
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM user_group_grants WHERE group_id = ?1",
        )
        .get(helpers.id)!.n,
    ).toBe(1);
    const get = await execute(w.ctx, groupsGetOp, w.admin, { groupId: helpers.id });
    expect(get.memberCount).toBe(3);
    const list = await execute(w.ctx, groupsListOp, w.admin, { counts: true });
    expect(list.items.find((g) => g.id === helpers.id)!.memberCount).toBe(3);
    const members = list.items.find((g) => g.id === GROUP_IDS.member)!.memberCount;
    expect(members).toBe(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM users WHERE group_id = ?1")
        .get(GROUP_IDS.member)!.n,
    );
    const renamed = await execute(w.ctx, groupsUpdateOp, w.admin, {
      groupId: helpers.id,
      title: "Aides",
    });
    expect(renamed.memberCount).toBe(3);
  });

  test("groups.list counts members only when asked, and groups.get always does", async () => {
    const w = world();
    const trace = traceStatements(w.ctx);
    const member = insertUser(w.ctx, {});
    await execute(w.ctx, usersSetGroupsOp, w.admin, { userId: member.id });
    trace.sql.length = 0;
    trace.inTransaction.length = 0;
    const plain = await execute(w.ctx, groupsListOp, w.admin, {});
    expect(plain.items.length).toBeGreaterThan(0);
    expect(plain.items.every((g) => g.memberCount === null)).toBe(true);
    expect(trace.count(/count[(]/i)).toBe(0);
    const counted = await execute(w.ctx, groupsListOp, w.admin, { counts: true });
    expect(counted.items.every((g) => typeof g.memberCount === "number")).toBe(true);
    expect(trace.count(/count[(]/i)).toBe(1);
    const get = await execute(w.ctx, groupsGetOp, w.admin, { groupId: GROUP_IDS.member });
    expect(typeof get.memberCount).toBe("number");
  });

  test("groups.update counts after its write transaction, not inside it", async () => {
    const w = world();
    const trace = traceStatements(w.ctx);
    const group = await execute(w.ctx, groupsCreateOp, w.admin, { title: "Helpers", rank: 5 });
    trace.sql.length = 0;
    trace.inTransaction.length = 0;
    const updated = await execute(w.ctx, groupsUpdateOp, w.admin, {
      groupId: group.id,
      title: "Aides",
    });
    expect(updated.memberCount).toBe(0);
    const counting = trace.sql.flatMap((text, i) => (/count[(]/i.test(text) ? [i] : []));
    expect(counting).toHaveLength(1);
    expect(trace.inTransaction[counting[0]!]).toBe(false);
    // The write itself ran inside one.
    const update = trace.sql.findIndex((text) => text.startsWith("UPDATE groups"));
    expect(trace.inTransaction[update]).toBe(true);
  });

  test("the counting reads use indexes only", () => {
    const w = world();
    // The list sorts the few groups; the counts behind each are index searches.
    expectNoTableScan(w.ctx, `${groupsSql.counted} ORDER BY rank DESC, id`, [], {
      allowTempBTree: true,
    });
    expectNoTableScan(w.ctx, `${groupsSql.counted} WHERE id = ?1`, [GROUP_IDS.member]);
    const plan = w.ctx.sqlite
      .prepare<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${groupsSql.counted}`)
      .all()
      .map((row) => row.detail);
    expect(plan.some((d) => /COVERING INDEX users_group \(group_id=\?\)/.test(d))).toBe(true);
    expect(plan.some((d) => /COVERING INDEX user_groups_group \(group_id=\?\)/.test(d))).toBe(true);
  });
});
