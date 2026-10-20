import { afterEach, describe, expect, test } from "bun:test";
import { insertNode, tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { getAuth } from "../auth";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const target = await w.register("Target");
  const fan = await w.register("Fan");
  const idol = await w.register("Idol");
  const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
  invalidate(w.ctx, "node_tree");
  const thread = await w.run("threads.create", target.actor, {
    nodeId: node.id,
    title: "Their thread",
    body: "Their words",
  });
  await w.run("users.follow", fan.actor, { userId: target.id });
  await w.run("users.follow", target.actor, { userId: idol.id });
  await w.run("users.adminUpdateProfile", founder.actor, {
    userId: target.id,
    about: "About them",
    location: "Somewhere",
    website: "https://example.org",
    customTitle: "Title",
    signature: "Sig",
  });
  w.ctx.sqlite
    .prepare(
      "UPDATE users SET birthday_md = '01-02', social_x = 'handle', accent_color_id = NULL, name_icon_item_id = 7 WHERE id = ?1",
    )
    .run(target.id);
  await w.signIn("target@example.test");
  w.ctx.sqlite
    .prepare(
      "INSERT INTO auth_apikey (config_id, key, reference_id, created_at, updated_at, enabled) VALUES ('default', 'hashed', ?1, ?2, ?2, 1)",
    )
    .run(String(target.id), w.ctx.now());
  const erase = (input: object = {}, as: { actor: object } = founder) =>
    w.run("users.adminErase", as.actor, {
      userId: target.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
      ...input,
    });
  const user = (id = target.id) =>
    w.ctx.sqlite
      .prepare<Record<string, unknown>, [number]>("SELECT * FROM users WHERE id = ?1")
      .get(id)!;
  return { ...w, founder, target, fan, idol, thread, erase, user };
}

