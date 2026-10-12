import { afterEach, describe, expect, test } from "bun:test";
import { tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import {
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { getAuth } from "../auth";
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
    expect(entry).toMatchObject({ action: "member.email" });
    // That it changed and was verified, and not the smallest part of the address.
    expect(entry!.details).toEqual({ changed: true, verified: true });
    expect(JSON.stringify(entry)).not.toContain("new.address");
    expect(JSON.stringify(entry)).not.toContain("example.org");
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

// Links, takeover by rank, the guess limit and the failure log ----------------------------------

const link = async (w: Awaited<ReturnType<typeof world>>, identifier: string, userId: number) => {
  const authContext = await getAuth(w.ctx).$context;
  await authContext.internalAdapter.createVerificationValue({
    identifier,
    value: String(userId),
    // Better Auth reads the real clock, not the forum's.
    expiresAt: new Date(Date.now() + 3_600_000),
  });
};
const links = (w: Awaited<ReturnType<typeof world>>) =>
  w.ctx.sqlite
    .prepare<{ identifier: string }, []>("SELECT identifier FROM auth_verification ORDER BY id")
    .all()
    .map((entry) => entry.identifier);

describe("users.adminUpdateIdentity and the links a member asked for", () => {
  test("a new password or a new address cancels that member's reset and change-email links", async () => {
    const w = await world();
    const other = await w.register("Other");
    await link(w, "reset-password:old", w.target.id);
    await link(w, "change-email:old", w.target.id);
    await link(w, "reset-password:other", other.id);
    await w.edit({ password: "Brand-new-secret-1" });
    expect(links(w)).toEqual(["reset-password:other"]);
    // The link no longer sets a password.
    await expect(
      getAuth(w.ctx).api.resetPassword({
        body: { token: "old", newPassword: "Another-secret-22" },
      }),
    ).rejects.toBeDefined();
    await w.signIn("target@example.test", "Brand-new-secret-1");

    await link(w, "reset-password:second", w.target.id);
    await w.edit({ email: "moved@example.org" });
    expect(links(w)).toEqual(["reset-password:other"]);

    // A rename, or only the verified flag, leaves them alone.
    await link(w, "reset-password:third", w.target.id);
    await w.edit({ username: "Renamed Again" });
    await w.edit({ emailVerified: true });
    expect(links(w)).toEqual(["reset-password:other", "reset-password:third"]);
  });
});

describe("administration over a member who administers", () => {
  const delegate = async (w: Awaited<ReturnType<typeof world>>, name: string, ids: string[]) => {
    const who = await w.register(name, 3);
    await w.run("permissions.set", w.founder.actor, {
      userId: who.id,
      entries: ids.map((permission) => ({ permission, value: "allow" })),
    });
    return who;
  };
  const touch = {
    "users.adminUpdateIdentity": (id: number) => ({
      userId: id,
      actorPassword: PASSWORD,
      password: "Brand-new-secret-1",
    }),
    "users.adminErase": (id: number) => ({
      userId: id,
      actorPassword: PASSWORD,
      reason: "Cleanup",
    }),
    "users.adminRevokeSessions": (id: number) => ({ userId: id }),
  };

  for (const [name, input] of Object.entries(touch))
    test(`${name}: holding admin.members is not enough to reach a lower-ranked administrator`, async () => {
      const w = await world();
      const helper = await delegate(w, "Helper", ["admin.members"]);
      const steward = await delegate(w, "Steward", ["admin.members", "admin.permissions"]);
      // A lower-ranked member who administers through a personal entry.
      const clerk = await w.register("Clerk");
      await w.run("permissions.set", w.founder.actor, {
        userId: clerk.id,
        entries: [{ permission: "admin.announcements", value: "allow" }],
      });
      await expect(w.run(name, helper.actor, input(clerk.id))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      // Nothing of the member changed.
      expect(
        w.ctx.sqlite
          .prepare(
            "SELECT 1 FROM auth_account a JOIN users u ON u.id = a.user_id WHERE u.id = ?1 AND u.erased_at IS NULL",
          )
          .get(clerk.id),
      ).not.toBeNull();
      // A plain member is still within reach of admin.members alone.
      await w.run(name, helper.actor, input(w.target.id));
      // And an administrator who holds admin.permissions as well reaches the clerk.
      await w.run(name, steward.actor, input(clerk.id));
    });

  test("a ban does not put an administrator within reach", async () => {
    const w = await world();
    const helper = await delegate(w, "Helper", ["admin.members"]);
    const clerk = await w.register("Clerk");
    await w.run("permissions.set", w.founder.actor, {
      userId: clerk.id,
      entries: [{ permission: "admin.announcements", value: "allow" }],
    });
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(clerk.id);
    await expect(
      w.run("users.adminUpdateIdentity", helper.actor, {
        userId: clerk.id,
        actorPassword: PASSWORD,
        password: "Brand-new-secret-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("the extra permission is rechecked when the request is carried out", async () => {
    const w = await world();
    const steward = await delegate(w, "Steward", ["admin.members", "admin.permissions"]);
    const clerk = await w.register("Clerk");
    await w.run("permissions.set", w.founder.actor, {
      userId: clerk.id,
      entries: [{ permission: "admin.announcements", value: "allow" }],
    });
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, steward.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        { userId: steward.id, entries: [{ permission: "admin.permissions", value: "unset" }] },
      );
      await expect(
        execute(here, getOperation("users.adminUpdateIdentity"), stale, {
          userId: clerk.id,
          actorPassword: PASSWORD,
          password: "Brand-new-secret-1",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite.prepare("SELECT 1 FROM moderator_log WHERE action = 'member.password'").get(),
      ).toBeNull();
    } finally {
      database.close();
    }
  });
});

describe("the limit on wrong passwords", () => {
  const WINDOW = 15 * 60_000;
  const verify = (w: Awaited<ReturnType<typeof world>>, password: string, as = w.founder) =>
    w.run("auth.verifyPassword", as.actor, { password });

  test("five wrong answers in fifteen minutes block every answer until the window moves on", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++)
      await expect(verify(w, "wrong-wrong-1")).rejects.toThrow(/not your password/);
    await expect(verify(w, "wrong-wrong-1")).rejects.toBeInstanceOf(RateLimitedError);
    // The right password is refused as well while the window holds.
    await expect(verify(w, PASSWORD)).rejects.toThrow(/too many/i);
    await expect(w.edit({ password: "Brand-new-secret-1" })).rejects.toThrow(/too many/i);
    await expect(
      w.run("users.adminErase", w.founder.actor, {
        userId: w.target.id,
        actorPassword: PASSWORD,
        reason: "Cleanup",
      }),
    ).rejects.toThrow(/too many/i);
    // Another administrator is not affected.
    const other = await w.register("Other", 4);
    expect(await verify(w, PASSWORD, other)).toEqual({ ok: true });
    // The window passes: the first wrong answers age out, and are deleted.
    w.ctx.clock.advance(WINDOW + 1000);
    expect(await verify(w, PASSWORD)).toEqual({ ok: true });
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM admin_password_failures WHERE user_id = ?1",
        )
        .get(w.founder.id)!.n,
    ).toBe(0);
  });

  test("a right answer within the limit works and does not clear the wrong ones", async () => {
    const w = await world();
    for (let i = 0; i < 4; i++) await expect(verify(w, "wrong-wrong-1")).rejects.toBeDefined();
    expect(await verify(w, PASSWORD)).toEqual({ ok: true });
    expect(await verify(w, PASSWORD)).toEqual({ ok: true });
    // The fifth wrong answer is still the last one allowed.
    await expect(verify(w, "wrong-wrong-1")).rejects.toThrow(/not your password/);
    await expect(verify(w, PASSWORD)).rejects.toThrow(/too many/i);
  });

  test("answers sent together are all counted", async () => {
    const w = await world();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => verify(w, "wrong-wrong-1")),
    );
    const refused = results.filter(
      (result) => result.status === "rejected" && /too many/i.test(String(result.reason)),
    );
    expect(refused).toHaveLength(3);
  });
});

