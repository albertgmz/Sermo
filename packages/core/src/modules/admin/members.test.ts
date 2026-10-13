import { afterEach, describe, expect, test } from "bun:test";
import { expectNoTableScan, tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";
import { adminSql } from "./members";

afterEach(closeAll);

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const moderator = await w.register("Moderator", 3);
  return { ...w, founder, moderator };
}

describe("users.adminList and users.adminGet", () => {
  test("lists members newest first with their email, state and whether the actor may edit them", async () => {
    const w = await world();
    const a = await w.register("Alpha");
    const b = await w.register("Beta", 5);
    const c = await w.register("Gamma");
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(c.id);
    w.ctx.sqlite.prepare("UPDATE users SET post_count = 7, credits = 40 WHERE id = ?1").run(a.id);
    const page = await w.run("users.adminList", w.founder.actor, { limit: 2 });
    expect(page.items.map((m: { card: { id: number } }) => m.card.id)).toEqual([c.id, b.id]);
    expect(page.items[0]).toMatchObject({
      email: "gamma@example.test",
      state: "banned",
      canEdit: true,
    });
    expect(page.items[1]).toMatchObject({ state: "unconfirmed" });
    const rest = await w.run("users.adminList", w.founder.actor, { cursor: page.nextCursor });
    expect(rest.items.map((m: { card: { id: number } }) => m.card.id)).toEqual([
      a.id,
      w.moderator.id,
      w.founder.id,
    ]);
    expect(rest.nextCursor).toBeNull();
    expect(rest.items[0]).toMatchObject({ postCount: 7, credits: 40, state: "valid" });
    // The founder cannot edit an equal.
    expect(rest.items[2]).toMatchObject({ canEdit: false, usernameChangedAt: null });
  });

  test("filters by state, group (primary or by hand), and username or email prefix", async () => {
    const w = await world();
    const a = await w.register("Alpha");
    const b = await w.register("Beta", 5);
    const c = await w.register("Gamma");
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(c.id);
    const ids = async (input: object) =>
      (await w.run("users.adminList", w.founder.actor, input)).items.map(
        (m: { card: { id: number } }) => m.card.id,
      );
    expect(await ids({ state: "banned" })).toEqual([c.id]);
    expect(await ids({ state: "unconfirmed" })).toEqual([b.id]);
    expect(await ids({ state: "valid" })).toEqual([a.id, w.moderator.id, w.founder.id]);
    expect(await ids({ groupId: 3 })).toEqual([w.moderator.id]);
    await w.run("users.setGroups", w.founder.actor, { userId: a.id, secondaryGroupIds: [3] });
    expect(await ids({ groupId: 3 })).toEqual([a.id, w.moderator.id]);
    expect(await ids({ groupId: 3, prefix: "mod" })).toEqual([w.moderator.id]);
    expect(await ids({ groupId: 3, state: "valid" })).toEqual([a.id, w.moderator.id]);
    expect(await ids({ prefix: "ALP" })).toEqual([a.id]);
    expect(await ids({ prefix: "gamma@" })).toEqual([c.id]);
    expect(await ids({ prefix: "nobody" })).toEqual([]);
  });

  test("a filter that rejects rows still pages through bounded batches", async () => {
    const w = await world();
    await w.register("Banned One");
    w.ctx.sqlite
      .prepare("UPDATE users SET banned_permanently = 1 WHERE username = 'Banned One'")
      .run();
    for (let i = 0; i < 60; i++) await w.register(`Filler ${i}`);
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: { items: { card: { id: number } }[]; nextCursor: string | null } = await w.run(
        "users.adminList",
        w.founder.actor,
        { state: "banned", limit: 5, cursor: cursor ?? undefined },
      );
      seen.push(...page.items.map((m) => m.card.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(1);
  });

  /** Every page of a listing, following cursors, as member ids. */
  async function walk(w: Awaited<ReturnType<typeof world>>, input: object, limit = 3) {
    const ids: number[] = [];
    let cursor: string | undefined;
    for (let calls = 0; calls < 100; calls++) {
      const page: { items: { card: { id: number } }[]; nextCursor: string | null } = await w.run(
        "users.adminList",
        w.founder.actor,
        { ...input, limit, cursor },
      );
      ids.push(...page.items.map((m) => m.card.id));
      if (!page.nextCursor) return ids;
      cursor = page.nextCursor;
    }
    throw new Error("the listing did not end");
  }

  test("a group lists its primary and its by-hand members together, newest first, each once", async () => {
    const w = await world();
    const mine: number[] = [];
    for (let i = 0; i < 6; i++) {
      await w.register(`Noise ${i}`);
      const primary = await w.register(`Primary ${i}`, 3);
      const byHand = await w.register(`ByHand ${i}`);
      await w.run("users.setGroups", w.founder.actor, {
        userId: byHand.id,
        secondaryGroupIds: [3],
      });
      mine.push(primary.id, byHand.id);
    }
    // One of both kinds at once is listed once.
    const both = await w.register("Both");
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(both.id);
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, 0)")
      .run(both.id);
    mine.push(both.id);
    const expected = [...mine, w.moderator.id].sort((a, b) => b - a);
    expect(await walk(w, { groupId: 3 })).toEqual(expected);
    expect(await walk(w, { groupId: 3 }, 1)).toEqual(expected);
    expect(await walk(w, { groupId: 3 }, 100)).toEqual(expected);
  });

  test("the unconfirmed state is read from its group, however many others there are", async () => {
    const w = await world();
    const unconfirmed: number[] = [];
    for (let i = 0; i < 5; i++) {
      await w.register(`Member ${i}`);
      unconfirmed.push((await w.register(`Waiting ${i}`, 5)).id);
    }
    expect(await walk(w, { state: "unconfirmed" }, 2)).toEqual(unconfirmed.reverse());
  });

  test("a prefix lists the usernames that start with it by username, then those matched by email alone", async () => {
    const w = await world();
    const alpha = await w.register("Alpha", undefined, "someone@example.test");
    const alan = await w.register("Alan", undefined, "alan@example.test");
    const zed = await w.register("Zed", undefined, "alzed@example.test");
    const ann = await w.register("Ann", undefined, "al.ann@example.test");
    await w.register("Bob", undefined, "bob@example.test");
    const names = async (limit: number) =>
      (await walk(w, { prefix: "AL" }, limit)).map(
        (id) => [alpha, alan, zed, ann].find((m) => m.id === id)!.username,
      );
    // Usernames first (Alan, Alpha), then email only (al.ann@ before alzed@); nobody twice.
    for (const limit of [1, 2, 3, 100])
      expect(await names(limit)).toEqual(["Alan", "Alpha", "Ann", "Zed"]);
    expect(await walk(w, { prefix: "alan" }, 1)).toEqual([alan.id]);
    // A cursor from a prefix listing means nothing to a listing without one.
    const page = await w.run("users.adminList", w.founder.actor, { prefix: "al", limit: 1 });
    await expect(
      w.run("users.adminList", w.founder.actor, { limit: 1, cursor: page.nextCursor }),
    ).rejects.toBeDefined();
  });

  test("get returns one member; a missing one is not found", async () => {
    const w = await world();
    const a = await w.register("Alpha");
    expect(await w.run("users.adminGet", w.founder.actor, { userId: a.id })).toMatchObject({
      email: "alpha@example.test",
      emailVerified: false,
      canEdit: true,
      card: { username: "Alpha" },
    });
    await expect(w.run("users.adminGet", w.founder.actor, { userId: 9999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("requires admin.members: guests, members, moderators refused; a partial administrator allowed", async () => {
    const w = await world();
    const member = await w.register("Plain");
    for (const name of ["users.adminList", "users.adminGet"]) {
      const input = name === "users.adminGet" ? { userId: member.id } : {};
      await expect(w.run(name, GUEST, input)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(w.run(name, member.actor, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(w.run(name, w.moderator.actor, input)).rejects.toBeInstanceOf(ForbiddenError);
      await w.run(name, tokenActor(w.founder), input);
    }
    const partial = await w.register("Partial");
    await w.run("permissions.set", w.founder.actor, {
      userId: partial.id,
      entries: [{ permission: "admin.members", value: "allow" }],
    });
    expect((await w.run("users.adminList", partial.actor, {})).items.length).toBeGreaterThan(0);
    const other = await w.register("Other", 4);
    // An administrator of equal rank is listed, but not editable.
    const view = await w.run("users.adminGet", w.founder.actor, { userId: other.id });
    expect(view.canEdit).toBe(false);
  });
});

describe("the list statements", () => {
  test("each reads an index, newest first", async () => {
    const w = await world();
    const sources: [keyof typeof adminSql, unknown[]][] = [
      ["all", [100, 10]],
      ["banned", [100, 10]],
      ["erased", [100, 10]],
      ["groupPrimary", [100, 10, 3]],
      ["groupSecondary", [100, 10, 3]],
      ["prefixName", ["", 10, "a", "b"]],
      ["prefixEmail", ["", 10, "a", "b"]],
    ];
    for (const [name, params] of sources) expectNoTableScan(w.ctx, adminSql[name], params);
    expectNoTableScan(w.ctx, adminSql.rows, ["[1]"]);
    expectNoTableScan(w.ctx, adminSql.secondary, [3, "[1]"]);
  });
});

describe("auth.verifyPassword", () => {
  test("accepts the member's own password and refuses another", async () => {
    const w = await world();
    expect(
      await w.run("auth.verifyPassword", w.moderator.actor, { password: "Password123!" }),
    ).toEqual({
      ok: true,
    });
    await expect(
      w.run("auth.verifyPassword", w.moderator.actor, { password: "nope-nope-nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a guest is not signed in and an API key cannot ask", async () => {
    const w = await world();
    await expect(
      w.run("auth.verifyPassword", GUEST, { password: "Password123!" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      w.run("auth.verifyPassword", tokenActor(w.founder), { password: "Password123!" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a member without a password is refused like a wrong one", async () => {
    const w = await world();
    w.ctx.sqlite.prepare("DELETE FROM auth_account WHERE user_id = ?1").run(w.moderator.id);
    await expect(
      w.run("auth.verifyPassword", w.moderator.actor, { password: "Password123!" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("administration does not cross the hierarchy", () => {
  test("a lower-ranked holder of admin.members sees no address or log of a higher-ranked member", async () => {
    const w = await world();
    await w.run("permissions.set", w.founder.actor, {
      groupId: 3,
      entries: [{ permission: "admin.members", value: "allow" }],
      actorPassword: PASSWORD,
    });
    const plain = await w.register("Plain");
    const list = await w.run("users.adminList", w.moderator.actor, {});
    const by = (id: number) => list.items.find((m: { card: { id: number } }) => m.card.id === id);
    // They still see who exists, but not the address of anyone who outranks them.
    expect(by(w.founder.id)).toMatchObject({ email: null, canEdit: false });
    expect(by(plain.id)).toMatchObject({ email: "plain@example.test", canEdit: true });
    expect(by(w.moderator.id)).toMatchObject({ email: "moderator@example.test" });
    expect(
      (await w.run("users.adminGet", w.moderator.actor, { userId: w.founder.id })).email,
    ).toBeNull();
    // Nor can they find it letter by letter through the prefix search.
    const probe = await w.run("users.adminList", w.moderator.actor, { prefix: "founder@" });
    expect(probe.items).toEqual([]);
    const own = await w.run("users.adminList", w.founder.actor, { prefix: "founder@" });
    expect(own.items).toHaveLength(1);
    // Their log is not theirs to read; a member they outrank and their own log are.
    await expect(
      w.run("users.adminLog", w.moderator.actor, { userId: w.founder.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.run("users.adminLog", w.moderator.actor, { userId: plain.id });
    await w.run("users.adminLog", w.moderator.actor, { userId: w.moderator.id });
  });
});
