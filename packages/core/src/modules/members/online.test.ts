import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { CLIENT_IP_HEADER, invalidate } from "../../context";
import { execute } from "../../operation";
import { expectNoTableScan, insertNode, userActor } from "../../testing";
import { resolveActor } from "../auth";
import { threadsCreateOp } from "../forums";
import { world } from "./fixtures.test";
import { ONLINE_CACHE_MS, ONLINE_NOW_MS, onlineSql } from "./online";
import {
  FLUSH_CHUNK,
  flushVisits,
  MAX_PENDING_GUESTS,
  MAX_STORED_GUESTS,
  noteVisit,
  onlineVisitSql,
  PLACE_HEADER,
  parsePlace,
  pendingVisits,
  pruneOnlineVisitors,
  VISIT_KEEP_MS,
} from "./online-track";

const MINUTE = 60_000;
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

type Visitor = {
  type: "member" | "guest" | "robot";
  card: { id: number; username: string } | null;
  robot: { name: string | null; url: string | null } | null;
  ip: string | null;
  activity: {
    at: string;
    hidden: boolean;
    place: { kind: string; target: { id: number; title: string } | null } | null;
  };
};
type Listing = { items: Visitor[]; page: number; perPage: number; total: number };
type Activities = { items: { userId: number; activity: Visitor["activity"] }[] };

function setup() {
  const w = world();
  const forum = insertNode(w.ctx, { title: "Open forum" });
  const hidden = insertNode(w.ctx, { title: "Staff room" });
  invalidate(w.ctx, "node_tree");
  // Guests and members may not open the staff room; administrators still may.
  for (const group of [1, 2])
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'node.view'), ?1, ?2, 0, -1)",
      )
      .run(hidden.id, group);
  w.ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
  const thread = async (nodeId: number, title: string) =>
    (await execute(w.ctx, threadsCreateOp, w.adminActor, { nodeId, title, body: "Body" })).thread
      .id as number;
  // A page view of a guest, as the HTTP adapter hands it over.
  const guestView = (place: string, ip = "203.0.113.7", userAgent = FIREFOX) =>
    resolveActor(
      w.ctx,
      new Headers({ [PLACE_HEADER]: place, [CLIENT_IP_HEADER]: ip, "user-agent": userAgent }),
    );
  const memberView = (userId: number, place: string) => {
    w.ctx.activity.set(userId, w.ctx.now());
    noteVisit(w.ctx, { userId, place });
  };
  const list = (actor: object, input: object = {}): Promise<Listing> =>
    w.call("online.list", actor, input);
  const activity = (actor: object, userIds: number[]): Promise<Activities> =>
    w.call("users.activity", actor, { userIds });
  // Past the kept list, so the next read sees what was written since.
  const later = (ms = ONLINE_CACHE_MS) => w.ctx.clock.advance(ms);
  return { ...w, forum, hidden, thread, guestView, memberView, list, activity, later };
}

const rows = (ctx: ReturnType<typeof setup>["ctx"]) =>
  ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM online_visitors").get()!.n;

