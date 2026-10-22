import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { GROUP_IDS } from "../../db/schema";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { expectNoTableScan, insertNode } from "../../testing";
import { world } from "./fixtures.test";
import { SITE_STATS_CACHE_MS, siteStatsSql } from "./site-stats";

type Answer = {
  threads: number;
  posts: number;
  members: number;
  latestMember: { id: number; restricted: boolean } | null;
};
const MINUTE = 60_000;

function forum(w: ReturnType<typeof world>, threads: number, posts: number) {
  const node = insertNode(w.ctx, {});
  w.ctx.sqlite
    .prepare("UPDATE nodes SET thread_count = ?2, post_count = ?3 WHERE id = ?1")
    .run(node.id, threads, posts);
  invalidate(w.ctx, "node_tree");
  return node;
}

describe("site.stats", () => {
  test("threads and messages of the forums guests can open, members and the newest member", async () => {
    const w = world();
    forum(w, 3, 10);
    forum(w, 2, 5);
    const newest = w.user();
    const result: Answer = await w.call("site.stats", GUEST, {});
    expect(result.threads).toBe(5);
    expect(result.posts).toBe(15);
    // admin, moderator, member and the new one.
    expect(result.members).toBe(4);
    expect(result.latestMember?.id).toBe(newest.id);
    const asMember: Answer = await w.call("site.stats", w.memberActor, {});
    expect(asMember).toEqual(result);
  });

  test("a forum guests cannot open is not counted", async () => {
    const w = world();
    forum(w, 1, 1);
    const hidden = forum(w, 7, 70);
    await w.call("permissions.set", w.adminActor, {
      groupId: GROUP_IDS.guest,
      nodeId: hidden.id,
      entries: [{ permission: "node.view", value: "no" }],
    });
    for (const actor of [GUEST, w.adminActor]) {
      const result: Answer = await w.call("site.stats", actor, {});
      expect([result.threads, result.posts]).toEqual([1, 1]);
    }
  });

  test("banned, erased, unconfirmed and waiting accounts are not members", async () => {
    const w = world();
    const before: Answer = await w.call("site.stats", GUEST, {});
    const banned = w.user();
    const bannedUntil = w.user();
    const pastBan = w.user();
    const erased = w.user();
    const unconfirmed = w.user({ groupId: GROUP_IDS.unconfirmed });
    const waiting = w.user();
    const counted = w.user();
    w.set(banned.id, { banned_permanently: 1 });
    w.set(bannedUntil.id, { banned_until: w.ctx.now() + 60 * MINUTE });
    w.set(pastBan.id, { banned_until: w.ctx.now() - MINUTE });
    w.set(erased.id, { erased_at: w.ctx.now() });
    w.set(waiting.id, { signup_review: "held" });
    w.ctx.clock.advance(SITE_STATS_CACHE_MS);
    const after: Answer = await w.call("site.stats", w.memberActor, {});
    expect(after.members - before.members).toBe(2);
    // The newest account that counts: the ones after it are banned, erased, waiting or unconfirmed.
    expect(after.latestMember?.id).toBe(counted.id);
    const last = w.user();
    w.set(last.id, { banned_permanently: 1 });
    w.ctx.clock.advance(SITE_STATS_CACHE_MS);
    expect((await w.call("site.stats", w.memberActor, {})).latestMember?.id).toBe(counted.id);
    expect(unconfirmed.id).toBeLessThan(counted.id);
  });

  test("the totals are kept for ten minutes and counted again after", async () => {
    const w = world();
    const node = forum(w, 1, 1);
    expect((await w.call("site.stats", GUEST, {})).threads).toBe(1);
    w.ctx.sqlite.prepare("UPDATE nodes SET thread_count = 9 WHERE id = ?1").run(node.id);
    w.ctx.clock.advance(SITE_STATS_CACHE_MS - 1);
    expect((await w.call("site.stats", GUEST, {})).threads).toBe(1);
    w.ctx.clock.advance(1);
    expect((await w.call("site.stats", GUEST, {})).threads).toBe(9);
  });

  test("the newest member is the minimal card when the viewer may not open the profile", async () => {
    const w = world();
    const newest = w.user();
    w.set(newest.id, { profile_view_privacy: "nobody" });
    const result: Answer = await w.call("site.stats", w.memberActor, {});
    expect(result.latestMember).toMatchObject({ id: newest.id, restricted: true });
  });

  test("the newest member is still named when the newest accounts are all banned", async () => {
    const w = world();
    const counted = w.user();
    for (let i = 0; i < 25; i++) w.set(w.user().id, { banned_permanently: 1 });
    const result: Answer = await w.call("site.stats", w.memberActor, {});
    expect(result.latestMember?.id).toBe(counted.id);
  });

  test("a ban or an erasure drops the kept totals at once, and lifting the ban brings them back", async () => {
    const w = world();
    const newest = w.user();
    const before: Answer = await w.call("site.stats", w.memberActor, {});
    expect(before.latestMember?.id).toBe(newest.id);
    const ban = await w.call("bans.create", w.adminActor, {
      userId: newest.id,
      reason: "Spam",
      expiresAt: null,
    });
    const banned: Answer = await w.call("site.stats", w.memberActor, {});
    expect(banned.members).toBe(before.members - 1);
    expect(banned.latestMember?.id).not.toBe(newest.id);
    await w.call("bans.lift", w.adminActor, { banId: ban.id });
    expect((await w.call("site.stats", w.memberActor, {})).latestMember?.id).toBe(newest.id);
  });

  test("a viewer who may not list members is given the totals without the newest member", async () => {
    const w = world();
    w.user();
    const group = (await w.call("groups.create", w.adminActor, { title: "Blind", rank: 1 })).id;
    await w.call("permissions.set", w.adminActor, {
      groupId: group,
      entries: [
        { permission: "site.view", value: "allow" },
        { permission: "profile.view", value: "allow" },
        { permission: "member.viewList", value: "never" },
      ],
    });
    const blind = w.user({ groupId: group });
    const actor = { kind: "user", userId: blind.id, groupId: group, sessionId: 0 };
    const result: Answer = await w.call("site.stats", actor, {});
    expect(result.latestMember).toBeNull();
    expect(result.members).toBe(5);
  });

  test("the site must be open to the viewer", async () => {
    const w = world();
    await w.call("permissions.set", w.adminActor, {
      groupId: GROUP_IDS.guest,
      entries: [{ permission: "site.view", value: "never" }],
    });
    await expect(w.call("site.stats", GUEST, {})).rejects.toBeInstanceOf(UnauthenticatedError);
    await w.call("permissions.set", w.adminActor, {
      groupId: GROUP_IDS.member,
      entries: [{ permission: "site.view", value: "never" }],
    });
    await expect(w.call("site.stats", w.memberActor, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("the newest accounts are read by walking the primary key backwards", () => {
    const w = world();
    expectNoTableScan(w.ctx, siteStatsSql.newest, [0], { allow: ["users"] });
    const plan = w.ctx.sqlite
      .prepare<{ detail: string }, [number]>(`EXPLAIN QUERY PLAN ${siteStatsSql.newest}`)
      .all(0);
    expect(plan.map((row) => row.detail)).toEqual(["SCAN u"]);
  });
});
