import { afterEach, describe, expect, test } from "bun:test";
import { insertNode, tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ConflictError, ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { getAuth } from "../auth";
import { ipLogSql } from "../security/log";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

const ADDRESS = "leaver@example.test";
const ADDRESS_IP = "203.0.113.77";
const AGENT = "Seed-Agent/9.9";

/** A member with something of every kind that an erasure takes away, and an administrator. */
async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const leaver = await w.register("Leaver");
  const fan = await w.register("Fan");
  const idol = await w.register("Idol");
  const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
  invalidate(w.ctx, "node_tree");
  const thread = await w.run("threads.create", leaver.actor, {
    nodeId: node.id,
    title: "Their thread",
    body: "Their words",
  });
  await w.run("users.follow", fan.actor, { userId: leaver.id });
  await w.run("users.follow", leaver.actor, { userId: idol.id });
  await w.run("users.adminUpdateProfile", founder.actor, {
    userId: leaver.id,
    about: "About them",
    location: "Somewhere",
    website: "https://example.org",
    customTitle: "Title",
    signature: "Sig",
  });
  await w.signIn(ADDRESS);
  const run = (sql: string, ...params: (string | number | null)[]) =>
    w.ctx.sqlite.prepare(sql).run(...params);
  const now = w.ctx.now();
  run(
    "INSERT INTO auth_apikey (config_id, key, reference_id, created_at, updated_at, enabled) VALUES ('default', 'hashed', ?1, ?2, ?2, 1)",
    String(leaver.id),
    now,
  );
  run(
    "UPDATE auth_session SET ip_address = ?1, user_agent = ?2 WHERE user_id = ?3",
    ADDRESS_IP,
    AGENT,
    leaver.id,
  );
  run(
    "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?1, 'https://push.example/l', 'k', 'a', ?2, ?3), (?4, 'https://push.example/f', 'k', 'a', 'x', ?3)",
    leaver.id,
    AGENT,
    now,
    fan.id,
  );
  run(
    "INSERT INTO consent_records (user_id, categories, policy_version, decided_at) VALUES (?1, '[]', 1, ?3), (?2, '[]', 1, ?3)",
    leaver.id,
    fan.id,
    now,
  );
  run(
    "INSERT INTO terms_acceptances (user_id, kind, version, ip, accepted_at) VALUES (?1, 'terms', 1, ?3, ?4), (?2, 'terms', 1, '198.51.100.5', ?4)",
    leaver.id,
    fan.id,
    ADDRESS_IP,
    now,
  );
  run(
    ipLogSql.insert,
    leaver.id,
    ADDRESS_IP,
    "203.0.113.0/24",
    "login",
    null,
    null,
    "Firefox",
    "Linux",
    "desktop",
    null,
    null,
    0,
    null,
    null,
    null,
    now,
  );
  // The leaver named the idol as referrer; the fan named the leaver.
  run("UPDATE users SET referred_by = ?1, referred_at = ?3 WHERE id = ?2", idol.id, leaver.id, now);
  run("UPDATE users SET referral_count = 1 WHERE id = ?1", idol.id);
  run("UPDATE users SET referred_by = ?1, referred_at = ?3 WHERE id = ?2", leaver.id, fan.id, now);
  run("UPDATE users SET referral_count = 1 WHERE id = ?1", leaver.id);

  const deleteAccount = (input: object = {}, as: { actor: object } = leaver) =>
    w.run("users.deleteOwnAccount", as.actor, { password: PASSWORD, ...input });
  const user = (id = leaver.id) =>
    w.ctx.sqlite
      .prepare<Record<string, unknown>, [number]>("SELECT * FROM users WHERE id = ?1")
      .get(id)!;
  const count = (sql: string, ...params: (number | string)[]) =>
    w.ctx.sqlite.prepare<{ n: number }, (number | string)[]>(sql).get(...params)!.n;
  const tablesHolding = (needle: RegExp) =>
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
  return { ...w, founder, leaver, fan, idol, thread, deleteAccount, user, count, tablesHolding };
}

type World = Awaited<ReturnType<typeof world>>;