describe("page views are noted per request and written by the flush", () => {
  test("a guest's page view writes nothing until the flush, then one row per visitor", async () => {
    const s = setup();
    await s.guestView("forumList");
    await s.guestView(`forum:${s.forum.id}`);
    // The request path wrote nothing.
    expect(rows(s.ctx)).toBe(0);
    expect(await flushVisits(s.ctx)).toBe(1);
    expect(rows(s.ctx)).toBe(1);
    const row = s.ctx.sqlite
      .prepare<{ visitor_key: string; place_kind: string; place_id: number; ip: string }, []>(
        "SELECT visitor_key, place_kind, place_id, ip FROM online_visitors",
      )
      .get()!;
    expect(row).toMatchObject({ place_kind: "forum", place_id: s.forum.id, ip: "203.0.113.7" });
    // The key is a hash: the address is not in it.
    expect(row.visitor_key).toMatch(/^g:[0-9a-f]{32}$/);
    // Another browser on the same address is another visitor.
    await s.guestView("forumList", "203.0.113.7", `${FIREFOX} Other`);
    await flushVisits(s.ctx);
    expect(rows(s.ctx)).toBe(2);
  });

  test("a request that names no page is not noted", async () => {
    const s = setup();
    await resolveActor(s.ctx, new Headers({ [CLIENT_IP_HEADER]: "203.0.113.7" }));
    expect(await flushVisits(s.ctx)).toBe(0);
  });

  test("the place header names a kind and an id, never more; anything else is a page", () => {
    expect(parsePlace("thread:12")).toEqual({ kind: "thread", id: 12 });
    expect(parsePlace("members")).toEqual({ kind: "members", id: null });
    for (const value of ["thread", "thread:0", "thread:12-title", "/threads/12", "forum:1?x", ""])
      expect(parsePlace(value)).toEqual({ kind: "page", id: null });
  });

  test("a flood of new guests keeps the notes and the table bounded, and members are still noted", async () => {
    const s = setup();
    const member = s.user();
    const guests = () =>
      s.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM online_visitors WHERE user_id IS NULL",
        )
        .get()!.n;
    let next = 0;
    const flood = () => {
      for (let i = 0; i < MAX_PENDING_GUESTS + 500; i++)
        noteVisit(s.ctx, {
          userId: null,
          ip: "198.51.100.1",
          userAgent: `${FIREFOX} ${next++}`,
          place: "forumList",
        });
    };
    flood();
    expect(pendingVisits(s.ctx).size).toBe(MAX_PENDING_GUESTS);
    // A member's page view is still noted with the guests' share full.
    s.memberView(member.id, `forum:${s.forum.id}`);
    expect(pendingVisits(s.ctx).has(`u:${member.id}`)).toBe(true);
    await flushVisits(s.ctx);
    for (let round = 0; round < 3; round++) {
      flood();
      await flushVisits(s.ctx);
    }
    expect(guests()).toBe(MAX_STORED_GUESTS);
    // A guest already stored is still moved on; the member's row is there.
    s.ctx.clock.advance(MINUTE);
    noteVisit(s.ctx, {
      userId: null,
      ip: "198.51.100.1",
      userAgent: `${FIREFOX} 0`,
      place: "search",
    });
    await flushVisits(s.ctx);
    expect(guests()).toBe(MAX_STORED_GUESTS);
    expect(
      s.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM online_visitors WHERE place_kind = 'search'",
        )
        .get()!.n,
    ).toBe(1);
    expect(
      s.ctx.sqlite
        .prepare<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM online_visitors WHERE visitor_key = ?1",
        )
        .get(`u:${member.id}`)!.n,
    ).toBe(1);
  });

  test("the flush writes in chunks: a failed chunk keeps the ones before and notes the rest again", async () => {
    const s = setup();
    const count = FLUSH_CHUNK * 2 + 200;
    for (let i = 0; i < count; i++)
      noteVisit(s.ctx, {
        userId: null,
        ip: "198.51.100.1",
        userAgent: `${FIREFOX} ${i}`,
        place: "forumList",
      });
    // A row of the second chunk cannot be written.
    const failing = [...pendingVisits(s.ctx).keys()][FLUSH_CHUNK + FLUSH_CHUNK / 2]!;
    s.ctx.sqlite.run(
      `CREATE TEMP TRIGGER refuse BEFORE INSERT ON online_visitors WHEN NEW.visitor_key = '${failing}' BEGIN SELECT RAISE(ABORT, 'refused'); END`,
    );
    await expect(flushVisits(s.ctx)).rejects.toThrow("refused");
    expect(rows(s.ctx)).toBe(FLUSH_CHUNK);
    expect(pendingVisits(s.ctx).size).toBe(count - FLUSH_CHUNK);
    s.ctx.sqlite.run("DROP TRIGGER refuse");
    expect(await flushVisits(s.ctx)).toBe(count - FLUSH_CHUNK);
    expect(rows(s.ctx)).toBe(count);
  });

  test("the flush yields to the event loop between chunks, so a request runs before it ends", async () => {
    const s = setup();
    const count = FLUSH_CHUNK * 3;
    for (let i = 0; i < count; i++)
      noteVisit(s.ctx, {
        userId: null,
        ip: "198.51.100.1",
        userAgent: `${FIREFOX} ${i}`,
        place: "forumList",
      });
    const flushing = flushVisits(s.ctx);
    let seen = -1;
    setImmediate(() => {
      seen = rows(s.ctx);
    });
    expect(await flushing).toBe(count);
    expect(seen).toBeGreaterThanOrEqual(FLUSH_CHUNK);
    expect(seen).toBeLessThan(count);
    expect(rows(s.ctx)).toBe(count);
  });

  test("a flush called while another is in flight (the shutdown's) waits for it, then writes what is left", async () => {
    const s = setup();
    const count = FLUSH_CHUNK * 3;
    const guest = (i: number) =>
      noteVisit(s.ctx, {
        userId: null,
        ip: "198.51.100.1",
        userAgent: `${FIREFOX} ${i}`,
        place: "forumList",
      });
    for (let i = 0; i < count; i++) guest(i);
    const scheduled = flushVisits(s.ctx);
    guest(count);
    const shutdown = flushVisits(s.ctx);
    expect(await shutdown).toBe(1);
    expect(rows(s.ctx)).toBe(count + 1);
    expect(await scheduled).toBe(count);
    expect(pendingVisits(s.ctx).size).toBe(0);
  });

  test("rows unseen for an hour are pruned, newer ones kept", async () => {
    const s = setup();
    await s.guestView("forumList", "203.0.113.1");
    await flushVisits(s.ctx);
    s.ctx.clock.advance(VISIT_KEEP_MS - MINUTE);
    await s.guestView("forumList", "203.0.113.2");
    await flushVisits(s.ctx);
    s.ctx.clock.advance(2 * MINUTE);
    expect(await pruneOnlineVisitors(s.ctx)).toBe(1);
    expect(rows(s.ctx)).toBe(1);
  });
});

