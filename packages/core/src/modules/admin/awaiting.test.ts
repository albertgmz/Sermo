import { afterEach, describe, expect, test } from "bun:test";
import { expectNoTableScan, insertUser } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation, operations } from "../../operations";
import { can, resolvedPermissions } from "../../permissions";
import { getAuth } from "../auth";
import { signupQueueSql } from "../moderation";
import { closeAll } from "./fixtures.test";
import { PASSWORD, queueWorld } from "./signup-fixtures.test";

afterEach(closeAll);

const SPAM = { check: async () => ({ spam: true, source: "stopforumspam" as const }) };
const signUp = (w: Awaited<ReturnType<typeof queueWorld>>, name: string) =>
  getAuth(w.ctx).api.signUpEmail({
    body: {
      name,
      username: name,
      email: `${name.toLowerCase()}@example.test`,
      password: "Password123!",
    },
    headers: new Headers({ "x-sermo-client-ip": "198.51.100.9" }),
    asResponse: true,
  });
const events = (w: Awaited<ReturnType<typeof queueWorld>>, type: string) =>
  w.ctx.sqlite
    .prepare<{ target_id: number }, [string]>(
      "SELECT target_id FROM domain_events WHERE type = ?1 ORDER BY id",
    )
    .all(type)
    .map((row) => row.target_id);

describe("sign-up while the queue is on", () => {
  test("off by default: nobody is held", async () => {
    const w = await queueWorld();
    await w.run("settings.update", w.founder.actor, { approveSignups: false });
    const newcomer = await w.join("Newcomer");
    expect(w.review(newcomer.id)).toBeNull();
    expect((await w.run("auth.me", newcomer.actor, {})).user.awaitingApproval).toBe(false);
    expect((await w.run("settings.get", w.founder.actor, {})).approveSignups).toBe(false);
  });

  test("a new account waits, and staff hear of it at once when no email is asked for", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    expect(w.review(newcomer.id)).toBe("pending");
    expect(events(w, "member.awaiting_approval")).toEqual([newcomer.id]);
    expect((await w.run("auth.me", newcomer.actor, {})).user.awaitingApproval).toBe(true);
  });

  test("with email to confirm it starts waiting at the confirmation, not before", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    expect(events(w, "member.awaiting_approval")).toEqual([]);
    expect((await w.run("auth.me", newcomer.actor, {})).user.awaitingApproval).toBe(false);
    w.confirm(newcomer.id);
    expect(events(w, "member.awaiting_approval")).toEqual([newcomer.id]);
    expect(
      (await w.run("auth.me", { ...newcomer.actor, groupId: 2 }, {})).user.awaitingApproval,
    ).toBe(true);
    // The welcome mail waits for the approval, which has its own.
    await w.drain();
    expect(w.capture!.messages.filter((m) => /Welcome/.test(m.subject))).toEqual([]);
  });

  test("an account the spam check flags still lands in the queue, marked; with the queue off it is refused", async () => {
    const w = await queueWorld();
    Object.assign(w.ctx.config, { spamChecker: SPAM });
    const response = await signUp(w, "Spammer");
    expect(response.status).toBe(200);
    const id = Number(((await response.json()) as { user: { id: string } }).user.id);
    expect(w.review(id)).toBe("flagged");
    const listed = await w.run("signups.list", w.moderator.actor, {});
    expect(listed.items[0]).toMatchObject({ user: { id }, flagged: true });
    // Never approved by itself: it stays until staff decide.
    await w.drain();
    expect(w.review(id)).toBe("flagged");

    await w.run("settings.update", w.founder.actor, { approveSignups: false });
    expect((await signUp(w, "Spammer2")).status).toBe(400);
    expect(
      w.ctx.sqlite.prepare("SELECT id FROM users WHERE username_key = 'spammer2'").get(),
    ).toBeNull();
  });
});

