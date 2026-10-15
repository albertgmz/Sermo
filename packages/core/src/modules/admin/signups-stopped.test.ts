import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { ForbiddenError } from "../../errors";
import { getAuth } from "../auth";
import { accountMailState } from "../email";
import { runDueJobs } from "../jobs/queue";
import { closeAll } from "./fixtures.test";
import { PASSWORD, queueWorld } from "./signup-fixtures.test";

afterEach(closeAll);

type World = Awaited<ReturnType<typeof queueWorld>>;

/** Makes one step of the identity provider fail, as a Better Auth error would. */
async function stopErasure(w: World, at: "updateUser" | "deleteAccounts") {
  const adapter = (await getAuth(w.ctx).$context).internalAdapter as unknown as Record<
    string,
    unknown
  >;
  const original = adapter[at];
  adapter[at] = async () => {
    throw new Error("injected");
  };
  const logged = spyOn(console, "error").mockImplementation(() => {});
  return () => {
    adapter[at] = original;
    logged.mockRestore();
  };
}

const reject = (w: World, id: number, actor: object = w.founder.actor) =>
  w.run("signups.decide", actor, {
    userIds: [id],
    decision: "reject",
    mode: "delete",
    reason: "Spam",
    actorPassword: PASSWORD,
  });

describe("a rejection that stopped part way", () => {
  for (const at of ["updateUser", "deleteAccounts"] as const)
    test(`stays listed and counted, refuses approval and ban, and resuming mails once (stopped at ${at})`, async () => {
      const w = await queueWorld({ mail: true });
      const newcomer = await w.join("Newcomer");
      w.confirm(newcomer.id);
      const restore = await stopErasure(w, at);
      try {
        expect(await reject(w, newcomer.id)).toMatchObject({ failed: 1 });
      } finally {
        restore();
      }
      const listed = (await w.run("signups.list", w.founder.actor, {})).items;
      expect(listed.map((item: { user: { id: number } }) => item.user.id)).toEqual([newcomer.id]);
      expect(listed[0].erasureStopped).toBe(true);
      expect((await w.run("auth.counters", w.founder.actor, {})).pendingSignups.count).toBe(1);
      // Approving or banning it is refused; only erasing again finishes it.
      for (const input of [{ decision: "approve" }, { decision: "reject", mode: "ban" }] as const) {
        const result = await w.run("signups.decide", w.founder.actor, {
          userIds: [newcomer.id],
          ...input,
        });
        expect(result).toMatchObject({ done: 0, skipped: 1 });
        expect(result.items[0].message).toMatch(/erasure stopped part way/);
      }
      expect(await reject(w, newcomer.id)).toMatchObject({ done: 1 });
      expect((await w.run("signups.list", w.founder.actor, {})).items).toEqual([]);
      await w.drain();
      expect(w.capture!.messages.filter((m) => /not approved/.test(m.subject))).toHaveLength(1);
      expect(w.logOf(newcomer.id).filter((entry) => entry.action === "signup.reject")).toHaveLength(
        1,
      );
    });

  test("two deciders at once: one erases, the other is refused, and the member is mailed once", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    const [a, b] = await Promise.all([reject(w, newcomer.id), reject(w, newcomer.id)]);
    expect([a.done, b.done].sort()).toEqual([0, 1]);
    expect((a.done === 0 ? a : b).items[0].status).toBe("skipped");
    await w.drain();
    expect(w.capture!.messages.filter((m) => /not approved/.test(m.subject))).toHaveLength(1);
  });

  test("an API key cannot reject by erasure: it cannot give the password", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    const key = { ...(w.founder.actor as object), kind: "token", tokenId: 1 };
    await expect(reject(w, newcomer.id, key)).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.review(newcomer.id)).toBe("pending");
  });
});

