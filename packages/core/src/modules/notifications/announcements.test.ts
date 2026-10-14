import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ForbiddenError, ValidationError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { runDueJobs } from "../jobs";
import { updateSiteSettings } from "../settings";
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
      body: "Tonight at **ten**",
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
    await f.send({ body: "Visible >!hidden!< text", url: "/pages/rules" });
    await f.send({ url: "https://example.org/news" });
    await f.send({});
    const [site, external, plain] = await f.got(f.member);
    expect(site?.url).toStartWith("/announcements/");
    expect(site?.data.message).toBe("Tonight at ten");
    expect(external?.url).toBe("https://example.org/news");
    expect(plain?.url).toBe("/pages/rules");
    expect(plain?.data.message).toBe("Visible [spoiler] text");
  });

  test("an admin default of in-app off still applies to the sender like to everyone", async () => {
    const f = setup();
    updateSiteSettings(f.ctx, userActor(f.admin), {
      notificationDefaults: { announcement: { inApp: false, email: false, push: false } },
    });
    await f.send({});
    expect(await f.got(f.admin)).toHaveLength(0);
  });
});