describe("users.adminUpdateIdentity when the reset email cannot be made", () => {
  test("keeps what was changed, logs the failure with its step, and says it failed", async () => {
    const w = await world(true);
    const auth = getAuth(w.ctx);
    const original = auth.api.requestPasswordReset;
    (auth.api as { requestPasswordReset: unknown }).requestPasswordReset = (async () => {
      throw new Error("mail is down");
    }) as unknown as typeof original;
    try {
      await expect(
        w.edit({ username: "Renamed Mid Way", sendPasswordReset: true }),
      ).rejects.toThrow(/mail is down/);
    } finally {
      (auth.api as { requestPasswordReset: unknown }).requestPasswordReset = original;
    }
    expect(row(w).username).toBe("Renamed Mid Way");
    expect(w.logOf(w.target.id).map((entry) => [entry.action, entry.details])).toEqual([
      ["member.username", { from: "Target", to: "Renamed Mid Way" }],
      ["member.passwordReset", {}],
      ["member.identity.failed", { step: "reset" }],
    ]);
  });
});

describe("the name Better Auth keeps for the member", () => {
  test("follows a rename by an administrator", async () => {
    const w = await world();
    await w.edit({ username: "Brand New Name" });
    expect(
      w.ctx.sqlite
        .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
        .get(w.target.id)!.name,
    ).toBe("Brand New Name");
  });

  test("follows a member's own rename", async () => {
    const w = await world();
    await w.run("permissions.set", w.founder.actor, {
      userId: w.target.id,
      entries: [{ permission: "profile.renameFree", value: "allow" }],
    });
    await w.run("users.changeUsername", w.target.actor, { username: "Own Choice" });
    expect(
      w.ctx.sqlite
        .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
        .get(w.target.id)!.name,
    ).toBe("Own Choice");
  });
});