describe("an account that waits", () => {
  test("reads what a guest reads: permissions are the guest's, whatever groups it holds", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(newcomer.id);
    const actor = w.as(newcomer);
    expect(can(w.ctx, actor, "forum.reply", { nodeId: 1, threadBanned: false })).toBe(false);
    expect(can(w.ctx, actor, "profile.view")).toBe(can(w.ctx, GUEST, "profile.view"));
    const held = resolvedPermissions(w.ctx, actor);
    const guest = resolvedPermissions(w.ctx, GUEST);
    // The one thing it keeps is leaving: deleting its own account.
    for (const [id, value] of Object.entries(guest))
      if (id !== "profile.deleteAccount") expect(held[id]).toBe(value);
    expect(held["profile.deleteAccount"]).toBe(true);
    expect(guest["profile.deleteAccount"]).toBe(false);
    const me = await w.run("auth.me", actor, {});
    expect(me.staff.panel).toBe(false);
    expect(me.permissions).toMatchObject({ isAdmin: false, isModerator: false });
    // Not even a moderator group opens the queue while the account itself waits.
    await expect(w.run("signups.list", actor, {})).rejects.toMatchObject({
      issues: [{ path: ["approval"] }],
    });
  });

  test("takes no write at all: every operation that is not open to anyone is refused", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const actors = [w.as(newcomer), { ...w.as(newcomer), kind: "token" as const, tokenId: 1 }];
    let refused = 0;
    for (const op of operations) {
      // Leaving the forum is the one write a waiting account keeps (tested apart).
      if (op.kind !== "write" || op.name === "users.deleteOwnAccount") continue;
      for (const actor of actors) {
        const outcome = await execute(w.ctx, op, actor as never, {}).catch((error) => error);
        const approval =
          outcome instanceof ForbiddenError &&
          (outcome.issues ?? []).some((issue) => issue.path[0] === "approval");
        if (op.public) expect(approval).toBe(false);
        else {
          expect(approval).toBe(true);
          refused++;
        }
      }
    }
    // The count of operations covered is the point: a new write operation is covered by default.
    expect(refused).toBeGreaterThan(150);
    // What stays open: reading, signing out (not an operation), accepting terms.
    expect((await w.run("auth.me", newcomer.actor, {})).user.id).toBe(newcomer.id);
    expect(
      await w
        .run("terms.accept", w.as(newcomer), { accept: [{ kind: "terms", version: 1 }] })
        .catch((error) => error),
    ).not.toBeInstanceOf(ForbiddenError);
  });

  test("a member refused for approval is told so with the issue path the web reads", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const error = await w
      .run("profiles.update", w.as(newcomer), { about: "Hello" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe("Your account is waiting for staff to approve it.");
    expect(error.issues).toEqual([{ path: ["approval"], message: "awaiting" }]);
  });

  test("is not in the member list, the search, or the profile pages of others", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Zelda");
    const regular = w.member;
    const listed = (actor: object) =>
      w
        .run("users.list", actor, { sort: "newest" })
        .then((page) => page.items.map((item: { card: { id: number } }) => item.card.id));
    const found = (actor: object) =>
      w
        .run("users.search", actor, { prefix: "zel" })
        .then((page) => page.items.map((item: { id: number }) => item.id));
    expect(await listed(regular.actor)).not.toContain(newcomer.id);
    expect(await listed(GUEST)).not.toContain(newcomer.id);
    expect(await found(regular.actor)).toEqual([]);
    expect(await found(GUEST)).toEqual([]);
    await expect(
      w.run("profiles.get", regular.actor, { userId: newcomer.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Themselves, and staff who bypass profile privacy, still see it.
    expect((await w.run("profiles.get", w.as(newcomer), { userId: newcomer.id })).username).toBe(
      "Zelda",
    );
    expect((await w.run("profiles.get", w.founder.actor, { userId: newcomer.id })).username).toBe(
      "Zelda",
    );

    await w.run("signups.decide", w.moderator.actor, {
      userIds: [newcomer.id],
      decision: "approve",
    });
    expect(await listed(regular.actor)).toContain(newcomer.id);
    expect(await found(regular.actor)).toEqual([newcomer.id]);
  });

  test("shows as awaiting in the member administration, and as unconfirmed before it confirms", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    const state = async () =>
      (await w.run("users.adminGet", w.founder.actor, { userId: newcomer.id })).state;
    expect(await state()).toBe("unconfirmed");
    w.confirm(newcomer.id);
    expect(await state()).toBe("awaiting");
    const awaiting = await w.run("users.adminList", w.founder.actor, { state: "awaiting" });
    expect(awaiting.items.map((item: { card: { id: number } }) => item.card.id)).toEqual([
      newcomer.id,
    ]);
    await w.run("signups.decide", w.founder.actor, { userIds: [newcomer.id], decision: "approve" });
    expect(await state()).toBe("valid");
  });
});

describe("the counter and the alert", () => {
  test("counts the confirmed newcomers for those who hold the queue, within the bound", async () => {
    const w = await queueWorld();
    await w.join("Newcomer");
    const counters = (actor: object) => w.run("auth.counters", actor, {});
    expect((await counters(w.moderator.actor)).pendingSignups).toEqual({
      count: 1,
      more: false,
      cap: 99,
    });
    expect((await counters(w.member.actor)).pendingSignups).toEqual({
      count: 0,
      more: false,
      cap: 99,
    });
    expect((await counters(GUEST)).pendingSignups.count).toBe(0);
    for (let i = 0; i < 100; i++) {
      const extra = insertUser(w.ctx);
      w.ctx.sqlite
        .prepare("UPDATE users SET signup_review = 'pending' WHERE id = ?1")
        .run(extra.id);
    }
    expect((await counters(w.moderator.actor)).pendingSignups).toEqual({
      count: 99,
      more: true,
      cap: 99,
    });
    expectNoTableScan(w.ctx, signupQueueSql, [Number.MAX_SAFE_INTEGER, 100, 0]);
  });

  test("staff who hold the permission get an alert, which clears once someone decides", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    await w.drain();
    const alerts = async (actor: object) =>
      (await w.run("notifications.list", actor, { limit: 20 })).items.filter(
        (item: { type: string }) => item.type === "moderator.signup",
      );
    const forModerator = await alerts(w.moderator.actor);
    expect(forModerator).toHaveLength(1);
    expect(forModerator[0]).toMatchObject({
      contentType: "user",
      contentId: newcomer.id,
      read: false,
    });
    expect(await alerts(w.founder.actor)).toHaveLength(1);
    expect(await alerts(w.member.actor)).toHaveLength(0);
    expect((await w.run("auth.counters", w.moderator.actor, {})).notifications).toBe(1);

    await w.run("signups.decide", w.moderator.actor, {
      userIds: [newcomer.id],
      decision: "approve",
    });
    await w.drain();
    expect((await alerts(w.moderator.actor))[0].read).toBe(true);
    expect((await w.run("auth.counters", w.moderator.actor, {})).notifications).toBe(0);
    expect((await alerts(w.founder.actor))[0].read).toBe(true);
  });

  test("the alert is a notification type with its own preference", async () => {
    const w = await queueWorld();
    const types = await w.run("notifications.types", w.moderator.actor, {});
    expect(types.items.some((item: { id: string }) => item.id === "moderator.signup")).toBe(true);
    expect(getOperation("signups.decide").kind).toBe("write");
  });
});