describe("users.adminErase", () => {
  test("an erased member leaves the recently active list at once", async () => {
    const w = await world();
    const seen = w.ctx.sqlite.prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2");
    seen.run(w.ctx.now(), w.target.id);
    seen.run(w.ctx.now(), w.fan.id);
    const listed = async () =>
      (await w.run("users.recentlyActive", GUEST, {})).items.map(
        (item: { card: { id: number } }) => item.card.id,
      );
    expect(await listed()).toContain(w.target.id);
    await w.erase();
    expect(await listed()).not.toContain(w.target.id);
    expect(await listed()).toContain(w.fan.id);
  });

  test("closes the account: nobody can sign in, the identity is gone, the writing stays", async () => {
    const w = await world();
    const name = `Deleted member ${w.target.id}`;
    expect(await w.erase()).toEqual({ ok: true });

    await expect(w.signIn("target@example.test")).rejects.toBeDefined();
    await expect(w.signIn(`erased-${w.target.id}@invalid`)).rejects.toBeDefined();
    await expect(
      (await import("../auth")).getAuth(w.ctx).api.signInUsername({
        body: { username: "Target", password: PASSWORD },
      }),
    ).rejects.toBeDefined();
    await expect(
      (await import("../auth")).getAuth(w.ctx).api.signInUsername({
        body: { username: name, password: PASSWORD },
      }),
    ).rejects.toBeDefined();
    expect(w.sessions(w.target.id)).toBe(0);
    expect(
      w.ctx.sqlite
        .prepare("SELECT 1 FROM auth_apikey WHERE reference_id = ?1")
        .get(String(w.target.id)),
    ).toBeNull();
    expect(
      w.ctx.sqlite.prepare("SELECT 1 FROM auth_account WHERE user_id = ?1").get(w.target.id),
    ).toBeNull();
    expect(
      w.ctx.sqlite
        .prepare<Record<string, unknown>, [number]>(
          "SELECT email, email_verified, username, display_username FROM auth_user WHERE id = ?1",
        )
        .get(w.target.id),
    ).toMatchObject({ email: `erased-${w.target.id}@invalid`, email_verified: 0 });

    // What they wrote stays, under the new name; the card holds nothing else of them.
    const posted = await w.run("threads.get", GUEST, { threadId: w.thread.thread.id });
    expect((posted.thread ?? posted).author.username).toBe(name);
    const [card] = (await w.run("users.cards", GUEST, { userIds: [w.target.id] })).items;
    expect(card).toMatchObject({ username: name, avatar: null, frame: null, nameColor: null });
    expect(card.title).not.toBe("Title");
    expect(w.user(w.target.id)).toMatchObject({
      username: name,
      username_key: name.toLowerCase(),
      about: "",
      location: "",
      website: "",
      custom_title: null,
      name_icon_item_id: null,
      signature_source: null,
      signature_html: null,
      birthday_md: null,
      social_x: "",
      avatar_file_id: null,
      cover_file_id: null,
      follower_count: 0,
      following_count: 0,
    });
    // Banned members' profiles still open, now empty.
    expect(await w.run("profiles.get", GUEST, { userId: w.target.id })).toMatchObject({
      username: name,
      about: "",
      location: "",
      website: "",
      avatar: null,
      customTitle: null,
      signatureHtml: null,
      birthday: null,
      socials: { discord: "", telegram: "", x: "" },
    });
  });

  test("bans for good through the ban register, ends the follows with right counters, and logs once", async () => {
    const w = await world();
    await w.erase();
    const ban = await w.run("bans.list", w.founder.actor, { userId: w.target.id });
    expect(ban.items).toHaveLength(1);
    expect(ban.items[0]).toMatchObject({
      reason: "Right to be forgotten",
      expiresAt: null,
      state: "active",
      moderator: { username: "Founder" },
    });
    expect(w.user(w.fan.id)).toMatchObject({ following_count: 0 });
    expect(w.user(w.idol.id)).toMatchObject({ follower_count: 0 });
    expect(w.ctx.sqlite.prepare("SELECT 1 FROM user_follows").get()).toBeNull();
    const erased = w.logOf(w.target.id).filter((entry) => entry.action === "member.erase");
    expect(erased).toEqual([
      { action: "member.erase", reason: "Right to be forgotten", details: {} },
    ]);
    // The log about them survives, and carries neither their old name nor address.
    expect(JSON.stringify(w.logOf(w.target.id))).not.toContain("target@example.test");
  });

  test("runs again on a half-erased member and finishes the job", async () => {
    const w = await world();
    await w.erase();
    // As if the first run had stopped after the ban: identity and profile back as they were.
    w.ctx.sqlite
      .prepare("UPDATE auth_user SET email = 'target@example.test' WHERE id = ?1")
      .run(w.target.id);
    w.ctx.sqlite
      .prepare("UPDATE users SET about = 'Back again', location = 'Back' WHERE id = ?1")
      .run(w.target.id);
    await w.erase();
    expect(w.user()).toMatchObject({ about: "", location: "" });
    expect(
      w.ctx.sqlite
        .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
        .get(w.target.id)!.email,
    ).toBe(`erased-${w.target.id}@invalid`);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM bans WHERE user_id = ?1")
        .get(w.target.id)!.n,
    ).toBe(1);
  });

  test("refuses the last holder of admin.permissions, oneself, and a wrong password, changing nothing", async () => {
    const w = await world();
    const holder = await w.register("Holder");
    await w.run("permissions.set", w.founder.actor, {
      userId: holder.id,
      entries: [{ permission: "admin.permissions", value: "allow" }],
    });
    await w.run("permissions.set", w.founder.actor, {
      groupId: 4,
      entries: [{ permission: "admin.permissions", value: "unset" }],
    });
    await w
      .run("users.setGroups", w.founder.actor, {
        userId: w.founder.id,
        primaryGroupId: 4,
      })
      .catch(() => undefined);
    // The founder no longer holds admin.permissions, so cannot reach a member who does (the rule
    // that an administrator is only reached by one who holds it too); the ban's own guard for the
    // last holder cannot be met through this operation any more.
    await expect(
      w.run("users.adminErase", w.founder.actor, {
        userId: holder.id,
        actorPassword: PASSWORD,
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.user(holder.id)).toMatchObject({ username: "Holder", banned_permanently: 0 });
    expect(w.signIn("holder@example.test")).resolves.toBeDefined();

    await expect(
      w.run("users.adminErase", w.founder.actor, {
        userId: w.founder.id,
        actorPassword: PASSWORD,
        reason: "Self",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(w.erase({ actorPassword: "wrong-wrong-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(w.user()).toMatchObject({ username: "Target", banned_permanently: 0 });
  });

  test("who may: administrators over the member, with a session", async () => {
    const w = await world();
    const moderator = await w.register("Moderator", 3);
    const member = await w.register("Plain");
    const peer = await w.register("Peer", 4);
    const partial = await w.register("Partial", 3);
    await w.run("permissions.set", w.founder.actor, {
      userId: partial.id,
      entries: [{ permission: "admin.announcements", value: "allow" }],
    });
    await expect(w.erase({}, { actor: GUEST })).rejects.toBeInstanceOf(UnauthenticatedError);
    for (const who of [member, moderator, partial])
      await expect(w.erase({}, who)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.erase({}, { actor: tokenActor(w.founder) })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      w.run("users.adminErase", peer.actor, {
        userId: w.founder.id,
        actorPassword: PASSWORD,
        reason: "Coup",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.run("users.adminErase", w.founder.actor, {
        userId: 9999,
        actorPassword: PASSWORD,
        reason: "Ghost",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.user()).toMatchObject({ username: "Target" });
  });
});

describe("users.adminErase and a stale actor", () => {
  test("an administrator revoked in another process erases nothing", async () => {
    const w = await world();
    const delegate = await w.register("Delegate", 3);
    await w.run("permissions.set", w.founder.actor, {
      userId: delegate.id,
      entries: [{ permission: "admin.members", value: "allow" }],
    });
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, delegate.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        { userId: delegate.id, entries: [{ permission: "admin.members", value: "unset" }] },
      );
      await expect(
        execute(here, getOperation("users.adminErase"), stale, {
          userId: w.target.id,
          actorPassword: PASSWORD,
          reason: "Stale",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare<{ username: string; banned_permanently: number }, [number]>(
            "SELECT username, banned_permanently FROM users WHERE id = ?1",
          )
          .get(w.target.id),
      ).toEqual({ username: "Target", banned_permanently: 0 });
    } finally {
      database.close();
    }
  });
});

// The marker, the reserved name and the steps that can be run again ----------------------------

const NAME_TAKEN = /taken/i;

describe("the name kept for erased accounts", () => {
  test("nobody registers, renames or checks for such a name, and the message does not advertise it", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const plain = await w.register("Plain");
    for (const name of [
      "Deleted member 7",
      "DELETED MEMBER",
      "deleted member x y",
      "Deleted Member 5-2",
    ])
      await expect(w.register(name)).rejects.toBeDefined();
    expect(
      w.ctx.sqlite.prepare("SELECT 1 FROM users WHERE username_key LIKE 'deleted member%'").get(),
    ).toBeNull();
    // The plain "taken" refusal, for a member's own rename and for an administrator's.
    await expect(
      w.run("users.changeUsername", plain.actor, { username: "Deleted Member 12" }),
    ).rejects.toThrow(NAME_TAKEN);
    await expect(
      w.run("users.adminUpdateIdentity", founder.actor, {
        userId: plain.id,
        actorPassword: PASSWORD,
        username: "deleted member",
      }),
    ).rejects.toThrow(NAME_TAKEN);
    // Better Auth's own availability check agrees.
    const { getAuth } = await import("../auth");
    expect(
      await getAuth(w.ctx).api.isUsernameAvailable({ body: { username: "Deleted Member 3" } }),
    ).toEqual({ available: false });
    expect(
      await getAuth(w.ctx).api.isUsernameAvailable({ body: { username: "Delightful" } }),
    ).toEqual({ available: true });
    // Names that merely resemble it are fine.
    await w.register("Deleted-member");
  });

  test("erase takes the first free Deleted member <id>-<n> when the name is already held", async () => {
    const w = await world();
    // Accounts from before the name was reserved.
    for (const [suffix, id] of [
      ["", w.fan.id],
      ["-1", w.idol.id],
    ] as const) {
      const name = `Deleted member ${w.target.id}${suffix}`;
      w.ctx.sqlite
        .prepare("UPDATE users SET username = ?1, username_key = ?2 WHERE id = ?3")
        .run(name, name.toLowerCase(), id);
      w.ctx.sqlite
        .prepare("UPDATE auth_user SET username = ?1, display_username = ?2 WHERE id = ?3")
        .run(name.toLowerCase(), name, id);
    }
    expect(await w.erase()).toEqual({ ok: true });
    expect(w.user()).toMatchObject({
      username: `Deleted member ${w.target.id}-2`,
      about: "",
      banned_permanently: 1,
    });
    expect(
      w.ctx.sqlite
        .prepare<{ name: string; email: string }, [number]>(
          "SELECT name, email FROM auth_user WHERE id = ?1",
        )
        .get(w.target.id),
    ).toEqual({ name: `Deleted member ${w.target.id}-2`, email: `erased-${w.target.id}@invalid` });
    expect(w.logOf(w.target.id).filter((entry) => entry.action === "member.erase")).toHaveLength(1);
    // A rerun keeps that name.
    await w.erase();
    expect(w.user().username).toBe(`Deleted member ${w.target.id}-2`);
  });
});

type World = Awaited<ReturnType<typeof world>>;
// biome-ignore lint/suspicious/noExplicitAny: the injections replace methods of Better Auth's context
type Loose = any;

describe("users.adminErase from every intermediate state", () => {
  // Each step is made to fail once; what is left is then checked, and a rerun must finish it.
  const injections: Record<string, (w: World, auth: Loose) => () => void> = {
    "sessions and keys": (_w, auth) => {
      const original = auth.internalAdapter.deleteUserSessions;
      auth.internalAdapter.deleteUserSessions = async () => {
        throw new Error("injected");
      };
      return () => {
        auth.internalAdapter.deleteUserSessions = original;
      };
    },
    "pending links": (_w, auth) => {
      const original = auth.adapter.deleteMany;
      auth.adapter.deleteMany = async (args: { model: string }) => {
        if (args.model === "verification") throw new Error("injected");
        return original(args);
      };
      return () => {
        auth.adapter.deleteMany = original;
      };
    },
    "the address": (_w, auth) => {
      const original = auth.internalAdapter.updateUser;
      auth.internalAdapter.updateUser = async (id: string, data: { email?: string }) => {
        if (data.email !== undefined) throw new Error("injected");
        return original(id, data);
      };
      return () => {
        auth.internalAdapter.updateUser = original;
      };
    },
    "the password": (_w, auth) => {
      const original = auth.internalAdapter.deleteAccounts;
      auth.internalAdapter.deleteAccounts = async () => {
        throw new Error("injected");
      };
      return () => {
        auth.internalAdapter.deleteAccounts = original;
      };
    },
    "the profile": (w) => {
      w.ctx.sqlite.exec(
        "CREATE TRIGGER inject_profile BEFORE UPDATE ON users WHEN NEW.about = '' AND OLD.about <> '' BEGIN SELECT RAISE(ABORT, 'injected'); END",
      );
      return () => w.ctx.sqlite.exec("DROP TRIGGER inject_profile");
    },
    "the name": (_w, auth) => {
      const original = auth.internalAdapter.updateUser;
      auth.internalAdapter.updateUser = async (id: string, data: { username?: string }) => {
        if (data.username !== undefined) throw new Error("injected");
        return original(id, data);
      };
      return () => {
        auth.internalAdapter.updateUser = original;
      };
    },
  };

  for (const [step, inject] of Object.entries(injections)) {
    test(`a failure at ${step} leaves a closed account that a rerun finishes`, async () => {
      const w = await world();
      const authContext = await getAuth(w.ctx).$context;
      // A reset link requested before the erasure.
      await authContext.internalAdapter.createVerificationValue({
        identifier: "reset-password:stale-token",
        value: String(w.target.id),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const undo = inject(w, authContext);
      await expect(w.erase()).rejects.toBeDefined();
      undo();
      // Already closed and logged once, whatever step failed.
      expect(w.user()).toMatchObject({ banned_permanently: 1 });
      expect(w.user().erased_at).not.toBeNull();
      expect(w.logOf(w.target.id).filter((entry) => entry.action === "member.erase")).toHaveLength(
        1,
      );
      await expect(w.signIn("target@example.test")).rejects.toBeDefined();

      expect(await w.erase()).toEqual({ ok: true });
      const name = `Deleted member ${w.target.id}`;
      expect(w.user()).toMatchObject({
        username: name,
        about: "",
        location: "",
        banned_permanently: 1,
      });
      expect(
        w.ctx.sqlite.prepare("SELECT name, email FROM auth_user WHERE id = ?1").get(w.target.id),
      ).toEqual({ name, email: `erased-${w.target.id}@invalid` });
      expect(
        w.ctx.sqlite.prepare("SELECT 1 FROM auth_account WHERE user_id = ?1").get(w.target.id),
      ).toBeNull();
      expect(
        w.ctx.sqlite
          .prepare("SELECT 1 FROM auth_verification WHERE value = ?1")
          .get(String(w.target.id)),
      ).toBeNull();
      expect(w.sessions(w.target.id)).toBe(0);
      expect(w.logOf(w.target.id).filter((entry) => entry.action === "member.erase")).toHaveLength(
        1,
      );
      expect(
        w.ctx.sqlite
          .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM bans WHERE user_id = ?1")
          .get(w.target.id)!.n,
      ).toBe(1);
    });
  }
});

describe("an erased member stays closed", () => {
  test("a reset link requested earlier dies with the erasure, and none works afterwards", async () => {
    const w = await world();
    const authContext = await getAuth(w.ctx).$context;
    const link = (token: string) =>
      authContext.internalAdapter.createVerificationValue({
        identifier: `reset-password:${token}`,
        value: String(w.target.id),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    await link("before-erase");
    await authContext.internalAdapter.createVerificationValue({
      identifier: "change-email:digest",
      value: String(w.target.id),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const other = await w.register("Bystander");
    await authContext.internalAdapter.createVerificationValue({
      identifier: "reset-password:bystander",
      value: String(other.id),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await w.erase();
    const pending = () =>
      w.ctx.sqlite
        .prepare<{ identifier: string }, []>("SELECT identifier FROM auth_verification")
        .all()
        .map((row) => row.identifier);
    expect(pending()).toEqual(["reset-password:bystander"]);
    // A link that somehow exists is refused all the same, and makes no credential.
    await link("after-erase");
    await expect(
      getAuth(w.ctx).api.resetPassword({
        body: { token: "after-erase", newPassword: "Brand-new-secret-1" },
      }),
    ).rejects.toBeDefined();
    expect(
      w.ctx.sqlite.prepare("SELECT 1 FROM auth_account WHERE user_id = ?1").get(w.target.id),
    ).toBeNull();
  });

  test("the ban cannot be lifted, and no session starts even if the ban were gone", async () => {
    const w = await world();
    await w.erase();
    const [ban] = (await w.run("bans.list", w.founder.actor, { userId: w.target.id })).items;
    await expect(
      w.run("bans.lift", w.founder.actor, { banId: ban.id, reason: "Mistake" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(w.user()).toMatchObject({ banned_permanently: 1 });
    // As if the ban had been removed some other way.
    w.ctx.sqlite
      .prepare("UPDATE users SET banned_permanently = 0, banned_until = NULL WHERE id = ?1")
      .run(w.target.id);
    const authContext = await getAuth(w.ctx).$context;
    await expect(
      authContext.internalAdapter.createSession(String(w.target.id)),
    ).rejects.toBeDefined();
    expect(w.sessions(w.target.id)).toBe(0);
  });

  test("shows as erased, can be listed so, and takes no administrative change", async () => {
    const w = await world();
    const before = await w.run("users.adminGet", w.founder.actor, { userId: w.target.id });
    expect(before).toMatchObject({ state: "valid", erasedAt: null });
    await w.erase();
    const view = await w.run("users.adminGet", w.founder.actor, { userId: w.target.id });
    expect(view).toMatchObject({ state: "erased" });
    expect(typeof view.erasedAt).toBe("string");
    const ids = async (state: string) =>
      (await w.run("users.adminList", w.founder.actor, { state })).items.map(
        (m: { card: { id: number } }) => m.card.id,
      );
    expect(await ids("erased")).toEqual([w.target.id]);
    expect(await ids("banned")).toEqual([]);
    expect(await ids("valid")).not.toContain(w.target.id);
    await expect(
      w.run("users.adminUpdateIdentity", w.founder.actor, {
        userId: w.target.id,
        actorPassword: PASSWORD,
        password: "Brand-new-secret-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      w.run("users.adminUpdateProfile", w.founder.actor, { userId: w.target.id, about: "Again" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      w.run("users.adminRevokeSessions", w.founder.actor, { userId: w.target.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(w.user()).toMatchObject({ about: "" });
    expect(
      w.ctx.sqlite.prepare("SELECT 1 FROM auth_account WHERE user_id = ?1").get(w.target.id),
    ).toBeNull();
  });

  test("queued account mail for the old address is cancelled", async () => {
    const w = await accounts({ mail: true });
    const founder = await w.register("Founder", 4);
    const target = await w.register("Target");
    const queued = (address: string) =>
      w.ctx.sqlite
        .prepare<{ payload: string }, []>(
          "SELECT payload FROM jobs WHERE type = 'email.account' AND status IN ('pending', 'failed')",
        )
        .all()
        .filter((job) => job.payload.includes(address));
    expect(queued("target@example.test").length).toBeGreaterThan(0);
    await w.run("users.adminErase", founder.actor, {
      userId: target.id,
      actorPassword: PASSWORD,
      reason: "Forget",
    });
    expect(queued("target@example.test")).toEqual([]);
    // The administrator's own mail is untouched.
    expect(queued("founder@example.test").length).toBeGreaterThan(0);
    // Nobody can have a reset link made for the erased account, whatever address they type.
    const links = () =>
      w.ctx.sqlite
        .prepare<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM auth_verification WHERE value = ?1",
        )
        .get(String(target.id))!.n;
    expect(links()).toBe(0);
    await getAuth(w.ctx).api.requestPasswordReset({
      body: { email: `erased-${target.id}@invalid`, redirectTo: "http://localhost:3000/reset" },
    });
    expect(links()).toBe(0);
  });
});

describe("what an erasure leaves of the member", () => {
  const ADDRESS = "target@example.test";
  const AGENT = "Seed-Agent/9.9";
  const ADDRESS_IP = "203.0.113.77";

  /** Identifying data in every place the member could have left it. */
  async function seeded() {
    const w = await world();
    const run = (sql: string, ...params: (string | number)[]) =>
      w.ctx.sqlite.prepare(sql).run(...params);
    const now = w.ctx.now();
    run(
      "UPDATE auth_session SET ip_address = ?1, user_agent = ?2 WHERE user_id = ?3",
      ADDRESS_IP,
      AGENT,
      w.target.id,
    );
    run("UPDATE auth_user SET image = 'https://img.example/target.png' WHERE id = ?1", w.target.id);
    run(
      "INSERT INTO undeliverable_emails (email, reason, created_at) VALUES (?1, 'rejected', ?2), ('other@example.test', 'rejected', ?2)",
      ADDRESS,
      now,
    );
    run(
      "INSERT INTO email_failures (user_id, email, template, error, permanent, created_at) VALUES (?1, ?2, 'welcome', 'boom', 1, ?3), (?4, 'fan@example.test', 'welcome', 'boom', 1, ?3)",
      w.target.id,
      ADDRESS,
      now,
      w.fan.id,
    );
    run(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?1, 'https://push.example/t', 'k', 'a', ?2, ?3), (?4, 'https://push.example/f', 'k', 'a', 'x', ?3)",
      w.target.id,
      AGENT,
      now,
      w.fan.id,
    );
    run(
      "INSERT INTO jobs (type, payload, status, run_at, attempts, created_at, updated_at) VALUES ('email.account', ?1, 'done', ?3, 1, ?3, ?3), ('email.account', ?2, 'done', ?3, 1, ?3, ?3)",
      JSON.stringify({ kind: "welcome", userId: w.target.id, email: ADDRESS }),
      JSON.stringify({ kind: "welcome", userId: w.fan.id, email: "fan@example.test" }),
      now,
    );
    // The target named the idol as referrer; the fan named the target.
    run(
      "UPDATE users SET referred_by = ?1, referred_at = ?3 WHERE id = ?2",
      w.idol.id,
      w.target.id,
      now,
    );
    run("UPDATE users SET referral_count = 1 WHERE id = ?1", w.idol.id);
    run(
      "UPDATE users SET referred_by = ?1, referred_at = ?3 WHERE id = ?2",
      w.target.id,
      w.fan.id,
      now,
    );
    run("UPDATE users SET referral_count = 1 WHERE id = ?1", w.target.id);
    // Someone else's words about them, which an erasure does not rewrite.
    await w.run("posts.create", w.fan.actor, {
      threadId: w.thread.thread.id,
      body: "Thanks @Target for the help",
    });
    return w;
  }

  /** Every table's rows, as text, that contain `needle`. */
  const tablesHolding = (w: Awaited<ReturnType<typeof seeded>>, needle: RegExp) =>
    w.ctx.sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => name)
      .filter((name) =>
        w.ctx.sqlite
          .query<Record<string, unknown>, []>(`SELECT * FROM "${name}"`)
          .all()
          .some((row) => needle.test(JSON.stringify(row))),
      );

  test("the address, the network address and the browser are in no table afterwards", async () => {
    const w = await seeded();
    expect(tablesHolding(w, /target@example\.test/i).length).toBeGreaterThan(0);
    await w.erase();
    expect(tablesHolding(w, /target@example\.test/i)).toEqual([]);
    expect(tablesHolding(w, new RegExp(ADDRESS_IP.replace(/\./g, ".")))).toEqual([]);
    expect(tablesHolding(w, /Seed-Agent/)).toEqual([]);
    expect(tablesHolding(w, /img\.example\/target/)).toEqual([]);
  });

  test("the old name remains only where other members wrote it", async () => {
    const w = await seeded();
    await w.erase();
    // Documented: a mention or a quotation of the name inside other members' posts is not
    // rewritten; the moderator log never held the name.
    const hits = tablesHolding(w, /\bTarget\b/);
    expect(hits.sort()).toEqual(["post_bodies"]);
  });

  test("removes only their own delivery records, devices and finished account emails", async () => {
    const w = await seeded();
    await w.erase();
    const count = (sql: string) => w.ctx.sqlite.query<{ n: number }, []>(sql).get()!.n;
    expect(count("SELECT count(*) AS n FROM undeliverable_emails")).toBe(1);
    expect(count("SELECT count(*) AS n FROM email_failures")).toBe(1);
    expect(count("SELECT count(*) AS n FROM push_subscriptions")).toBe(1);
    expect(count("SELECT count(*) AS n FROM jobs WHERE type = 'email.account'")).toBe(1);
  });

  test("ends their referral links and keeps the counters consistent", async () => {
    const w = await seeded();
    await w.erase();
    expect(w.user()).toMatchObject({ referred_by: null, referred_at: null, referral_count: 0 });
    // The member they named loses one; the member who named them has no referrer any more.
    expect(w.user(w.idol.id)).toMatchObject({ referral_count: 0 });
    expect(w.user(w.fan.id)).toMatchObject({ referred_by: null, referred_at: null });
    await w.erase();
    expect(w.user(w.idol.id)).toMatchObject({ referral_count: 0 });
  });

  test("a name that already is Deleted member <id>-<n> is kept, not renamed", async () => {
    const w = await world();
    const name = `Deleted member ${w.target.id}-3`;
    w.ctx.sqlite
      .prepare("UPDATE users SET username = ?1, username_key = ?2 WHERE id = ?3")
      .run(name, name.toLowerCase(), w.target.id);
    w.ctx.sqlite
      .prepare("UPDATE auth_user SET name = ?1, username = ?2, display_username = ?1 WHERE id = ?3")
      .run(name, name.toLowerCase(), w.target.id);
    await w.erase();
    expect(w.user()).toMatchObject({ username: name, username_key: name.toLowerCase() });
  });
});