describe("the rejection mail job", () => {
  const job = (w: World) =>
    w.ctx.sqlite
      .prepare<{ payload: string; last_error: string | null; status: string }, []>(
        "SELECT payload, last_error, status FROM jobs WHERE type = 'email.account' AND json_extract(payload, '$.kind') = 'signupRejected'",
      )
      .get()!;

  test("no error text or failure record keeps the address, and the job drops it when it gives up", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    const mailer = accountMailState(w.ctx)!.mailer;
    mailer.send = async () => {
      throw new Error("421 try later for <Newcomer@Example.Test> (newcomer@example.test)");
    };
    await w.run("signups.decide", w.founder.actor, { userIds: [newcomer.id], decision: "reject" });
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runDueJobs(w.ctx);
      expect(job(w).last_error ?? "").not.toMatch(/example\.test/i);
      w.ctx.clock.advance(2 * 3_600_000);
    }
    expect(job(w).status).toBe("failed");
    expect(JSON.parse(job(w).payload).email).toBe("");
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM email_failures WHERE email LIKE '%example.test%' AND template = 'signupRejected'",
        )
        .get()!.n,
    ).toBe(0);
  });

  test("an address with characters a pattern treats specially is cut out as well", async () => {
    const w = await queueWorld({ mail: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    w.ctx.sqlite
      .prepare("UPDATE auth_user SET email = 'news+spam.(x)@example.test' WHERE id = ?1")
      .run(newcomer.id);
    accountMailState(w.ctx)!.mailer.send = async () => {
      throw new Error("421 try later for news+spam.(x)@example.test");
    };
    await w.run("signups.decide", w.founder.actor, { userIds: [newcomer.id], decision: "reject" });
    await runDueJobs(w.ctx);
    expect(job(w).last_error ?? "").not.toMatch(/example\.test/i);
  });

  test("an address the mailer cannot deliver to leaves the job at once, unsent", async () => {
    const w = await queueWorld({ mail: true });
    const other = await w.join("Other");
    w.confirm(other.id);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO undeliverable_emails (email, reason, created_at) VALUES ('other@example.test', 'bounce', 1)",
      )
      .run();
    await w.run("signups.decide", w.founder.actor, { userIds: [other.id], decision: "reject" });
    await runDueJobs(w.ctx);
    expect(JSON.parse(job(w).payload).email).toBe("");
  });
});

describe("the standing alert follows the queue", () => {
  const unread = async (w: World) =>
    (await w.run("notifications.list", w.moderator.actor, { limit: 10 })).items
      .filter((item: { type: string }) => item.type === "moderator.signup")
      .map((item: { read: boolean }) => item.read);

  test("an ordinary ban of the last waiting account clears it; lifting the ban raises it again", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    await w.drain();
    expect(await unread(w)).toEqual([false]);
    const ban = await w.run("bans.create", w.founder.actor, {
      userId: newcomer.id,
      reason: "Spam",
      expiresAt: null,
      notify: false,
    });
    await w.drain();
    expect(await unread(w)).toEqual([true]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(0);
    await w.run("bans.lift", w.founder.actor, { banId: ban.id, reason: "Mistake", notify: false });
    await w.drain();
    expect(await unread(w)).toEqual([false, true]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(1);
  });

  test("a ban that ends brings the account back to the queue with an alert", async () => {
    const w = await queueWorld();
    const newcomer = await w.join("Newcomer");
    await w.drain();
    await w.run("signups.decide", w.founder.actor, {
      userIds: [newcomer.id],
      decision: "reject",
      banDays: 3,
    });
    await w.drain();
    expect(await unread(w)).toEqual([true]);
    w.ctx.clock.advance(4 * 86_400_000);
    // The job at the end of the ban announces the account; the next pass delivers the alert.
    await w.drain();
    await w.drain();
    expect(await unread(w)).toEqual([false, true]);
    expect((await w.run("auth.counters", w.moderator.actor, {})).pendingSignups.count).toBe(1);
  });
});