describe("fix round: the alert, leaving, the language", () => {
  test("one standing alert per staff member lists the newcomers, and clears when nobody waits", async () => {
    const w = await queueWorld();
    const people = [await w.join("Ann"), await w.join("Ben"), await w.join("Cat")];
    await w.drain();
    const alerts = async () =>
      (await w.run("notifications.list", w.moderator.actor, { limit: 20 })).items.filter(
        (item: { type: string }) => item.type === "moderator.signup",
      );
    const [alert, ...others] = await alerts();
    expect(others).toEqual([]);
    expect(alert).toMatchObject({ actorCount: 3, read: false });
    expect(alert.actors.map((actor: { username: string }) => actor.username).sort()).toEqual([
      "Ann",
      "Ben",
      "Cat",
    ]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).notifications).toBe(1);

    // One decision leaves it standing; the last one clears it.
    await w.run("signups.decide", w.moderator.actor, {
      userIds: [people[0]!.id],
      decision: "approve",
    });
    await w.drain();
    expect((await alerts())[0].read).toBe(false);
    await w.run("signups.decide", w.moderator.actor, {
      userIds: [people[1]!.id, people[2]!.id],
      decision: "approve",
    });
    await w.drain();
    expect((await alerts())[0].read).toBe(true);
    expect((await w.run("auth.counters", w.moderator.actor, {})).notifications).toBe(0);
    // A later newcomer starts a fresh unread alert.
    await w.join("Dan");
    await w.drain();
    expect((await alerts()).map((item: { read: boolean }) => item.read)).toEqual([false, true]);
  });

  test("a waiting member may delete their own account, and leaves the queue", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    await w.drain();
    await expect(
      w.run("users.deleteOwnAccount", w.as(newcomer), { password: "not the password" }),
    ).rejects.toBeDefined();
    expect(await w.run("users.deleteOwnAccount", w.as(newcomer), { password: PASSWORD })).toEqual({
      ok: true,
    });
    expect(w.review(newcomer.id)).toBeNull();
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toEqual([]);
    await w.drain();
    expect((await w.run("auth.counters", w.moderator.actor, {})).notifications).toBe(0);
  });

  test("the language of the sign-up request is kept: the cookie first, then Accept-Language", async () => {
    const w = await queueWorld();
    const language = async (name: string, headers: Record<string, string>) => {
      const response = await getAuth(w.ctx).api.signUpEmail({
        body: {
          name,
          username: name,
          email: `${name.toLowerCase()}@example.test`,
          password: "Password123!",
        },
        headers: new Headers({ "x-sermo-client-ip": "198.51.100.9", ...headers }),
        asResponse: true,
      });
      const id = Number(((await response.json()) as { user: { id: string } }).user.id);
      return w.ctx.sqlite
        .prepare<{ language: string | null }, [number]>("SELECT language FROM users WHERE id = ?1")
        .get(id)!.language;
    };
    expect(await language("Uno", { cookie: "a=b; forum_locale=es" })).toBe("es");
    expect(await language("Dos", { "accept-language": "fr-FR,es-ES;q=0.8,en;q=0.5" })).toBe("es");
    expect(await language("Tres", { cookie: "forum_locale=en", "accept-language": "es" })).toBe(
      "en",
    );
    expect(await language("Cuatro", { "accept-language": "de" })).toBeNull();
    expect(await language("Cinco", {})).toBeNull();
  });

  test("an administrator moving a held account out of Unconfirmed makes it wait, and staff hear of it", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    expect(events(w, "member.awaiting_approval")).toEqual([]);
    await w.run("users.setGroups", w.founder.actor, {
      userId: newcomer.id,
      primaryGroupId: 2,
      actorPassword: PASSWORD,
    });
    expect(events(w, "member.awaiting_approval")).toEqual([newcomer.id]);
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toHaveLength(1);
    // A change of another group of an account that already waits announces nothing again.
    await w.run("users.setGroups", w.founder.actor, {
      userId: newcomer.id,
      secondaryGroupIds: [3],
      actorPassword: PASSWORD,
    });
    expect(events(w, "member.awaiting_approval")).toEqual([newcomer.id]);
  });
});
