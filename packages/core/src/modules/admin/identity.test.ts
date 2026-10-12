import { afterEach, describe, expect, test } from "bun:test";
import { tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { runDueJobs } from "../jobs/queue";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

async function world(mail = false) {
  const w = await accounts({ mail });
  const founder = await w.register("Founder", 4);
  const target = await w.register("Target");
  const edit = (input: object, as: { actor: object } = founder) =>
    w.run("users.adminUpdateIdentity", as.actor, {
      userId: target.id,
      actorPassword: PASSWORD,
      ...input,
    });
  return { ...w, founder, target, edit };
}

const row = (w: Awaited<ReturnType<typeof world>>) =>
  w.ctx.sqlite
    .prepare<
      {
        username: string;
        username_key: string;
        changed: number | null;
        email: string;
        verified: number;
      },
      [number]
    >(
      "SELECT u.username, u.username_key, u.username_changed_at AS changed, a.email, a.email_verified AS verified FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
    )
    .get(w.target.id)!;

describe("users.adminUpdateIdentity", () => {
  test("renames through Better Auth for nothing, stamps the change and logs it", async () => {
    const w = await world();
    w.ctx.clock.advance(1000);
    const view = await w.edit({ username: "Renamed One" });
    expect(view.card.username).toBe("Renamed One");
    expect(view.usernameChangedAt).toBe(new Date(w.ctx.now()).toISOString());
    expect(row(w)).toMatchObject({ username: "Renamed One", username_key: "renamed one" });
    expect(
      w.ctx.sqlite
        .prepare<{ username: string; display_username: string }, [number]>(
          "SELECT username, display_username FROM auth_user WHERE id = ?1",
        )
        .get(w.target.id),
    ).toEqual({ username: "renamed one", display_username: "Renamed One" });
    expect(w.logOf(w.target.id)).toEqual([
      { action: "member.username", reason: "", details: { from: "Target", to: "Renamed One" } },
    ]);
    // A taken, an invalid and an unchanged name are refused and leave nothing behind.
    await expect(w.edit({ username: "FOUNDER" })).rejects.toBeInstanceOf(ConflictError);
    await expect(w.edit({ username: "bad/name" })).rejects.toBeInstanceOf(ValidationError);
    await expect(w.edit({ username: "Renamed One" })).rejects.toBeInstanceOf(ValidationError);
    expect(w.logOf(w.target.id)).toHaveLength(1);
  });

  test("changes the email without logging the address, and marks it verified or not", async () => {
    const w = await world();
    const view = await w.edit({ email: "New.Address@Example.org", emailVerified: true });
    expect(view).toMatchObject({ email: "new.address@example.org", emailVerified: true });
    expect(row(w)).toMatchObject({ email: "new.address@example.org", verified: 1 });
    const [entry] = w.logOf(w.target.id);
    expect(entry).toMatchObject({
      action: "member.email",
      details: { changed: true, domain: "example.org", verified: true },
    });
    expect(JSON.stringify(entry)).not.toContain("new.address");
    // Default: the flag stays as it was.
    expect((await w.edit({ email: "second@example.org" })).emailVerified).toBe(true);
    // Only the flag.
    expect((await w.edit({ emailVerified: false })).emailVerified).toBe(false);
    await expect(w.edit({ email: "FOUNDER@example.test" })).rejects.toBeInstanceOf(ConflictError);
    await expect(
      w.edit({ email: "second@example.org", emailVerified: false }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("verifying an unconfirmed member promotes them", async () => {
    const w = await world();
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 5 WHERE id = ?1").run(w.target.id);
    const view = await w.edit({ emailVerified: true });
    expect(view.state).toBe("valid");
    expect(
      w.ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(w.target.id)!.group_id,
    ).toBe(2);
  });

  test("a new password replaces the old, signs the member out everywhere and is never logged", async () => {
    const w = await world();
    await w.signIn("target@example.test");
    await w.signIn("target@example.test");
    expect(w.sessions(w.target.id)).toBe(3);
    await w.edit({ password: "Brand-new-secret-1" });
    expect(w.sessions(w.target.id)).toBe(0);
    await expect(w.signIn("target@example.test")).rejects.toBeDefined();
    await w.signIn("target@example.test", "Brand-new-secret-1");
    const logged = JSON.stringify(w.logOf(w.target.id));
    expect(logged).toContain("member.password");
    expect(logged).not.toContain("Brand-new-secret-1");
    expect(logged).not.toContain("$argon");
  });

  test("a member without a credential account gets one", async () => {
    const w = await world();
    w.ctx.sqlite.prepare("DELETE FROM auth_account WHERE user_id = ?1").run(w.target.id);
    await w.edit({ password: "Brand-new-secret-1" });
    await w.signIn("target@example.test", "Brand-new-secret-1");
  });

  test("a reset link is sent when mail is set up, and refused when it is not", async () => {
    const plain = await world();
    await expect(plain.edit({ sendPasswordReset: true })).rejects.toBeInstanceOf(ConflictError);
    expect(plain.logOf(plain.target.id)).toEqual([]);
    const w = await world(true);
    await w.edit({ sendPasswordReset: true });
    await runDueJobs(w.ctx);
    const mail = w.capture!.messages.findLast((message) => message.to === "target@example.test");
    expect(mail?.text).toMatch(/reset-password/);
    expect(w.logOf(w.target.id).map((entry) => entry.action)).toEqual(["member.passwordReset"]);
    await expect(
      w.edit({ sendPasswordReset: true, password: "Brand-new-secret-1" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(w.edit({})).rejects.toBeInstanceOf(ValidationError);
  });

  test("needs the administrator's own password, and a session", async () => {
    const w = await world();
    await expect(
      w.edit({ username: "Another One", actorPassword: "wrong-wrong-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(row(w).username).toBe("Target");
    await expect(
      w.run("users.adminUpdateIdentity", tokenActor(w.founder), {
        userId: w.target.id,
        actorPassword: PASSWORD,
        username: "Another One",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.run("users.adminUpdateIdentity", GUEST, {
        userId: w.target.id,
        actorPassword: PASSWORD,
        username: "Another One",
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("who may: not members or moderators, not a peer or a higher rank, not a partial administrator", async () => {
    const w = await world();
    const moderator = await w.register("Moderator", 3);
    const member = await w.register("Plain");
    const peer = await w.register("Peer", 4);
    const partial = await w.register("Partial");
    await w.run("permissions.set", w.founder.actor, {
      userId: partial.id,
      entries: [{ permission: "admin.announcements", value: "allow" }],
    });
    for (const who of [moderator, member, partial])
      await expect(w.edit({ username: "Nope Nope" }, who)).rejects.toBeInstanceOf(ForbiddenError);
    // Equal rank: refused both ways.
    await expect(
      w.run("users.adminUpdateIdentity", peer.actor, {
        userId: w.founder.id,
        actorPassword: PASSWORD,
        username: "Nope Nope",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // A administrator holding admin.members only, ranked below the founder, cannot touch the founder.
    const lower = await w.register("Lower", 3);
    await w.run("permissions.set", w.founder.actor, {
      userId: lower.id,
      entries: [{ permission: "admin.members", value: "allow" }],
    });
    await expect(
      w.run("users.adminUpdateIdentity", lower.actor, {
        userId: w.founder.id,
        actorPassword: PASSWORD,
        username: "Nope Nope",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // ... but can edit a plain member.
    await w.run("users.adminUpdateIdentity", lower.actor, {
      userId: member.id,
      actorPassword: PASSWORD,
      username: "Plain Renamed",
    });
    await expect(
      w.run("users.adminUpdateIdentity", w.founder.actor, {
        userId: 9999,
        actorPassword: PASSWORD,
        username: "Ghost Name",
      }),
    ).rejects.toBeDefined();
    expect(row(w).username).toBe("Target");
  });

  test("an administrator revoked in another process changes nothing", async () => {
    const w = await world();
    const admin = await w.register("Delegate", 3);
    await w.run("permissions.set", w.founder.actor, {
      userId: admin.id,
      entries: [{ permission: "admin.members", value: "allow" }],
    });
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      // Resolved here, with admin.members.
      const stale = resolvedActor(here, admin.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        {
          userId: admin.id,
          entries: [{ permission: "admin.members", value: "unset" }],
        },
      );
      await expect(
        execute(here, getOperation("users.adminUpdateIdentity"), stale, {
          userId: w.target.id,
          actorPassword: PASSWORD,
          username: "Hijacked Name",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const after = here.sqlite
        .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
        .get(w.target.id)!;
      expect(after.username).toBe("Target");
      expect(
        here.sqlite.prepare("SELECT 1 FROM moderator_log WHERE action = 'member.username'").get(),
      ).toBeNull();
    } finally {
      database.close();
    }
  });
});