/** Nothing of the account was taken. */
function expectUntouched(w: World) {
  expect(w.user()).toMatchObject({
    username: "Leaver",
    about: "About them",
    banned_permanently: 0,
    erased_at: null,
  });
  const own = (table: string) =>
    w.count(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`, w.leaver.id);
  expect(own("auth_account")).toBe(1);
  expect(own("push_subscriptions")).toBe(1);
  expect(own("bans")).toBe(0);
  expect(w.logOf(w.leaver.id).filter((entry) => entry.action === "member.erase")).toEqual([]);
}

describe("users.deleteOwnAccount", () => {
  test("closes the account as an administrator's erasure does, and the writing stays", async () => {
    const w = await world();
    const name = `Deleted member ${w.leaver.id}`;
    expect(await w.deleteAccount()).toEqual({ ok: true });

    await expect(w.signIn(ADDRESS)).rejects.toBeDefined();
    await expect(w.signIn(`erased-${w.leaver.id}@invalid`)).rejects.toBeDefined();
    for (const username of ["Leaver", name])
      await expect(
        getAuth(w.ctx).api.signInUsername({ body: { username, password: PASSWORD } }),
      ).rejects.toBeDefined();
    expect(w.sessions(w.leaver.id)).toBe(0);
    expect(
      w.count("SELECT count(*) AS n FROM auth_apikey WHERE reference_id = ?1", String(w.leaver.id)),
    ).toBe(0);
    expect(w.count("SELECT count(*) AS n FROM auth_account WHERE user_id = ?1", w.leaver.id)).toBe(
      0,
    );
    expect(
      w.ctx.sqlite
        .prepare<Record<string, unknown>, [number]>(
          "SELECT email, email_verified FROM auth_user WHERE id = ?1",
        )
        .get(w.leaver.id),
    ).toEqual({ email: `erased-${w.leaver.id}@invalid`, email_verified: 0 });
    expect(w.user()).toMatchObject({
      username: name,
      about: "",
      location: "",
      website: "",
      custom_title: null,
      signature_source: null,
      banned_permanently: 1,
      follower_count: 0,
      following_count: 0,
      referred_by: null,
      referred_at: null,
      referral_count: 0,
    });
    expect(w.user().erased_at).not.toBeNull();
    // What they wrote stays, under the new name.
    const posted = await w.run("threads.get", GUEST, { threadId: w.thread.thread.id });
    expect((posted.thread ?? posted).author.username).toBe(name);
    // Their devices, consent, acceptances and addresses go; other members' stay.
    expect(w.count("SELECT count(*) AS n FROM push_subscriptions")).toBe(1);
    expect(w.count("SELECT count(*) AS n FROM consent_records")).toBe(1);
    expect(w.count("SELECT count(*) AS n FROM terms_acceptances")).toBe(1);
    expect(w.count("SELECT count(*) AS n FROM ip_log WHERE user_id = ?1", w.leaver.id)).toBe(0);
    expect(w.count("SELECT count(*) AS n FROM user_follows")).toBe(0);
    expect(w.user(w.idol.id)).toMatchObject({ referral_count: 0, follower_count: 0 });
    expect(w.user(w.fan.id)).toMatchObject({ referred_by: null, following_count: 0 });
    expect(w.tablesHolding(/leaver@example\.test/i)).toEqual([]);
    expect(w.tablesHolding(/203\.0\.113\.77/)).toEqual([]);
    expect(w.tablesHolding(/Seed-Agent/)).toEqual([]);
  });

  test("bans for good in the ban register, so the account stays closed, and logs once with the member as actor", async () => {
    const w = await world();
    await w.deleteAccount();
    const bans = await w.run("bans.list", w.founder.actor, { userId: w.leaver.id });
    expect(bans.items).toHaveLength(1);
    expect(bans.items[0]).toMatchObject({
      reason: "Deleted by the member",
      expiresAt: null,
      state: "active",
    });
    await expect(
      w.run("bans.lift", w.founder.actor, { banId: bans.items[0].id, reason: "Mistake" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const entries = w.ctx.sqlite
      .prepare<{ actor_id: number; action: string; reason: string }, [number]>(
        "SELECT actor_id, action, reason FROM moderator_log WHERE target_type = 'user' AND target_id = ?1 AND action = 'member.erase'",
      )
      .all(w.leaver.id);
    expect(entries).toEqual([
      { actor_id: w.leaver.id, action: "member.erase", reason: "Deleted by the member" },
    ]);
    const view = await w.run("users.adminGet", w.founder.actor, { userId: w.leaver.id });
    expect(view).toMatchObject({ state: "erased" });
  });

  test("the same actor cannot delete again", async () => {
    const w = await world();
    await w.deleteAccount();
    await expect(w.deleteAccount()).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.logOf(w.leaver.id).filter((entry) => entry.action === "member.erase")).toHaveLength(1);
  });

  test("a wrong password is refused and nothing is changed", async () => {
    const w = await world();
    await expect(w.deleteAccount({ password: "wrong-wrong-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expectUntouched(w);
    expect(await w.signIn(ADDRESS)).toBeDefined();
  });

  test("an API key is refused, with the right password", async () => {
    const w = await world();
    const refused = w.deleteAccount({}, { actor: tokenActor(w.leaver) });
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    await expect(refused).rejects.toThrow(/API key/);
    expectUntouched(w);
  });

  test("a guest is told to sign in, and a member who has not confirmed their address may leave", async () => {
    const w = await world();
    const unconfirmed = await w.register("Fresh", 5);
    await expect(w.deleteAccount({}, { actor: GUEST })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(await w.deleteAccount({}, unconfirmed)).toEqual({ ok: true });
    expect(w.user(unconfirmed.id).erased_at).not.toBeNull();
  });

  test("an administrator can turn it off for a group and back on", async () => {
    const w = await world();
    const holds = async () =>
      (await w.run("auth.me", w.leaver.actor, {})).resolvedPermissions["profile.deleteAccount"];
    expect(await holds()).toBe(true);
    await w.run("permissions.set", w.founder.actor, {
      groupId: 2,
      entries: [{ permission: "profile.deleteAccount", value: "never" }],
    });
    // Denied before the password is looked at: a wrong one is not counted as a guess.
    await expect(w.deleteAccount({ password: "wrong-wrong-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(w.count("SELECT count(*) AS n FROM admin_password_failures")).toBe(0);
    expectUntouched(w);
    expect(await holds()).toBe(false);
    await w.run("permissions.set", w.founder.actor, {
      groupId: 2,
      entries: [{ permission: "profile.deleteAccount", value: "allow" }],
    });
    expect(await holds()).toBe(true);
    expect(await w.deleteAccount()).toEqual({ ok: true });
  });

  test("a super admin cannot, even with another super admin", async () => {
    const w = await world();
    const other = await w.register("Other", 4);
    for (const id of [w.leaver.id, other.id])
      w.ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(id);
    await expect(w.deleteAccount()).rejects.toBeInstanceOf(ConflictError);
    await expect(w.deleteAccount()).rejects.toThrow(/super admin/i);
    expectUntouched(w);
    expect(w.user()).toMatchObject({ is_super_admin: 1 });
  });

  test("the last administrator cannot, and the refusal leaves the account whole", async () => {
    const w = await world();
    await expect(w.deleteAccount({}, w.founder)).rejects.toThrow(/last administrator/i);
    expect(w.user(w.founder.id)).toMatchObject({
      username: "Founder",
      banned_permanently: 0,
      erased_at: null,
    });
    expect(w.count("SELECT count(*) AS n FROM auth_account WHERE user_id = ?1", w.founder.id)).toBe(
      1,
    );
    expect(w.logOf(w.founder.id)).toEqual([]);
    expect(await w.signIn("founder@example.test")).toBeDefined();
    // With another administrator, an administrator may leave.
    await w.register("Second", 4);
    expect(await w.deleteAccount({}, w.founder)).toEqual({ ok: true });
    expect(w.user(w.founder.id)).toMatchObject({ banned_permanently: 1 });
  });
});

describe("users.deleteOwnAccount and a stale actor", () => {
  test("a member whose permission was removed in another process deletes nothing", async () => {
    const w = await world();
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, w.leaver.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        { groupId: 2, entries: [{ permission: "profile.deleteAccount", value: "never" }] },
      );
      await expect(
        execute(here, getOperation("users.deleteOwnAccount"), stale, { password: PASSWORD }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare<{ username: string; banned_permanently: number }, [number]>(
            "SELECT username, banned_permanently FROM users WHERE id = ?1",
          )
          .get(w.leaver.id),
      ).toEqual({ username: "Leaver", banned_permanently: 0 });
    } finally {
      database.close();
    }
  });
});
