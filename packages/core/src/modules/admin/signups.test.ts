import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, expectNoTableScan, insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { getAuth } from "../auth";
import { insertAcceptances } from "../pages/acceptance";
import { logMemberIp } from "../security/log";
import { createStorage, localDriver } from "../storage";
import { closeAll } from "./fixtures.test";
import { adminSql } from "./members";
import { PASSWORD, queueWorld } from "./signup-fixtures.test";
import { maskEmail, signupSql } from "./signups";

afterEach(closeAll);

describe("signups.list", () => {
  test("lists the confirmed newcomers, newest first, in pages", async () => {
    const w = await queueWorld();
    const first = await w.join("First");
    const second = await w.join("Second");
    const third = await w.join("Third");
    const page = await w.run("signups.list", w.moderator.actor, { limit: 2 });
    expect(page.items.map((item: { user: { id: number } }) => item.user.id)).toEqual([
      third.id,
      second.id,
    ]);
    expect(page.nextCursor).not.toBeNull();
    const rest = await w.run("signups.list", w.moderator.actor, {
      limit: 2,
      cursor: page.nextCursor,
    });
    expect(rest.items.map((item: { user: { id: number } }) => item.user.id)).toEqual([first.id]);
    expect(rest.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      user: { id: third.id, username: "Third" },
      // A moderator does not manage members: the address is masked.
      email: "t***@example.test",
      emailHidden: true,
      flagged: false,
      country: null,
      ip: null,
      sharedAddress: null,
      acceptances: [],
    });
  });

  test("an account that has not confirmed its email is not listed, and is once it has", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    expect(w.review(newcomer.id)).toBe("pending");
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toEqual([]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(0);
    expect(w.confirm(newcomer.id)).toBe(true);
    const listed = await w.run("signups.list", w.moderator.actor, {});
    expect(listed.items.map((item: { user: { id: number } }) => item.user.id)).toEqual([
      newcomer.id,
    ]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(1);
  });

  test("shows the terms accepted, the country, and with member.viewIps the address and the others on it", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const sibling = await w.join("Sibling");
    const banned = await w.join("Banned");
    const regular = w.member;
    for (const id of [newcomer.id, sibling.id, banned.id, regular.id])
      logMemberIp(w.ctx, id, "203.0.113.7", "Mozilla/5.0", "register", undefined, {
        country: "ES",
        region: null,
        city: null,
      });
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned.id);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO static_pages (slug, title, body_source, body_html, version, is_published, created_at, updated_at) VALUES ('terms', 'Terms', 'x', 'x', 3, 1, 1, 1)",
      )
      .run();
    insertAcceptances(w.ctx, newcomer.id, [{ kind: "terms", version: 3 }], "203.0.113.7");

    const asAdmin = (await w.run("signups.list", w.founder.actor, {})).items.find(
      (item: { user: { id: number } }) => item.user.id === newcomer.id,
    );
    expect(asAdmin).toMatchObject({
      email: "newcomer@example.test",
      emailHidden: false,
      country: "ES",
      ip: "203.0.113.7",
      acceptances: [{ kind: "terms", version: 3 }],
    });
    expect(asAdmin.sharedAddress.accounts).toBe(3);
    expect(asAdmin.sharedAddress.banned).toBe(1);
    expect(asAdmin.sharedAddress.members.map((m: { id: number }) => m.id).sort()).toEqual(
      [banned.id, regular.id, sibling.id].sort(),
    );
    // A moderator holds the queue but not member.viewIps: the country, never the address.
    const asModerator = (await w.run("signups.list", w.moderator.actor, {})).items.find(
      (item: { user: { id: number } }) => item.user.id === newcomer.id,
    );
    expect(asModerator).toMatchObject({ country: "ES", ip: null, sharedAddress: null });
  });

  test("is for those who hold member.approveRegistrations, by default staff", async () => {
    const w = await queueWorld();
    await w.join("Newcomer");
    await expect(w.run("signups.list", GUEST, {})).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(w.run("signups.list", w.member.actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toHaveLength(1);
    expect((await w.run("signups.list", w.founder.actor, {})).items).toHaveLength(1);

    // A group made by hand holds nothing until it is given the permission.
    const group = await w.run("groups.create", w.founder.actor, { title: "Greeters", rank: 5 });
    const greeter = await w.staff("Greeter", group.id);
    await expect(w.run("signups.list", greeter.actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await w.run("permissions.set", w.founder.actor, {
      groupId: group.id,
      entries: [{ permission: "member.approveRegistrations", value: "allow" }],
    });
    expect((await w.run("signups.list", greeter.actor, {})).items).toHaveLength(1);
  });
});

describe("signups.decide", () => {
  test("approving lets the account act, logs it once, clears the alert and writes to the member", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    await expect(
      w.run("profiles.update", newcomer.actor, { about: "Hello" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const result = await w.run("signups.decide", w.moderator.actor, {
      userIds: [newcomer.id],
      decision: "approve",
      reason: "Looks fine",
    });
    expect(result).toEqual({
      items: [{ userId: newcomer.id, name: "Newcomer", status: "done", message: null }],
      done: 1,
      skipped: 0,
      failed: 0,
    });
    expect(w.review(newcomer.id)).toBeNull();
    expect(w.logOf(newcomer.id).filter((entry) => entry.action.startsWith("signup."))).toEqual([
      { action: "signup.approve", reason: "Looks fine", details: {} },
    ]);
    await w.run("profiles.update", newcomer.actor, { about: "Hello" });
    expect((await w.run("auth.me", newcomer.actor, {})).user.awaitingApproval).toBe(false);
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toEqual([]);

    await w.drain();
    const mail = w.capture!.messages.findLast((m) => m.to === "newcomer@example.test")!;
    expect(mail.subject).toBe("Your Sermo account was approved");
  });

  test("the mail goes in the member's language", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(newcomer.id);
    w.confirm(newcomer.id);
    await w.run("signups.decide", w.moderator.actor, {
      userIds: [newcomer.id],
      decision: "approve",
    });
    await w.drain();
    expect(w.capture!.messages.findLast((m) => m.to === "newcomer@example.test")!.subject).toBe(
      "Tu cuenta de Sermo fue aprobada",
    );
  });

  test("rejecting by erasing runs the erasure, then tells the member why", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    const attempt = (input: object) =>
      w.run("signups.decide", w.founder.actor, {
        userIds: [newcomer.id],
        decision: "reject",
        mode: "delete",
        reason: "Looks like spam",
        ...input,
      });
    // Erasing is irreversible: the actor's own password, as `users.adminErase` asks.
    await expect(attempt({})).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt({ actorPassword: "wrong password" })).rejects.toBeDefined();
    expect(w.review(newcomer.id)).toBe("pending");

    expect(await attempt({ actorPassword: PASSWORD })).toMatchObject({ done: 1 });
    const row = w.ctx.sqlite
      .prepare<
        { erased_at: number | null; banned_permanently: number; signup_review: string | null },
        [number]
      >("SELECT erased_at, banned_permanently, signup_review FROM users WHERE id = ?1")
      .get(newcomer.id)!;
    expect(row.erased_at).not.toBeNull();
    expect(row.banned_permanently).toBe(1);
    expect(row.signup_review).toBeNull();
    expect(w.logOf(newcomer.id).map((entry) => entry.action)).toEqual(["signup.reject", "ban.add"]);
    expect(w.logOf(newcomer.id)[0]).toMatchObject({
      reason: "Looks like spam",
      details: { mode: "delete" },
    });
    expect((await w.run("signups.list", w.founder.actor, {})).items).toEqual([]);

    await w.drain();
    const mail = w.capture!.messages.findLast((m) => m.to === "newcomer@example.test")!;
    expect(mail.subject).toBe("Your Sermo registration was not approved");
    expect(mail.text).toContain("Reason: Looks like spam");
  });

  test("rejecting by ban is the actor's own ban: bounded by banMaxDays, held while it runs, closed when for good", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    const reject = (actor: object, extra: object = {}) =>
      w.run("signups.decide", actor, { userIds: [newcomer.id], decision: "reject", ...extra });
    // A moderator's bans are bounded to 30 days: not for good, not longer than that.
    await expect(reject(w.moderator.actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reject(w.moderator.actor, { banDays: 90 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.review(newcomer.id)).toBe("pending");

    // For a time: the account is banned and held out of the queue until the ban ends.
    expect(await reject(w.moderator.actor, { banDays: 7, reason: "Suspicious" })).toMatchObject({
      done: 1,
    });
    expect(w.review(newcomer.id)).toBe("pending");
    expect(w.logOf(newcomer.id)).toMatchObject([
      { action: "signup.reject", reason: "Suspicious", details: { mode: "ban", days: 7 } },
    ]);
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toEqual([]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(0);
    w.ctx.clock.advance(8 * 86_400_000);
    // The ban ended: it is a waiting account again, not a member.
    expect((await w.run("signups.list", w.moderator.actor, {})).items).toHaveLength(1);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(1);

    // For good, by an administrator (member.banMaxDays -1): the account is closed.
    expect(await reject(w.founder.actor)).toMatchObject({ done: 1 });
    const row = w.ctx.sqlite
      .prepare<{ erased_at: number | null; banned_permanently: number }, [number]>(
        "SELECT erased_at, banned_permanently FROM users WHERE id = ?1",
      )
      .get(newcomer.id)!;
    expect(row).toEqual({ erased_at: null, banned_permanently: 1 });
    expect(w.review(newcomer.id)).toBeNull();
    await w.drain();
    const mails = w.capture!.messages.filter((m) => m.to === "newcomer@example.test");
    // The rejection mail, not a ban mail as well.
    expect(mails.map((m) => m.subject)).not.toContain("Your Sermo account was banned");
    expect(mails.at(-1)!.subject).toBe("Your Sermo registration was not approved");
  });

  test("ban is the default of a rejection, and the sign-up address stays for the next account", async () => {
    const w = await queueWorld();
    const spam = await w.join("Spammer");
    const next = await w.join("Another");
    for (const id of [spam.id, next.id])
      logMemberIp(w.ctx, id, "203.0.113.9", "Mozilla/5.0", "register");
    await w.run("signups.decide", w.founder.actor, { userIds: [spam.id], decision: "reject" });
    expect(
      w.ctx.sqlite.prepare("SELECT banned_permanently FROM users WHERE id = ?1").get(spam.id),
    ).toEqual({ banned_permanently: 1 });
    const entry = (await w.run("signups.list", w.founder.actor, {})).items[0];
    expect(entry.user.id).toBe(next.id);
    expect(entry.sharedAddress).toMatchObject({ accounts: 1, banned: 1 });
  });

  test("decides on many at once, reporting each: gone, not waiting and fine ones", async () => {
    const w = await queueWorld();
    const one = await w.join("One");
    const two = await w.join("Two");
    await w.run("signups.decide", w.moderator.actor, { userIds: [two.id], decision: "approve" });
    const result = await w.run("signups.decide", w.moderator.actor, {
      userIds: [one.id, two.id, w.member.id, 999_999],
      decision: "approve",
    });
    expect(result.done).toBe(1);
    expect(result.skipped).toBe(3);
    expect(result.items.map((item: { status: string }) => item.status)).toEqual([
      "done",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.items[1].message).toBe("This account is not waiting for approval.");
    // The one who was not waiting got no second log entry.
    expect(w.logOf(two.id)).toHaveLength(1);
  });

  test("is for those who hold the permission over the account", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const input = { userIds: [newcomer.id], decision: "approve" };
    await expect(w.run("signups.decide", GUEST, input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(w.run("signups.decide", w.member.actor, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(w.review(newcomer.id)).toBe("pending");
    expect(await w.run("signups.decide", w.moderator.actor, input)).toMatchObject({ done: 1 });
  });

  test("is refused to a moderator revoked meanwhile, whatever the decision", async () => {
    const w = await queueWorld();
    const newcomers = [await w.join("Anna"), await w.join("Bert"), await w.join("Cleo")];
    const database = sharedDatabase(w.ctx);
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, w.moderator.id);
    await execute(elsewhere, getOperation("users.setGroups"), w.founder.actor, {
      userId: w.moderator.id,
      primaryGroupId: 2,
    });
    const before = JSON.stringify([
      here.sqlite.prepare("SELECT id, signup_review, banned_permanently FROM users").all(),
      here.sqlite.prepare("SELECT id, action FROM moderator_log").all(),
    ]);
    for (const input of [
      { decision: "approve" },
      { decision: "reject", mode: "ban" },
      { decision: "reject", mode: "delete", actorPassword: PASSWORD },
    ] as const) {
      const result = await execute(here, getOperation("signups.decide"), actor, {
        userIds: [newcomers[0]!.id],
        ...input,
      }).catch((error) => error);
      // The actor was resolved as a moderator; the transaction re-reads and refuses.
      const refused =
        result instanceof ForbiddenError || (result?.items && result.items[0].status === "skipped");
      expect(refused).toBe(true);
    }
    expect(
      JSON.stringify([
        here.sqlite.prepare("SELECT id, signup_review, banned_permanently FROM users").all(),
        here.sqlite.prepare("SELECT id, action FROM moderator_log").all(),
      ]),
    ).toBe(before);
    database.close();
  });
});

describe("a node members only read", () => {
  test("an account that waits reads what a guest reads", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const open = insertNode(w.ctx, { title: "Open" });
    const closed = insertNode(w.ctx, { title: "Members only" });
    invalidate(w.ctx, "node_tree");
    await w.run("permissions.set", w.founder.actor, {
      groupId: 1,
      nodeId: closed.id,
      entries: [{ permission: "node.view", value: "no" }],
    });
    await w.run("permissions.set", w.founder.actor, {
      groupId: 2,
      nodeId: closed.id,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    const asMember = (await w.run("nodes.list", w.member.actor, {})).items.map(
      (n: { id: number }) => n.id,
    );
    expect(asMember).toContain(closed.id);
    const waiting = (await w.run("nodes.list", newcomer.actor, {})).items.map(
      (n: { id: number }) => n.id,
    );
    expect(waiting).toContain(open.id);
    expect(waiting).not.toContain(closed.id);
    await w.run("signups.decide", w.moderator.actor, {
      userIds: [newcomer.id],
      decision: "approve",
    });
    const approved = (await w.run("nodes.list", newcomer.actor, {})).items.map(
      (n: { id: number }) => n.id,
    );
    expect(approved).toContain(closed.id);
  });
});

describe("signups.decide edge cases", () => {
  test("rejecting by erasure needs what erasing a member needs: admin.members and the password", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const input = {
      userIds: [newcomer.id],
      decision: "reject",
      mode: "delete",
      actorPassword: PASSWORD,
    };
    await expect(w.run("signups.decide", w.moderator.actor, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(w.review(newcomer.id)).toBe("pending");
    expect(await w.run("signups.decide", w.founder.actor, input)).toMatchObject({ done: 1 });
  });

  test("an erasure that stops part way leaves the account waiting; deciding again finishes it and mails once", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    await w.drain();
    const authContext = await getAuth(w.ctx).$context;
    const original = authContext.internalAdapter.deleteAccounts;
    authContext.internalAdapter.deleteAccounts = async () => {
      throw new Error("injected");
    };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const decide = () =>
      w.run("signups.decide", w.founder.actor, {
        userIds: [newcomer.id],
        decision: "reject",
        mode: "delete",
        reason: "Spam",
        actorPassword: PASSWORD,
      });
    try {
      // The batch goes on: this one is reported as failed, without the internal message.
      expect(await decide()).toMatchObject({
        failed: 1,
        items: [{ status: "failed", message: "The change failed." }],
      });
    } finally {
      authContext.internalAdapter.deleteAccounts = original;
      logged.mockRestore();
    }
    // Closed, but still waiting: it can be decided again, and the member was mailed already.
    expect(w.review(newcomer.id)).toBe("pending");
    expect(
      w.ctx.sqlite.prepare("SELECT erased_at FROM users WHERE id = ?1").get(newcomer.id),
    ).not.toEqual({ erased_at: null });
    await w.drain();
    expect(w.capture!.messages.filter((m) => /not approved/.test(m.subject))).toHaveLength(1);

    expect(await decide()).toMatchObject({ done: 1 });
    expect(w.review(newcomer.id)).toBeNull();
    expect(w.logOf(newcomer.id).filter((entry) => entry.action === "signup.reject")).toHaveLength(
      1,
    );
    await w.drain();
    expect(w.capture!.messages.filter((m) => /not approved/.test(m.subject))).toHaveLength(1);
    const alerts = (await w.run("notifications.list", w.moderator.actor, { limit: 10 })).items;
    expect(
      alerts
        .filter((a: { type: string }) => a.type === "moderator.signup")
        .map((a: { read: boolean }) => a.read),
    ).toEqual([true]);
  });

  test("the rejection mail leaves no address behind in the finished job", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    await w.run("signups.decide", w.founder.actor, {
      userIds: [newcomer.id],
      decision: "reject",
      mode: "ban",
      reason: "No",
    });
    await w.drain();
    const jobs = w.ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM jobs WHERE type = 'email.account' AND json_extract(payload, '$.kind') = 'signupRejected'",
      )
      .all();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0]!.payload).email).toBe("");
  });

  test("a waiting account that holds a higher group ranks by it: a moderator cannot decide on it", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(newcomer.id);
    for (const input of [
      { decision: "approve" },
      { decision: "reject", mode: "ban", banDays: 7 },
    ] as const) {
      const result = await w.run("signups.decide", w.moderator.actor, {
        userIds: [newcomer.id],
        ...input,
      });
      expect(result).toMatchObject({ done: 0, skipped: 1 });
    }
    expect(w.review(newcomer.id)).toBe("pending");
    expect(
      await w.run("signups.decide", w.founder.actor, {
        userIds: [newcomer.id],
        decision: "approve",
      }),
    ).toMatchObject({ done: 0, skipped: 1 });
  });

  test("an administrator's erasure of a waiting account clears its alert too", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    await w.drain();
    await w.run("users.adminErase", w.founder.actor, {
      userId: newcomer.id,
      actorPassword: PASSWORD,
      reason: "Spam",
    });
    await w.drain();
    const alerts = (await w.run("notifications.list", w.moderator.actor, { limit: 10 })).items;
    expect(alerts.find((a: { type: string }) => a.type === "moderator.signup").read).toBe(true);
  });

  test("the queue and the administration list read the waiting accounts through the index", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, signupSql.page, [Number.MAX_SAFE_INTEGER, 21, 0]);
    expectNoTableScan(ctx, adminSql.awaiting, [Number.MAX_SAFE_INTEGER, 21]);
  });

  test("an account that waits cannot upload", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const dir = mkdtempSync(join(tmpdir(), "sermo-await-"));
    try {
      const storage = createStorage(w.ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
      });
      await expect(
        storage.upload(w.as(newcomer), new Blob(["x"]).stream(), "text/plain"),
      ).rejects.toMatchObject({ issues: [{ path: ["approval"] }] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("an address is masked to its first letter and its domain", () => {
  expect(maskEmail("jane.doe@example.org")).toBe("j***@example.org");
  expect(maskEmail("nonsense")).toBe("***");
});