describe("online.list", () => {
  test("a guest is listed as a guest with the page they view", async () => {
    const s = setup();
    await s.guestView("forumList");
    const answer = await s.list(GUEST);
    expect(answer.total).toBe(1);
    expect(answer.items[0]).toMatchObject({
      type: "guest",
      card: null,
      robot: null,
      ip: null,
      activity: { hidden: false, place: { kind: "forumList", target: null } },
    });
  });

  test("a robot is told apart by its user agent and named as XenForo names it", async () => {
    const s = setup();
    await s.guestView("forumList", "66.249.66.1", GOOGLEBOT);
    await s.guestView("forumList", "203.0.113.7");
    const all = await s.list(GUEST);
    expect(all.items.map((item) => item.type).sort()).toEqual(["guest", "robot"]);
    const robots = await s.list(GUEST, { type: "robot" });
    expect(robots.items).toHaveLength(1);
    expect(robots.items[0]!.robot).toEqual({
      name: "Google",
      url: "https://support.google.com/webmasters/answer/182072",
    });
    expect((await s.list(GUEST, { type: "guest" })).items[0]!.robot).toBeNull();
    expect(await s.call("online.counts", GUEST, {})).toEqual({ guests: 1, robots: 1 });
  });

  test("a place older than an hour is not shown: only the time", async () => {
    const s = setup();
    const visitor = s.user();
    s.memberView(visitor.id, `forum:${s.forum.id}`);
    await flushVisits(s.ctx);
    s.ctx.clock.advance(VISIT_KEEP_MS + MINUTE);
    // Still within the day: listed with the time alone.
    s.ctx.sqlite
      .prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2")
      .run(s.ctx.now() - VISIT_KEEP_MS - MINUTE, visitor.id);
    s.ctx.activity.clear();
    const [item] = (await s.list(s.memberActor)).items;
    expect(item!.card!.id).toBe(visitor.id);
    expect(item!.activity.place).toBeNull();
    const at = s.ctx.now() - VISIT_KEEP_MS - MINUTE;
    expect(item!.activity.at).toBe(new Date(at - (at % MINUTE)).toISOString());
    const [line] = (await s.activity(s.memberActor, [visitor.id])).items;
    expect(line!.activity).toEqual({ at: item!.activity.at, hidden: false, place: null });
  });

  test("a thread the viewer may not see is not named: it is a page", async () => {
    const s = setup();
    const secret = await s.thread(s.hidden.id, "Secret plans");
    const open = await s.thread(s.forum.id, "Open talk");
    const reader = s.user();
    const other = s.user();
    s.memberView(reader.id, `thread:${secret}`);
    s.memberView(other.id, `thread:${open}`);
    const placeOf = (answer: Listing, id: number) =>
      answer.items.find((item) => item.card?.id === id)!.activity.place;
    const forMember = await s.list(s.memberActor);
    expect(placeOf(forMember, reader.id)).toEqual({ kind: "page", target: null });
    expect(placeOf(forMember, other.id)).toEqual({
      kind: "thread",
      target: { id: open, title: "Open talk" },
    });
    expect(placeOf(await s.list(s.adminActor), reader.id)).toEqual({
      kind: "thread",
      target: { id: secret, title: "Secret plans" },
    });
    // A guest viewing it is not named to a guest either.
    await s.guestView(`thread:${secret}`);
    s.later();
    const guest = (await s.list(GUEST, { type: "guest" })).items[0]!;
    expect(guest.activity.place).toEqual({ kind: "page", target: null });
    // The same rule on the activity line.
    const [line] = (await s.activity(s.memberActor, [reader.id])).items;
    expect(line!.activity.place).toEqual({ kind: "page", target: null });
  });

  test("a forum and a member profile are named with their title and name", async () => {
    const s = setup();
    const a = s.user();
    const b = s.user();
    s.memberView(a.id, `forum:${s.forum.id}`);
    s.memberView(b.id, `member:${a.id}`);
    const answer = await s.list(GUEST);
    const placeOf = (id: number) => answer.items.find((item) => item.card?.id === id)!.activity;
    expect(placeOf(a.id).place).toEqual({
      kind: "forum",
      target: { id: s.forum.id, title: "Open forum" },
    });
    expect(placeOf(b.id).place).toEqual({
      kind: "member",
      target: { id: a.id, title: a.username },
    });
  });

  test("a member who hides their online status is left out, and shown marked to staff", async () => {
    const s = setup();
    const shy = s.user();
    s.set(shy.id, { show_online: 0 });
    s.memberView(shy.id, `forum:${s.forum.id}`);
    expect((await s.list(s.memberActor)).items.map((item) => item.card?.id)).not.toContain(shy.id);
    expect((await s.activity(s.memberActor, [shy.id])).items).toEqual([]);
    expect((await s.activity(GUEST, [shy.id])).items).toEqual([]);
    const staff = (await s.list(s.moderatorActor)).items.find((item) => item.card?.id === shy.id);
    expect(staff!.activity).toMatchObject({ hidden: true, place: { kind: "forum" } });
    const [line] = (await s.activity(s.moderatorActor, [shy.id])).items;
    expect(line!.activity).toMatchObject({ hidden: true, place: { kind: "forum" } });
    // They still see themselves.
    const own = (await s.activity(userActor(shy), [shy.id])).items[0]!;
    expect(own.activity.hidden).toBe(true);
  });

  test("a guest's address is shown only to holders of member.viewIps", async () => {
    const s = setup();
    await s.guestView("forumList", "198.51.100.4");
    expect((await s.list(s.adminActor)).items[0]!.ip).toBe("198.51.100.4");
    expect((await s.list(s.moderatorActor)).items[0]!.ip).toBeNull();
    expect((await s.list(s.memberActor)).items[0]!.ip).toBeNull();
    expect((await s.list(GUEST)).items[0]!.ip).toBeNull();
  });

  test("most recent first, 25 to a page, with the total for the viewer", async () => {
    const s = setup();
    for (let i = 0; i < 30; i++) {
      await s.guestView("forumList", `203.0.113.${i + 1}`);
      s.ctx.clock.advance(1000);
    }
    const first = await s.list(GUEST);
    expect(first).toMatchObject({ page: 1, perPage: 25, total: 30 });
    expect(first.items).toHaveLength(25);
    const second = await s.list(GUEST, { page: 2 });
    expect(second.items).toHaveLength(5);
    const times = [...first.items, ...second.items].map((item) => item.activity.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect((await s.list(GUEST, { page: 3 })).items).toEqual([]);
  });

  test("the counts take the last 15 minutes only", async () => {
    const s = setup();
    await s.guestView("forumList", "203.0.113.1");
    s.ctx.clock.advance(ONLINE_NOW_MS + MINUTE);
    await s.guestView("forumList", "203.0.113.2");
    expect(await s.call("online.counts", GUEST, {})).toEqual({ guests: 1, robots: 0 });
  });

  test("the hot reads use their indexes", () => {
    const s = setup();
    expectNoTableScan(s.ctx, onlineSql.memberVisits, [0]);
    expectNoTableScan(s.ctx, onlineSql.guestVisits, [0, 1]);
    expectNoTableScan(s.ctx, onlineVisitSql.guestCount, []);
    expectNoTableScan(s.ctx, onlineVisitSql.guestTouch, ["g:x", null, "page", null, null, 0]);
    expectNoTableScan(s.ctx, onlineSql.visitorsByKey, ["[]"]);
    expectNoTableScan(s.ctx, onlineSql.members, [0]);
    expectNoTableScan(s.ctx, onlineSql.membersById, ["[]"]);
    expectNoTableScan(s.ctx, onlineSql.threads, ["[]"]);
    expectNoTableScan(s.ctx, onlineVisitSql.prune, [0, 1]);
  });
});
