import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { expectNoTableScan } from "../../testing";
import { world } from "./fixtures.test";
import {
  RECENTLY_ACTIVE_CACHE_MS,
  RECENTLY_ACTIVE_LIMIT,
  RECENTLY_ACTIVE_WINDOW_MS,
  recentlyActiveSql,
} from "./recently-active";

type Answer = {
  total: number;
  items: { card: { id: number; restricted: boolean }; lastActivityAt: string }[];
};
const MINUTE = 60_000;

describe("users.recentlyActive", () => {
  test("members seen in the last 24 hours, most recent first, the edge included", async () => {
    const w = world();
    const now = w.ctx.now();
    const a = w.user();
    const b = w.user();
    const edge = w.user();
    const past = w.user();
    w.set(a.id, { last_activity_at: now - 5 * MINUTE - 30_000 });
    w.set(b.id, { last_activity_at: now - MINUTE });
    w.set(edge.id, { last_activity_at: now - RECENTLY_ACTIVE_WINDOW_MS });
    w.set(past.id, { last_activity_at: now - RECENTLY_ACTIVE_WINDOW_MS - 1 });
    const result: Answer = await w.call("users.recentlyActive", w.memberActor, {});
    expect(result.items.map((item) => item.card.id)).toEqual([b.id, a.id, edge.id]);
    expect(result.total).toBe(3);
    // To the minute.
    const at = now - 5 * MINUTE - 30_000;
    expect(result.items[1]!.lastActivityAt).toBe(new Date(at - (at % MINUTE)).toISOString());
  });

  test("members who hide their online status, banned and erased members are left out", async () => {
    const w = world();
    const now = w.ctx.now();
    const shown = w.user();
    const hidden = w.user();
    const banned = w.user();
    const bannedUntil = w.user();
    const pastBan = w.user();
    const erased = w.user();
    for (const user of [shown, hidden, banned, bannedUntil, pastBan, erased])
      w.set(user.id, { last_activity_at: now - MINUTE });
    w.set(hidden.id, { show_online: 0 });
    w.set(banned.id, { banned_permanently: 1 });
    w.set(bannedUntil.id, { banned_until: now + MINUTE });
    w.set(pastBan.id, { banned_until: now - MINUTE });
    w.set(erased.id, { erased_at: now - MINUTE });
    // Buffered activity does not bring them back either.
    w.ctx.activity.set(hidden.id, now);
    w.ctx.activity.set(erased.id, now);
    const result: Answer = await w.call("users.recentlyActive", GUEST, {});
    expect(result.items.map((item) => item.card.id).sort()).toEqual([shown.id, pastBan.id].sort());
    expect(result.total).toBe(2);
  });

  test("activity buffered by running requests counts, as the newer of the two times", async () => {
    const w = world();
    const now = w.ctx.now();
    const stored = w.user();
    const newer = w.user();
    const fresh = w.user();
    const old = w.user();
    w.set(stored.id, { last_activity_at: now - 10 * MINUTE });
    w.set(newer.id, { last_activity_at: now - 20 * MINUTE });
    w.ctx.activity.set(newer.id, now - 2 * MINUTE);
    // Not stored yet at all, and stored only outside the window.
    w.ctx.activity.set(fresh.id, now - MINUTE);
    w.set(old.id, { last_activity_at: now - 2 * RECENTLY_ACTIVE_WINDOW_MS });
    w.ctx.activity.set(old.id, now - 3 * MINUTE);
    // An older buffered time does not move a stored one back.
    w.ctx.activity.set(stored.id, now - 30 * MINUTE);
    const result: Answer = await w.call("users.recentlyActive", w.memberActor, {});
    expect(result.items.map((item) => item.card.id)).toEqual([
      fresh.id,
      newer.id,
      old.id,
      stored.id,
    ]);
    expect(result.items[3]!.lastActivityAt).toBe(new Date(now - 10 * MINUTE).toISOString());
  });

  test("the list is kept for a minute across viewers, then read again", async () => {
    const w = world();
    const now = w.ctx.now();
    const first = w.user();
    w.set(first.id, { last_activity_at: now - MINUTE });
    expect((await w.call("users.recentlyActive", GUEST, {})).total).toBe(1);
    const later = w.user();
    w.set(later.id, { last_activity_at: now });
    w.ctx.clock.advance(RECENTLY_ACTIVE_CACHE_MS - 1);
    const kept: Answer = await w.call("users.recentlyActive", w.memberActor, {});
    expect(kept.items.map((item) => item.card.id)).toEqual([first.id]);
    w.ctx.clock.advance(1);
    const fresh: Answer = await w.call("users.recentlyActive", w.memberActor, {});
    expect(fresh.items.map((item) => item.card.id)).toEqual([later.id, first.id]);
  });

  test("hiding one's online status leaves the kept list at once", async () => {
    const w = world();
    w.set(w.member.id, { last_activity_at: w.ctx.now() });
    expect((await w.call("users.recentlyActive", GUEST, {})).total).toBe(1);
    await w.call("preferences.update", w.memberActor, { showOnline: false });
    const after: Answer = await w.call("users.recentlyActive", GUEST, {});
    expect(after).toEqual({ total: 0, items: [] });
  });

  test("a ban leaves the kept list at once, and lifting it brings the member back", async () => {
    const w = world();
    const member = w.user();
    w.set(member.id, { last_activity_at: w.ctx.now() });
    expect((await w.call("users.recentlyActive", GUEST, {})).total).toBe(1);
    const ban = await w.call("bans.create", w.adminActor, {
      userId: member.id,
      reason: "Spam",
      expiresAt: null,
    });
    expect(await w.call("users.recentlyActive", GUEST, {})).toEqual({ total: 0, items: [] });
    await w.call("bans.lift", w.adminActor, { banId: ban.id });
    expect((await w.call("users.recentlyActive", GUEST, {})).total).toBe(1);
  });

  test("a profile the viewer may not open has the minimal card; the list is the same", async () => {
    const w = world();
    const closed = w.user();
    w.set(closed.id, {
      last_activity_at: w.ctx.now(),
      profile_view_privacy: "members",
      custom_title: "Hidden",
    });
    const asGuest: Answer = await w.call("users.recentlyActive", GUEST, {});
    expect(asGuest.items.map((item) => [item.card.id, item.card.restricted])).toEqual([
      [closed.id, true],
    ]);
    const asMember: Answer = await w.call("users.recentlyActive", w.memberActor, {});
    expect(asMember.items.map((item) => [item.card.id, item.card.restricted])).toEqual([
      [closed.id, false],
    ]);
  });

  test("at most 200 members, while the total counts every listed one", async () => {
    const w = world();
    const now = w.ctx.now();
    for (let i = 0; i < RECENTLY_ACTIVE_LIMIT + 5; i++)
      w.set(w.user().id, { last_activity_at: now - i * 1000 });
    const result: Answer = await w.call("users.recentlyActive", GUEST, {});
    expect(result.items).toHaveLength(RECENTLY_ACTIVE_LIMIT);
    expect(result.total).toBe(RECENTLY_ACTIVE_LIMIT + 5);
  });

  test("guests may read it; without site.view or profile.view a viewer may not", async () => {
    const w = world();
    expect(await w.call("users.recentlyActive", GUEST, {})).toEqual({ total: 0, items: [] });
    const group = (await w.call("groups.create", w.adminActor, { title: "Blind", rank: 1 })).id;
    await w.call("permissions.set", w.adminActor, {
      groupId: group,
      entries: [{ permission: "profile.view", value: "never" }],
    });
    const blind = w.user({ groupId: group });
    const actor = { kind: "user", userId: blind.id, groupId: group, sessionId: 0 };
    await expect(w.call("users.recentlyActive", actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await w.call("permissions.set", w.adminActor, {
      groupId: 1,
      entries: [{ permission: "site.view", value: "never" }],
    });
    await expect(w.call("users.recentlyActive", GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  test("the queries read users_last_activity and the primary key", () => {
    const w = world();
    expectNoTableScan(w.ctx, recentlyActiveSql.stored, [0]);
    expectNoTableScan(w.ctx, recentlyActiveSql.buffered, ["[1,2]"]);
  });
});
