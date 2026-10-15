import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth, resolveActor } from "../auth";
import { parseAddress, parseNetwork } from "./address";
import {
  clearDeviceCache,
  DEVICE_CACHE_SIZE,
  deviceOf,
  deviceParseCount,
  isBotAgent,
  NO_DEVICE,
} from "./device";
import { securitySql } from "./index";
import { ipLogSql } from "./log";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  closeAll();
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("addresses", () => {
  test("an IPv4-mapped IPv6 address is the IPv4 address it carries", () => {
    expect(parseAddress("::ffff:203.0.113.7")).toEqual({ ip: "203.0.113.7", net: "203.0.113.7" });
    expect(parseAddress("203.0.113.7")).toEqual({ ip: "203.0.113.7", net: "203.0.113.7" });
  });

  test("IPv6 is written short and grouped by its /64", () => {
    expect(parseAddress("2001:0DB8:0:1:0:0:0:5")).toEqual({
      ip: "2001:db8:0:1::5",
      net: "2001:db8:0:1::/64",
    });
    expect(parseAddress("2001:db8:0:1:aaaa:bbbb:cccc:dddd")?.net).toBe("2001:db8:0:1::/64");
    expect(parseAddress("2001:db8:0:2::1")?.net).toBe("2001:db8:0:2::/64");
    expect(parseAddress("::1")).toEqual({ ip: "::1", net: "::/64" });
  });

  test("a zone is dropped and what is not an address is refused", () => {
    expect(parseAddress("fe80::1%eth0")?.ip).toBe("fe80::1");
    for (const bad of [
      "unknown",
      "",
      "1.2",
      "010.1.1.1x",
      "999.1.1.1",
      "2001:db8::g",
      null,
      undefined,
    ])
      expect(parseAddress(bad)).toBeNull();
  });

  test("a network is an address or a /64 written out", () => {
    expect(parseNetwork("2001:db8:0:1::/64")).toBe("2001:db8:0:1::/64");
    expect(parseNetwork("2001:db8:0:1:9::7")).toBe("2001:db8:0:1::/64");
    expect(parseNetwork("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(parseNetwork("10.0.0.0/64")).toBeNull();
    expect(parseNetwork("nope")).toBeNull();
  });
});

describe("device detection", () => {
  test("parses browser, system, device type, brand and model", () => {
    clearDeviceCache();
    expect(deviceOf(CHROME)).toEqual({
      browser: "Chrome",
      os: "Windows",
      deviceType: "desktop",
      brand: null,
      model: null,
      isBot: false,
    });
    expect(deviceOf(IPHONE)).toMatchObject({
      os: "iOS",
      deviceType: "smartphone",
      brand: "Apple",
      model: "iPhone",
      isBot: false,
    });
  });

  test("the crawler check alone answers from its own cache and agrees with the full parse", () => {
    clearDeviceCache();
    const before = deviceParseCount();
    expect(isBotAgent(GOOGLEBOT)).toBe(true);
    expect(isBotAgent(CHROME)).toBe(false);
    expect(isBotAgent(CHROME)).toBe(false);
    expect(deviceParseCount()).toBe(before + 2);
    expect(isBotAgent(undefined)).toBe(false);
    expect(deviceOf(GOOGLEBOT).isBot).toBe(true);
    expect(deviceOf(CHROME).isBot).toBe(false);
    // The crawler check alone fills only its own cache: the full parse of the same string is
    // still to be done, which is what keeps it off the hot path of a view.
    clearDeviceCache();
    expect(isBotAgent(CHROME)).toBe(false);
    const cheap = deviceParseCount();
    deviceOf(CHROME);
    expect(deviceParseCount()).toBe(cheap + 1);
    // A user agent whose device is cached needs no second parse.
    const parsed = deviceParseCount();
    expect(isBotAgent(CHROME)).toBe(false);
    expect(deviceParseCount()).toBe(parsed);
  });

  test("a crawler is a bot and an empty user agent has no device", () => {
    expect(deviceOf(GOOGLEBOT)).toMatchObject({ browser: "Googlebot", isBot: true });
    expect(deviceOf(undefined)).toBe(NO_DEVICE);
    expect(deviceOf("")).toBe(NO_DEVICE);
  });

  test("a user agent seen again is not parsed again", () => {
    clearDeviceCache();
    const before = deviceParseCount();
    const first = deviceOf(CHROME);
    expect(deviceParseCount()).toBe(before + 1);
    expect(deviceOf(CHROME)).toBe(first);
    expect(deviceParseCount()).toBe(before + 1);
  });

  test("the cache is bounded and drops the least recently used string", () => {
    clearDeviceCache();
    deviceOf(CHROME);
    for (let i = 0; i < DEVICE_CACHE_SIZE - 1; i++) deviceOf(`${CHROME} extra/${i}`);
    deviceOf(CHROME); // used again: now the newest
    deviceOf(`${CHROME} extra/new`); // one over the bound: the oldest unused goes
    const parsed = deviceParseCount();
    deviceOf(CHROME);
    expect(deviceParseCount()).toBe(parsed);
    deviceOf(`${CHROME} extra/0`);
    expect(deviceParseCount()).toBe(parsed + 1);
  });
});

// A member of a new group of rank 20 (above members, below moderators) that holds View IPs and
// may view forums, as members do.
function readerOf(w: Awaited<ReturnType<typeof world>>) {
  const group = w.ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('IP readers', 20) RETURNING id",
    )
    .get()!.id;
  for (const key of ["member.viewIps", "node.view", "profile.view"]) {
    const definition = w.ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get(key)!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, 1)",
      )
      .run(definition, group);
  }
  return insertUser(w.ctx, { groupId: group });
}

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const forum = insertNode(ctx, { type: "forum" });
  invalidate(ctx, "node_tree");
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const at = (row: { id: number; groupId: number }, clientIp?: string, userAgent?: string) => ({
    ...userActor(row),
    ...(clientIp ? { clientIp } : {}),
    ...(userAgent ? { userAgent } : {}),
  });
  const member = insertUser(ctx);
  const other = insertUser(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  const log = () =>
    ctx.sqlite
      .prepare<
        {
          user_id: number;
          ip: string;
          ip_net: string;
          action: string;
          content_type: string | null;
          content_id: number | null;
          browser: string | null;
          os: string | null;
          device_type: string | null;
          brand: string | null;
          model: string | null;
          is_bot: number;
        },
        []
      >("SELECT * FROM ip_log ORDER BY id")
      .all();
  return { ctx, forum, call, at, member, other, admin, log };
}

