import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ConflictError } from "../../errors";
import { execute } from "../../operation";
import { can } from "../../permissions";
import { permissionsSetOp } from "../permissions";
import { updateSiteSettings } from "../settings";
import { addWarning, banUser, liftBan, resumeSpamCleanup } from ".";

/**
 * A founder who gave `admin.permissions` to a member directly and removed it from their own
 * group: the member is the only one left who administers permissions, and the founder still
 * outranks them and may ban.
 */
async function scenario() {
  const ctx = createTestContext();
  const founder = userActor(insertUser(ctx, { groupId: 4 }));
  const holder = insertUser(ctx);
  await execute(ctx, permissionsSetOp, founder, {
    userId: holder.id,
    entries: [{ permission: "admin.permissions", value: "allow" }],
  });
  await execute(ctx, permissionsSetOp, founder, {
    groupId: 4,
    entries: [{ permission: "admin.permissions", value: "unset" }],
  });
  expect(can(ctx, founder, "admin.permissions")).toBe(false);
  expect(can(ctx, founder, "member.ban", { target: userActor(holder) })).toBe(true);
  const banned = () =>
    ctx.sqlite
      .prepare<{ banned_until: number | null; banned_permanently: number }, [number]>(
        "SELECT banned_until, banned_permanently FROM users WHERE id = ?1",
      )
      .get(holder.id)!;
  const count = (table: "bans" | "warnings") =>
    ctx.sqlite.prepare<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;
  return { ctx, founder, holder, banned, count };
}

describe("the sole permission administrator", () => {
  test("cannot be banned, permanently or for a time", async () => {
    const { ctx, founder, holder, banned, count } = await scenario();
    expect(() => banUser(ctx, founder, holder.id, "Rule", null)).toThrow(ConflictError);
    expect(() => banUser(ctx, founder, holder.id, "Rule", ctx.now() + 60_000)).toThrow(
      ConflictError,
    );
    expect(() => resumeSpamCleanup(ctx, founder, holder.id, null)).toThrow(ConflictError);
    expect(banned()).toEqual({ banned_until: null, banned_permanently: 0 });
    expect(count("bans")).toBe(0);
    expect(can(ctx, userActor(holder), "admin.permissions")).toBe(true);
  });

  test("cannot be banned by the warning threshold", async () => {
    const { ctx, founder, holder, banned, count } = await scenario();
    updateSiteSettings(ctx, founder, { warningBanThreshold: 2, warningBanDays: 2 });
    expect(addWarning(ctx, founder, holder.id, 1, "First").activePoints).toBe(1);
    expect(() => addWarning(ctx, founder, holder.id, 1, "Second")).toThrow(ConflictError);
    expect(banned()).toEqual({ banned_until: null, banned_permanently: 0 });
    expect(count("bans")).toBe(0);
    expect(count("warnings")).toBe(1);
  });

  test("can be banned once someone else administers permissions, and the ban lifted", async () => {
    const { ctx, founder, holder, banned } = await scenario();
    const second = insertUser(ctx);
    await execute(ctx, permissionsSetOp, userActor(holder), {
      userId: second.id,
      entries: [{ permission: "admin.permissions", value: "allow" }],
    });
    const ban = banUser(ctx, founder, holder.id, "Rule", null);
    expect(banned().banned_permanently).toBe(1);
    // The other administrator is now the last one.
    expect(() => banUser(ctx, founder, second.id, "Rule", null)).toThrow(ConflictError);
    expect(liftBan(ctx, founder, ban.id, "Appeal")).toEqual({ ok: true });
    expect(banned().banned_permanently).toBe(0);
  });
});
