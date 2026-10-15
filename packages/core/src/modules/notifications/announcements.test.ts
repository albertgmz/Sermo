import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { writeTx } from "../../db/tx";
import { ForbiddenError, ValidationError } from "../../errors";
import { dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { runDueJobs } from "../jobs";
import { updateSiteSettings } from "../settings";
import { groupAudienceSql } from "./delivery";
import { announcementsCreateOp, notificationsListOp, registerNotificationJobs } from "./index";

function setup() {
  const ctx = createTestContext();
  registerNotificationJobs(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  const member = insertUser(ctx);
  const other = insertUser(ctx);
  const moderator = insertUser(ctx, { groupId: 3 });
  const secondary = insertUser(ctx);
  ctx.sqlite
    .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, ?2)")
    .run(secondary.id, ctx.now());
  const send = async (input: Record<string, unknown>, sender = admin) => {
    const result = await execute(ctx, announcementsCreateOp, userActor(sender), {
      title: "Maintenance",
      body: "Tonight at [B]ten[/B]",
      ...input,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    return result;
  };
  const got = async (user: { id: number; groupId: number }) =>
    (await execute(ctx, notificationsListOp, userActor(user), { limit: 20 })).items;
  return { ctx, admin, member, other, moderator, secondary, send, got };
}

describe("announcements", () => {
  test("the sender receives their own announcement to everyone", async () => {
    const f = setup();
    await f.send({});
    expect((await f.got(f.admin)).map((item) => item.type)).toEqual(["announcement"]);
    expect(await f.got(f.member)).toHaveLength(1);
  });

  test("a group reaches its primary and secondary members only", async () => {
    const f = setup();
    await f.send({ audience: { kind: "group", groupId: 3 } });
    expect(await f.got(f.moderator)).toHaveLength(1);
    expect(await f.got(f.secondary)).toHaveLength(1);
    expect(await f.got(f.member)).toHaveLength(0);
    expect(await f.got(f.admin)).toHaveLength(0);
  });

  test("named members, in any case; the sender gets it only when named", async () => {
    const f = setup();
    await f.send({
      audience: { kind: "users", usernames: [f.member.username.toUpperCase(), f.admin.username] },
    });
    expect(await f.got(f.member)).toHaveLength(1);
    expect(await f.got(f.admin)).toHaveLength(1);
    expect(await f.got(f.other)).toHaveLength(0);
    await f.send({ audience: { kind: "users", usernames: [f.other.username] } });
    expect(await f.got(f.other)).toHaveLength(1);
    expect(await f.got(f.admin)).toHaveLength(1);
  });

  test("an unknown or erased username refuses the whole announcement", async () => {
    const f = setup();
    await expect(
      f.send({ audience: { kind: "users", usernames: [f.member.username, "nobody-here"] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    f.ctx.sqlite
      .prepare("UPDATE users SET erased_at = ?1 WHERE id = ?2")
      .run(f.ctx.now(), f.other.id);
    await expect(
      f.send({ audience: { kind: "users", usernames: [f.other.username] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(f.ctx.sqlite.prepare("SELECT id FROM announcements").all()).toHaveLength(0);
  });

  test("a missing group is refused", async () => {
    const f = setup();
    await expect(f.send({ audience: { kind: "group", groupId: 9999 } })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("members cannot send", async () => {
    const f = setup();
    await expect(f.send({}, f.member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("the alert shows the text with spoilers masked and opens the link when there is one", async () => {
    const f = setup();
    await f.send({ body: "Visible [ISPOILER]hidden[/ISPOILER] text", url: "/pages/rules" });
    await f.send({ url: "https://example.org/news" });
    await f.send({});
    const [fallback, outside, inside] = await f.got(f.member);
    expect(fallback?.url).toStartWith("/announcements/");
    expect(fallback?.data.message).toBe("Tonight at ten");
    expect(outside?.url).toBe("https://example.org/news");
    expect(inside?.url).toBe("/pages/rules");
    expect(inside?.data.message).toBe("Visible [spoiler] text");
  });

  test("an admin default of in-app off still applies to the sender like to everyone", async () => {
    const f = setup();
    updateSiteSettings(f.ctx, userActor(f.admin), {
      notificationDefaults: { announcement: { inApp: false, email: false, push: false } },
    });
    await f.send({});
    expect(await f.got(f.admin)).toHaveLength(0);
  });

  test("a missing announcement row delivers to nobody", async () => {
    const f = setup();
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, {
        type: "announcement.published",
        targetType: "announcement",
        targetId: 999,
        payload: { userId: f.admin.id },
      }),
    );
    await dispatchEvents(f.ctx);
    await runDueJobs(f.ctx);
    expect(await f.got(f.member)).toHaveLength(0);
    expect(await f.got(f.admin)).toHaveLength(0);
  });

  test("audiences of different kinds in one process each reach their own recipients", async () => {
    const f = setup();
    const ids = async (user: { id: number; groupId: number }) => (await f.got(user)).length;
    await f.send({});
    expect([await ids(f.member), await ids(f.moderator)]).toEqual([1, 1]);
    await f.send({ audience: { kind: "group", groupId: 3 } });
    expect([await ids(f.member), await ids(f.moderator), await ids(f.secondary)]).toEqual([
      1, 2, 2,
    ]);
    await f.send({});
    expect([await ids(f.member), await ids(f.moderator)]).toEqual([2, 3]);
    await f.send({ audience: { kind: "users", usernames: [f.other.username] } });
    expect([await ids(f.other), await ids(f.member), await ids(f.moderator)]).toEqual([3, 2, 3]);
  });

  test("a member in the group as primary and secondary gets one alert", async () => {
    const f = setup();
    f.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, ?2)")
      .run(f.moderator.id, f.ctx.now());
    await f.send({ audience: { kind: "group", groupId: 3 } });
    expect(await f.got(f.moderator)).toHaveLength(1);
  });

  test("a group larger than one batch is delivered in full", async () => {
    const f = setup();
    const crowd = Array.from({ length: 95 }, (_, index) =>
      insertUser(f.ctx, { groupId: index % 2 === 0 ? 3 : 2 }),
    );
    for (const user of crowd.filter((_, index) => index % 2 === 1))
      f.ctx.sqlite
        .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, ?2)")
        .run(user.id, f.ctx.now());
    await f.send({ audience: { kind: "group", groupId: 3 } });
    const delivered = f.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM notifications WHERE type = 'announcement'",
      )
      .get()!.n;
    // The 95 added members, the moderator and the secondary member of the fixture.
    expect(delivered).toBe(97);
  });

  test("the group audience query uses indexes", () => {
    const f = setup();
    expectNoTableScan(f.ctx, groupAudienceSql, [3, 0, 40]);
  });

  test("a link that could leave the site as a path is refused", async () => {
    const f = setup();
    for (const url of ["/\\evil.com", "//evil.com", "/a\u0001b", "/a b", "javascript:alert(1)"])
      await expect(f.send({ url })).rejects.toBeInstanceOf(ValidationError);
    await f.send({ url: "/threads/1" });
    await f.send({ url: "https://example.org/x" });
  });
});