describe("the IP log", () => {
  test("a thread and a reply each write one row with the address, device and content", async () => {
    const w = await world();
    const author = w.at(w.member, "::ffff:203.0.113.7", CHROME);
    const created = await w.call("threads.create", author, {
      nodeId: w.forum.id,
      title: "Hello",
      body: "First",
    });
    expect(w.log()).toHaveLength(1);
    expect(w.log()[0]).toMatchObject({
      user_id: w.member.id,
      ip: "203.0.113.7",
      ip_net: "203.0.113.7",
      action: "thread",
      content_type: "post",
      content_id: created.post.id,
      browser: "Chrome",
      os: "Windows",
      device_type: "desktop",
      is_bot: 0,
    });
    const reply = await w.call("posts.create", w.at(w.other, "2001:db8:0:1::5", IPHONE), {
      threadId: created.thread.id,
      body: "Reply",
    });
    expect(w.log()).toHaveLength(2);
    expect(w.log()[1]).toMatchObject({
      user_id: w.other.id,
      ip: "2001:db8:0:1::5",
      ip_net: "2001:db8:0:1::/64",
      action: "post",
      content_type: "post",
      content_id: reply.id,
      os: "iOS",
      brand: "Apple",
      model: "iPhone",
    });
  });

  test("conversation messages, profile posts, comments and reports each write one row", async () => {
    const w = await world();
    const me = w.at(w.member, "198.51.100.4", CHROME);
    const conversation = await w.call("conversations.create", me, {
      title: "Hi",
      recipientIds: [w.other.id],
      body: "Hello",
    });
    expect(w.log().at(-1)).toMatchObject({
      action: "conversation_message",
      content_type: "conversation_message",
      content_id: conversation.message.id,
    });
    const message = await w.call("conversations.reply", w.at(w.other, "198.51.100.5"), {
      conversationId: conversation.conversation.id,
      body: "Back",
    });
    expect(w.log().at(-1)).toMatchObject({
      user_id: w.other.id,
      action: "conversation_message",
      content_id: message.id,
      browser: null,
    });
    const wall = await w.call("profilePosts.create", me, {
      userId: w.other.id,
      body: "On the wall",
    });
    expect(w.log().at(-1)).toMatchObject({
      action: "profile_post",
      content_type: "profile_post",
      content_id: wall.id,
    });
    const comment = await w.call("profileComments.create", w.at(w.other, "198.51.100.5"), {
      profilePostId: wall.id,
      body: "Thanks",
    });
    expect(w.log().at(-1)).toMatchObject({
      action: "profile_post_comment",
      content_type: "profile_post_comment",
      content_id: comment.id,
    });
    const report = await w.call("reports.create", w.at(w.other, "198.51.100.5"), {
      target: { type: "profile_post", id: wall.id },
      reason: "Spam",
    });
    expect(w.log().at(-1)).toMatchObject({
      action: "report",
      content_type: "report",
      content_id: report.id,
    });
    expect(w.log()).toHaveLength(5);
  });

  test("no address, no row: internal callers and the unknown placeholder write nothing", async () => {
    const w = await world();
    await w.call("threads.create", w.at(w.member), { nodeId: w.forum.id, title: "A", body: "a" });
    await w.call("threads.create", w.at(w.member, "unknown"), {
      nodeId: w.forum.id,
      title: "B",
      body: "b",
    });
    expect(w.log()).toHaveLength(0);
  });

  test("a refused write leaves no row", async () => {
    const w = await world();
    await expect(
      w.call("posts.create", w.at(w.member, "198.51.100.4"), { threadId: 999, body: "x" }),
    ).rejects.toBeDefined();
    expect(w.log()).toHaveLength(0);
  });

  test("the user agent is parsed, never stored", async () => {
    const w = await world();
    const columns = w.ctx.sqlite.query("PRAGMA table_info(ip_log)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain("user_agent");
  });
});

describe("thread views", () => {
  test("a crawler's visit is not a view, a browser's is", async () => {
    const w = await world();
    const created = await w.call("threads.create", w.at(w.member, "198.51.100.4"), {
      nodeId: w.forum.id,
      title: "A",
      body: "a",
    });
    const views = () => w.ctx.views.get(created.thread.id) ?? 0;
    clearDeviceCache();
    await w.call(
      "threads.get",
      { ...GUEST, userAgent: GOOGLEBOT },
      { threadId: created.thread.id },
    );
    expect(views()).toBe(0);
    await w.call("threads.get", w.at(w.other, "198.51.100.5", GOOGLEBOT), {
      threadId: created.thread.id,
    });
    expect(views()).toBe(0);
    await w.call("threads.get", { ...GUEST, userAgent: CHROME }, { threadId: created.thread.id });
    expect(views()).toBe(1);
    await w.call("threads.get", GUEST, { threadId: created.thread.id });
    expect(views()).toBe(2);
    // Counting a view takes the cheap crawler check only: no device was parsed on the way.
    const parsed = deviceParseCount();
    deviceOf(CHROME);
    expect(deviceParseCount()).toBe(parsed + 1);
  });
});

describe("the staff views", () => {
  async function filled() {
    const w = await world();
    const mine = w.at(w.member, "203.0.113.7", CHROME);
    const first = await w.call("threads.create", mine, {
      nodeId: w.forum.id,
      title: "A",
      body: "a",
    });
    w.ctx.clock.advance(1000);
    await w.call("posts.create", mine, { threadId: first.thread.id, body: "b" });
    w.ctx.clock.advance(1000);
    await w.call("posts.create", w.at(w.member, "2001:db8:0:1::10"), {
      threadId: first.thread.id,
      body: "c",
    });
    w.ctx.clock.advance(1000);
    await w.call("posts.create", w.at(w.other, "2001:db8:0:1::99"), {
      threadId: first.thread.id,
      body: "d",
    });
    w.ctx.clock.advance(1000);
    await w.call("posts.create", w.at(w.other, "203.0.113.7"), {
      threadId: first.thread.id,
      body: "e",
    });
    return { ...w, first };
  }
  const ids = (items: { user: { id: number } }[]) => items.map((item) => item.user.id);

  test("ips.content shows the address a post was made from, a thread's being its first post's", async () => {
    const w = await filled();
    const admin = w.at(w.admin);
    const found = await w.call("ips.content", admin, {
      contentType: "post",
      contentId: w.first.post.id,
    });
    expect(found.entry).toMatchObject({
      userId: w.member.id,
      ip: "203.0.113.7",
      action: "thread",
      device: { browser: "Chrome", os: "Windows", deviceType: "desktop", isBot: false },
    });
    // A private message is not offered here: it is read only through the audited report view.
    await expect(
      w.call("ips.content", admin, { contentType: "conversation_message", contentId: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const missing = await w.call("ips.content", admin, { contentType: "post", contentId: 999_999 });
    expect(missing.entry).toBeNull();
  });

  test("users.ips lists a member's addresses with counts, first and last seen", async () => {
    const w = await filled();
    const result = await w.call("users.ips", w.at(w.admin), { userId: w.member.id });
    expect(result.nextCursor).toBeNull();
    expect(result.items.map((item: { ip: string }) => item.ip)).toEqual([
      "2001:db8:0:1::10",
      "203.0.113.7",
    ]);
    const [v6, v4] = result.items;
    expect(v6).toMatchObject({ network: "2001:db8:0:1::/64", count: 1 });
    expect(v4).toMatchObject({ network: "203.0.113.7", count: 2 });
    expect(Date.parse(v4.lastSeenAt) - Date.parse(v4.firstSeenAt)).toBe(1000);
    expect(Date.parse(v6.firstSeenAt)).toBeGreaterThan(Date.parse(v4.lastSeenAt));
  });

  test("users.ips pages with a cursor", async () => {
    const w = await filled();
    const one = await w.call("users.ips", w.at(w.admin), { userId: w.member.id, limit: 1 });
    expect(one.items.map((item: { ip: string }) => item.ip)).toEqual(["2001:db8:0:1::10"]);
    expect(one.nextCursor).not.toBeNull();
    const two = await w.call("users.ips", w.at(w.admin), {
      userId: w.member.id,
      limit: 1,
      cursor: one.nextCursor,
    });
    expect(two.items.map((item: { ip: string }) => item.ip)).toEqual(["203.0.113.7"]);
    expect(two.nextCursor).toBeNull();
  });

  test("ips.members shares an IPv4 address and groups IPv6 by its /64", async () => {
    const w = await filled();
    const admin = w.at(w.admin);
    const v4 = await w.call("ips.members", admin, { ip: "::ffff:203.0.113.7" });
    expect(v4.network).toBe("203.0.113.7");
    expect(ids(v4.items)).toEqual([w.other.id, w.member.id]);
    expect(
      v4.items.find((item: { user: { id: number } }) => item.user.id === w.member.id).count,
    ).toBe(2);
    // Two different addresses of one /64, used by two members, are one group.
    const v6 = await w.call("ips.members", admin, { ip: "2001:db8:0:1::abcd" });
    expect(v6.network).toBe("2001:db8:0:1::/64");
    expect(ids(v6.items).sort()).toEqual([w.member.id, w.other.id].sort());
    const written = await w.call("ips.members", admin, { ip: "2001:db8:0:1::/64" });
    expect(written.items).toHaveLength(2);
    const elsewhere = await w.call("ips.members", admin, { ip: "2001:db8:0:2::1" });
    expect(elsewhere.items).toEqual([]);
  });

  test("ips.members pages with a cursor and refuses what is not an address", async () => {
    const w = await filled();
    const admin = w.at(w.admin);
    const one = await w.call("ips.members", admin, { ip: "203.0.113.7", limit: 1 });
    expect(one.items).toHaveLength(1);
    const two = await w.call("ips.members", admin, {
      ip: "203.0.113.7",
      limit: 1,
      cursor: one.nextCursor,
    });
    expect(two.items).toHaveLength(1);
    expect(two.items[0].user.id).not.toBe(one.items[0].user.id);
    expect(two.nextCursor).toBeNull();
    await expect(w.call("ips.members", admin, { ip: "not an address" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("failed sign-ins tie no address to a member in the staff views", async () => {
    const w = await filled();
    w.ctx.sqlite
      .prepare(
        "INSERT INTO ip_log (user_id, ip, ip_net, action, is_bot, created_at) VALUES (?1, '192.0.2.99', '192.0.2.99', 'sign_in_failed', 0, ?2)",
      )
      .run(w.member.id, w.ctx.now());
    const admin = w.at(w.admin);
    expect((await w.call("ips.members", admin, { ip: "192.0.2.99" })).items).toEqual([]);
    const ips = (await w.call("users.ips", admin, { userId: w.member.id })).items;
    expect(ips.map((item: { ip: string }) => item.ip)).not.toContain("192.0.2.99");
  });

  test("View IPs is needed: guests, members and moderators without it are refused", async () => {
    const w = await filled();
    const moderator = insertUser(w.ctx, { groupId: 3 });
    const operations: [string, object][] = [
      ["ips.content", { contentType: "post", contentId: w.first.post.id }],
      ["users.ips", { userId: w.member.id }],
      ["ips.members", { ip: "203.0.113.7" }],
    ];
    for (const [name, input] of operations) {
      await expect(w.call(name, GUEST, input)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(w.call(name, w.at(w.other), input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(w.call(name, w.at(moderator), input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(w.call(name, w.at(w.admin), input)).resolves.toBeDefined();
    }
    // Granted to a group, a member of it may look.
    const reader = readerOf(w);
    for (const [name, input] of operations)
      await expect(w.call(name, w.at(reader), input)).resolves.toBeDefined();
    // A token acts with its owner's permissions: the owner's rights decide.
    const token = { ...tokenActor(reader), clientIp: "198.51.100.9" };
    await expect(w.call("users.ips", token, { userId: w.member.id })).resolves.toBeDefined();
    await expect(
      w.call("users.ips", tokenActor(w.other), { userId: w.member.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("ips.content shows no address for content the holder cannot see", async () => {
    const w = await filled();
    const reader = w.at(readerOf(w));
    const ask = (actor: object) =>
      w.call("ips.content", actor, { contentType: "post", contentId: w.first.post.id });
    expect((await ask(reader)).entry).toMatchObject({ ip: "203.0.113.7" });
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(w.first.post.id);
    expect((await ask(reader)).entry).toBeNull();
    // Those who may see deleted content still get it.
    expect((await ask(w.at(w.admin))).entry).toMatchObject({ ip: "203.0.113.7" });
  });

  test("a holder reads only the addresses of members they outrank", async () => {
    const w = await filled();
    const rival = insertUser(w.ctx, { groupId: 4 });
    const post = await w.call("posts.create", w.at(rival, "203.0.113.7"), {
      threadId: w.first.thread.id,
      body: "From the same address",
    });
    const reader = readerOf(w);
    const admin = w.at(w.admin);
    // Over a member of lower rank: allowed. Over an administrator: refused by the reader, and
    // by another administrator of equal rank.
    await expect(w.call("users.ips", w.at(reader), { userId: w.member.id })).resolves.toBeDefined();
    await expect(w.call("users.ips", w.at(reader), { userId: rival.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(w.call("users.ips", admin, { userId: rival.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Members the reader does not outrank are left out of an address's members...
    const shared = await w.call("ips.members", w.at(reader), { ip: "203.0.113.7" });
    expect(ids(shared.items).sort()).toEqual([w.member.id, w.other.id].sort());
    expect(ids((await w.call("ips.members", admin, { ip: "203.0.113.7" })).items)).not.toContain(
      rival.id,
    );
    // ...and the address of their content is not shown, as if none were logged.
    const ofRival = await w.call("ips.content", w.at(reader), {
      contentType: "post",
      contentId: post.id,
    });
    expect(ofRival.entry).toBeNull();
    const ofMember = await w.call("ips.content", w.at(reader), {
      contentType: "post",
      contentId: w.first.post.id,
    });
    expect(ofMember.entry).toMatchObject({ ip: "203.0.113.7" });
  });

  test("the staff reads search their covering indexes", async () => {
    const w = await filled();
    expectNoTableScan(w.ctx, securitySql.content, ["post", 1]);
    expectNoTableScan(w.ctx, ipLogSql.erase, [w.member.id]);
    // The grouped rows of one member or network are sorted in memory: a few rows, never a scan.
    const plan = (sql: string, params: (string | number)[]) =>
      (w.ctx.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
        .map((row) => row.detail)
        .join("\n");
    const members = plan(securitySql.memberIps, [1, 1, "a", 1]);
    expect(members).toContain("SEARCH ip_log USING COVERING INDEX ip_log_member_ip (user_id=?)");
    expect(members).not.toContain("SCAN ip_log");
    const networks = plan(securitySql.netMembers, ["a", 1, 1, 1]);
    expect(networks).toContain("SEARCH ip_log USING COVERING INDEX ip_log_net_member (ip_net=?)");
    expect(networks).not.toContain("SCAN ip_log");
    expect(plan(securitySql.content, ["post", 1])).toContain("ip_log_content");
  });
});

describe("sign-in, registration and failed sign-ins", () => {
  const headers = (ip: string, userAgent = CHROME) =>
    new Headers({ "x-sermo-client-ip": ip, "user-agent": userAgent });

  test("registration writes one row, not a second for the session it opens", async () => {
    const w = await accounts();
    const result = await getAuth(w.ctx).api.signUpEmail({
      body: { name: "Ada", username: "Ada", email: "ada@example.test", password: PASSWORD },
      headers: headers("::ffff:203.0.113.20"),
    });
    const rows = w.ctx.sqlite
      .prepare<{ action: string; ip: string; browser: string | null }, [number]>(
        "SELECT action, ip, browser FROM ip_log WHERE user_id = ?1 ORDER BY id",
      )
      .all(Number(result.user.id));
    expect(rows).toEqual([{ action: "register", ip: "203.0.113.20", browser: "Chrome" }]);
  });

  test("an IPv6 sign-in logs the address the client used, not Better Auth's masked /64", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await getAuth(w.ctx).api.signInEmail({
      body: { email: "ada@example.test", password: PASSWORD },
      headers: headers("2001:db8:0:1::5"),
    });
    const rows = w.ctx.sqlite
      .prepare<{ ip: string; ip_net: string; action: string }, [number]>(
        "SELECT ip, ip_net, action FROM ip_log WHERE user_id = ?1",
      )
      .all(ada.id);
    expect(rows).toEqual([
      { ip: "2001:db8:0:1::5", ip_net: "2001:db8:0:1::/64", action: "sign_in" },
    ]);
    const stored = w.ctx.sqlite
      .prepare<{ ip_address: string }, [number]>(
        "SELECT ip_address FROM auth_session WHERE user_id = ?1 ORDER BY id DESC",
      )
      .get(ada.id)!.ip_address;
    expect(stored).not.toBe("2001:db8:0:1::5"); // Better Auth keeps the masked form
  });

  test("a sign-in writes a row and a wrong password writes a failed one for that member", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const rows = () =>
      w.ctx.sqlite
        .prepare<{ action: string; ip: string; os: string | null }, [number]>(
          "SELECT action, ip, os FROM ip_log WHERE user_id = ?1 ORDER BY id",
        )
        .all(ada.id);
    expect(rows()).toEqual([]);
    await getAuth(w.ctx).api.signInEmail({
      body: { email: "ada@example.test", password: PASSWORD },
      headers: headers("203.0.113.30", IPHONE),
    });
    expect(rows()).toEqual([{ action: "sign_in", ip: "203.0.113.30", os: "iOS" }]);
    await expect(
      getAuth(w.ctx).api.signInEmail({
        body: { email: "ada@example.test", password: "wrong-password" },
        headers: headers("198.51.100.77"),
      }),
    ).rejects.toBeDefined();
    await expect(
      getAuth(w.ctx).api.signInUsername({
        body: { username: "ADA", password: "wrong-password" },
        headers: headers("198.51.100.78"),
      }),
    ).rejects.toBeDefined();
    expect(rows().slice(1)).toEqual([
      { action: "sign_in_failed", ip: "198.51.100.77", os: "Windows" },
      { action: "sign_in_failed", ip: "198.51.100.78", os: "Windows" },
    ]);
    // Nobody has this name, so the history of no member gains a row.
    await expect(
      getAuth(w.ctx).api.signInEmail({
        body: { email: "nobody@example.test", password: "wrong-password" },
        headers: headers("198.51.100.79"),
      }),
    ).rejects.toBeDefined();
    expect(
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM ip_log").get()?.n,
    ).toBe(3);
  });

  test("a log that cannot be written never fails a sign-in or turns a refusal into an error", async () => {
    const w = await accounts();
    await w.register("Ada");
    w.ctx.sqlite.run("DROP TABLE ip_log");
    const quiet = console.error;
    console.error = () => {};
    try {
      const signed = await getAuth(w.ctx).api.signInEmail({
        body: { email: "ada@example.test", password: PASSWORD },
        headers: headers("203.0.113.31"),
      });
      expect(signed.user.email).toBe("ada@example.test");
      await expect(
        getAuth(w.ctx).api.signInEmail({
          body: { email: "ada@example.test", password: "wrong-password" },
          headers: headers("198.51.100.80"),
        }),
      ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    } finally {
      console.error = quiet;
    }
  });

  test("resolveActor carries the user agent of the request", async () => {
    const w = await accounts();
    const guest = await resolveActor(w.ctx, headers("203.0.113.40", GOOGLEBOT));
    expect(guest.actor).toEqual({ kind: "guest", userAgent: GOOGLEBOT });
    expect((await resolveActor(w.ctx, new Headers())).actor).toEqual(GUEST);
  });
});

describe("sessions show their device", () => {
  test("users.adminSessions and auth.sessionDevices return the parsed device and a normalised address", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const ada = await w.register("Ada");
    await getAuth(w.ctx).api.signInEmail({
      body: { email: "ada@example.test", password: PASSWORD },
      headers: new Headers({ "x-sermo-client-ip": "::ffff:203.0.113.50", "user-agent": IPHONE }),
    });
    const listed = await w.run("users.adminSessions", founder.actor, { userId: ada.id });
    // Newest first: registering opened one session, signing in the second.
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0]).toMatchObject({
      ipAddress: "203.0.113.50",
      device: { browser: "Mobile Safari", os: "iOS", deviceType: "smartphone", brand: "Apple" },
    });
    const own = await w.run("auth.sessionDevices", ada.actor, {});
    expect(own.items).toHaveLength(2);
    expect(own.items[0]).toEqual({
      sessionId: listed.items[0].id,
      ipAddress: "203.0.113.50",
      device: expect.objectContaining({ os: "iOS", isBot: false }),
      location: null,
      lastActiveAt: expect.any(String),
    });
    expect(own.items[1]).toMatchObject({
      ipAddress: null,
      device: { browser: null, isBot: false },
    });
    await expect(w.run("auth.sessionDevices", GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      w.run("auth.sessionDevices", { ...ada.actor, kind: "token", tokenId: 1 }, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("erasing a member", () => {
  test("deletes that member's rows and no one else's", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const target = await w.register("Target");
    const friend = await w.register("Friend");
    const forum = insertNode(w.ctx, { type: "forum" });
    invalidate(w.ctx, "node_tree");
    const from = (member: { actor: object }, clientIp: string) => ({
      ...member.actor,
      clientIp,
      userAgent: CHROME,
    });
    for (const [member, clientIp] of [
      [target, "203.0.113.60"],
      [target, "203.0.113.61"],
      [friend, "203.0.113.60"],
    ] as const)
      await w.run("threads.create", from(member, clientIp), {
        nodeId: forum.id,
        title: "T",
        body: "b",
      });
    await getAuth(w.ctx).api.signInEmail({
      body: { email: "target@example.test", password: PASSWORD },
      headers: new Headers({ "x-sermo-client-ip": "203.0.113.62" }),
    });
    const count = (id: number) =>
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM ip_log WHERE user_id = ?1")
        .get(id)!.n;
    expect(count(target.id)).toBe(3);
    expect(count(friend.id)).toBe(1);
    await w.run("users.adminErase", founder.actor, {
      userId: target.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    expect(count(target.id)).toBe(0);
    expect(count(friend.id)).toBe(1);
    // An erased account's wrong passwords are not noted either.
    await expect(
      getAuth(w.ctx).api.signInEmail({
        body: { email: "target@example.test", password: "wrong-password" },
        headers: new Headers({ "x-sermo-client-ip": "203.0.113.63" }),
      }),
    ).rejects.toBeDefined();
    expect(count(target.id)).toBe(0);
  });
});
