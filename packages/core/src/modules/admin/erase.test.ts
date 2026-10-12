import { afterEach, describe, expect, test } from "bun:test";
import { insertNode, tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
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
      "UPDATE users SET birthday_md = '01-02', social_x = 'handle', accent_color_id = NULL WHERE id = ?1",
    )
    .run(target.id);
  await w.signIn("target@example.test");
  const key = await w.run("auth.me", target.actor);
  void key;
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
    await expect(
      w.run("users.adminErase", w.founder.actor, {
        userId: holder.id,
        actorPassword: PASSWORD,
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
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
