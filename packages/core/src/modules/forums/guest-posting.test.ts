import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../../drizzle/meta/_journal.json";
import { type Actor, actorUserId, GUEST } from "../../actor";
import { type Ctx, closeContext, createContext, invalidate } from "../../context";
import { GROUP_IDS, GUEST_ACCOUNT_ID } from "../../db/schema";
import {
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { dispatchEvents } from "../../events";
import { execute, getOperation } from "../../index";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "../../testing";
import { evaluateMember as evaluateAward } from "../awards/automatic";
import { registerCreditRuleJobs } from "../credit-events";
import { runDueJobs } from "../jobs";
import { refreshStandings } from "../members/standings";
import { guestRoomSql } from "../moderation/limits";
import { registerNotificationJobs } from "../notifications/delivery";
import { evaluateMember as evaluatePromotion } from "../promotions";
import { atomFeed } from "../seo/feeds";
import { threadMarkdown } from "../seo/markdown";
import { registerSocialJobs } from "../social";
import { forumSql } from ".";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN = "solved-widget-token";

const opened: Ctx[] = [];
afterEach(() => {
  for (const ctx of opened.splice(0)) closeContext(ctx);
  // biome-ignore lint/suspicious/noExplicitAny: restores the global the spies replaced
  (globalThis.fetch as any).mockRestore?.();
});

/** Cloudflare, scripted: every siteverify call gets `verdict`; the calls are kept. */
function cloudflare(verdict: { success: boolean; action?: string } = { success: true }) {
  // biome-ignore lint/suspicious/noExplicitAny: replaces a spy an earlier call set
  (globalThis.fetch as any).mockRestore?.();
  const calls: Record<string, unknown>[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    if (String(input) !== SITEVERIFY) throw new Error(`unexpected network call to ${input}`);
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ action: "guestPost", hostname: "localhost", ...verdict });
  }) as unknown as typeof fetch);
  return calls;
}

const guestFrom = (ip: string): Actor => ({ kind: "guest", clientIp: ip });

async function site(options: { turnstile?: boolean; allow?: boolean } = {}) {
  const ctx = createTestContext();
  opened.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  const moderator = userActor(insertUser(ctx, { groupId: GROUP_IDS.moderator }));
  const memberRow = insertUser(ctx, { username: "Carla" });
  const member = userActor(memberRow);
  const forum = insertNode(ctx, { title: "Open forum" });
  const closed = insertNode(ctx, { title: "Members only" });
  invalidate(ctx, "node_tree");
  const call = (name: string, actor: Actor, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor, input) as Promise<any>;
  if (options.turnstile !== false)
    await call("settings.update", admin, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
      turnstileSecret: "secret",
      turnstileForms: ["register", "guestPost"],
    });
  // The forum permission screens write through permissions.set, for the Guest group on a node.
  if (options.allow !== false)
    await call("permissions.set", admin, {
      groupId: GROUP_IDS.guest,
      nodeId: forum.id,
      entries: [{ permission: "forum.guestPost", value: "allow" }],
    });
  const memberThread = await call("threads.create", member, {
    nodeId: forum.id,
    title: "Members talk",
    body: "Opening post",
  });
  const guestThread = (actor: Actor, input: object = {}) =>
    call("threads.createAsGuest", actor, {
      nodeId: forum.id,
      title: "Hello from a guest",
      body: "A guest's opening post",
      name: "Wanderer",
      turnstileToken: TOKEN,
      ...input,
    });
  const guestReply = (actor: Actor, input: object = {}) =>
    call("posts.createAsGuest", actor, {
      threadId: memberThread.thread.id,
      body: "A guest's reply",
      name: "Wanderer",
      turnstileToken: TOKEN,
      ...input,
    });
  const approve = (type: "thread" | "post", id: number) =>
    call("moderation.setState", moderator, { target: { type, id }, state: "visible" });
  const rows = (sql: string, ...params: (string | number)[]) =>
    ctx.sqlite.prepare<Record<string, unknown>, (string | number)[]>(sql).all(...params);
  return {
    ctx,
    admin,
    moderator,
    member,
    memberRow,
    forum,
    closed,
    memberThread,
    call,
    guestThread,
    guestReply,
    approve,
    rows,
  };
}

const AUTHOR = { kind: "guest", name: "Wanderer" };

describe("guest posting", () => {
  test("a guest's thread and reply are stored moderated, under the guest account and the name given", async () => {
    const s = await site();
    const verified = cloudflare();
    const guest = guestFrom("203.0.113.7");
    const made = await s.guestThread(guest, { name: "  Wanderer  " });
    const reply = await s.guestReply(guest);
    expect(Object.keys(made).sort()).toEqual(["postId", "threadId"]);
    expect(
      s.rows("SELECT user_id, guest_name, state FROM threads WHERE id = ?1", made.threadId),
    ).toEqual([{ user_id: GUEST_ACCOUNT_ID, guest_name: "Wanderer", state: "moderated" }]);
    expect(
      s.rows(
        "SELECT user_id, guest_name, state FROM posts WHERE id IN (?1, ?2) ORDER BY id",
        made.postId,
        reply.postId,
      ),
    ).toEqual([
      { user_id: GUEST_ACCOUNT_ID, guest_name: "Wanderer", state: "visible" },
      { user_id: GUEST_ACCOUNT_ID, guest_name: "Wanderer", state: "moderated" },
    ]);
    // The token was checked for the guest's address.
    expect(verified.map((body) => [body.response, body.remoteip])).toEqual([
      [TOKEN, "203.0.113.7"],
      [TOKEN, "203.0.113.7"],
    ]);
    // Both wait in the approval queue, with the guest's name and no member.
    const queue = await s.call("approvals.list", s.moderator, {});
    expect(
      queue.items
        .filter((item: { type: string }) => item.type !== "profile_post")
        .map((item: { type: string; id: number; author: unknown }) => [
          item.type,
          item.id,
          item.author,
        ]),
    ).toEqual(
      expect.arrayContaining([
        ["thread", made.threadId, AUTHOR],
        ["post", reply.postId, AUTHOR],
      ]),
    );
    // No guest, the one who posted included, sees them before approval.
    await expect(s.call("threads.get", guest, { threadId: made.threadId })).rejects.toThrow();
    const page = await s.call("posts.list", guestFrom("203.0.113.8"), {
      threadId: s.memberThread.thread.id,
    });
    expect(page.items.map((post: { id: number }) => post.id)).not.toContain(reply.postId);
    // Nothing counts it yet.
    expect(
      s.rows("SELECT reply_count FROM threads WHERE id = ?1", s.memberThread.thread.id),
    ).toEqual([{ reply_count: 0 }]);
  });

  test("approval shows them like any post, with the guest as author and no member behind it", async () => {
    const s = await site();
    cloudflare();
    const guest = guestFrom("203.0.113.7");
    const made = await s.guestThread(guest);
    const reply = await s.guestReply(guest);
    await s.approve("thread", made.threadId);
    await s.approve("post", reply.postId);
    const viewer = GUEST;
    const thread = await s.call("threads.get", viewer, { threadId: made.threadId });
    expect(thread.thread.author).toEqual(AUTHOR);
    expect(thread.thread.lastPost.user).toEqual(AUTHOR);
    const posts = await s.call("posts.list", viewer, { threadId: s.memberThread.thread.id });
    const shown = posts.items.find((post: { id: number }) => post.id === reply.postId);
    expect(shown.author).toEqual(AUTHOR);
    expect(shown.canEdit).toBe(false);
    const repliedTo = await s.call("threads.get", viewer, { threadId: s.memberThread.thread.id });
    expect(repliedTo.thread.lastPost.user).toEqual(AUTHOR);
    expect(repliedTo.thread.replyCount).toBe(1);
    const list = await s.call("threads.list", viewer, { nodeId: s.forum.id });
    expect(list.items.find((item: { id: number }) => item.id === made.threadId).author).toEqual(
      AUTHOR,
    );
    const node = await s.call("nodes.get", viewer, { nodeId: s.forum.id });
    expect(node.node.lastPost.user).toEqual(AUTHOR);
    const found = await s.call("search.query", viewer, { q: "reply" });
    expect(
      found.items.find((item: { post: { id: number } }) => item.post.id === reply.postId).post
        .author,
    ).toEqual(AUTHOR);
    // The page's structured data names the guest, with no profile to point to.
    s.ctx.config.siteBaseURL = "https://forum.example.test";
    const seo = await s.call("seo.thread", viewer, { threadId: made.threadId });
    expect(JSON.stringify(seo.jsonLd)).toContain('"author":{"@type":"Person","name":"Wanderer"}');
    // The feed and the page for machines name the guest too.
    expect(atomFeed(s.ctx, "https://forum.example.test", "Forum")).toContain(
      "<author><name>Wanderer</name></author>",
    );
    const text = threadMarkdown(s.ctx, "https://forum.example.test", made.threadId, "", 1);
    expect("markdown" in text && text.markdown).toContain("started by Wanderer");
    // Nothing of the reserved account reaches an output: no id, no username.
    const everything = JSON.stringify([thread, posts, repliedTo, list, node, found, seo]);
    expect(everything).not.toContain(`"id":${GUEST_ACCOUNT_ID}`);
    expect(everything).not.toContain('"username":"Guest"');
    // Its address is in the log for staff, with no member to name.
    const address = await s.call("ips.content", s.admin, {
      contentType: "post",
      contentId: reply.postId,
    });
    expect(address.entry).toMatchObject({ userId: null, ip: "203.0.113.7", action: "post" });
  });

  test("refused where the forum does not allow guests, which is every forum by default", async () => {
    const s = await site({ allow: false });
    const verified = cloudflare();
    const guest = guestFrom("203.0.113.7");
    await expect(s.guestThread(guest)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.guestReply(guest)).rejects.toBeInstanceOf(ForbiddenError);
    expect(verified).toEqual([]);
    const allowed = (await s.call("permissions.listNode", s.admin, { nodeId: s.forum.id })).items;
    expect(JSON.stringify(allowed)).not.toContain("forum.guestPost");
    // Allowed in one forum, it stays off in the others.
    await s.call("permissions.set", s.admin, {
      groupId: GROUP_IDS.guest,
      nodeId: s.forum.id,
      entries: [{ permission: "forum.guestPost", value: "allow" }],
    });
    await expect(s.guestThread(guest, { nodeId: s.closed.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await s.guestThread(guest)).threadId).toBeGreaterThan(0);
  });

  test("refused without Turnstile: not set up for the form, no token, or a token Cloudflare refuses", async () => {
    const unguarded = await site({ turnstile: false });
    cloudflare();
    await expect(unguarded.guestThread(guestFrom("203.0.113.7"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const s = await site();
    await s.call("settings.update", s.admin, { turnstileForms: ["register"] });
    await expect(s.guestThread(guestFrom("203.0.113.7"))).rejects.toBeInstanceOf(ForbiddenError);
    await s.call("settings.update", s.admin, { turnstileForms: ["register", "guestPost"] });
    await expect(
      s.guestThread(guestFrom("203.0.113.7"), { turnstileToken: undefined }),
    ).rejects.toBeInstanceOf(ValidationError);
    cloudflare({ success: false });
    await expect(s.guestReply(guestFrom("203.0.113.7"))).rejects.toBeInstanceOf(ValidationError);
    // A token solved for another form is not this one's.
    cloudflare({ success: true, action: "register" });
    await expect(s.guestReply(guestFrom("203.0.113.7"))).rejects.toBeInstanceOf(ValidationError);
    expect(s.rows("SELECT id FROM posts WHERE user_id = ?1", GUEST_ACCOUNT_ID)).toEqual([]);
  });

  test("the name is 2 to 50 characters and never a member's username, in any case", async () => {
    const s = await site();
    const verified = cloudflare();
    const guest = guestFrom("203.0.113.7");
    await expect(s.guestThread(guest, { name: "cARLA" })).rejects.toBeInstanceOf(ConflictError);
    await expect(s.guestReply(guest, { name: " Carla " })).rejects.toBeInstanceOf(ConflictError);
    await expect(s.guestReply(guest, { name: " x " })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.guestReply(guest, { name: "n".repeat(51) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Refused before the security check spends the token.
    expect(verified).toEqual([]);
    expect((await s.guestReply(guest, { name: "Carla the guest" })).postId).toBeGreaterThan(0);
  });

  test("members, locked threads and read-only forums are refused", async () => {
    const s = await site();
    cloudflare();
    await expect(s.guestThread(s.member)).rejects.toBeInstanceOf(ForbiddenError);
    await s.call("threads.setLocked", s.moderator, {
      threadId: s.memberThread.thread.id,
      isLocked: true,
    });
    await expect(s.guestReply(guestFrom("203.0.113.7"))).rejects.toBeInstanceOf(ForbiddenError);
    s.ctx.sqlite.prepare("UPDATE nodes SET is_read_only = 1 WHERE id = ?1").run(s.forum.id);
    await expect(s.guestThread(guestFrom("203.0.113.7"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("guest writes anywhere else stay refused: profiles, conversations, reactions", async () => {
    const s = await site();
    cloudflare();
    const guest = guestFrom("203.0.113.7");
    await expect(
      s.call("profilePosts.create", guest, { userId: s.memberRow.id, body: "Hi" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      s.call("conversations.create", guest, {
        title: "Hi",
        recipientIds: [s.memberRow.id],
        body: "Hi",
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      s.call("reactions.set", guest, {
        contentType: "post",
        contentId: s.memberThread.post.id,
        reactionTypeId: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      s.call("posts.create", guest, { threadId: s.memberThread.thread.id, body: "Hi" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("an address is held to the flood interval and the Guest group's daily limits", async () => {
    const s = await site();
    cloudflare();
    await s.call("settings.update", s.admin, { floodSeconds: 30 });
    const guest = guestFrom("203.0.113.7");
    await s.guestReply(guest);
    await expect(s.guestReply(guest, { name: "Another name" })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    // Another address is not held back; an IPv6 /64 counts as one address.
    await s.guestReply(guestFrom("2001:db8:1:2::1"));
    await expect(s.guestReply(guestFrom("2001:db8:1:2::99"))).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    s.ctx.clock.advance(31_000);
    await s.guestThread(guest);
    s.ctx.clock.advance(31_000);
    await s.call("permissions.set", s.admin, {
      groupId: GROUP_IDS.guest,
      entries: [{ permission: "antispam.threadsPerDay", value: 1 }],
    });
    await expect(s.guestThread(guest)).rejects.toBeInstanceOf(RateLimitedError);
    await s.guestReply(guest);
    s.ctx.clock.advance(31_000);
    await s.call("permissions.set", s.admin, {
      groupId: GROUP_IDS.guest,
      entries: [{ permission: "antispam.postsPerDay", value: 3 }],
    });
    await expect(s.guestReply(guest)).rejects.toBeInstanceOf(RateLimitedError);
    s.ctx.clock.advance(86_400_000);
    expect((await s.guestReply(guest)).postId).toBeGreaterThan(0);
  });

  test("approved guest posts pay no credits, watch nothing and alert others without naming an actor", async () => {
    const s = await site();
    cloudflare();
    registerCreditRuleJobs(s.ctx);
    registerSocialJobs(s.ctx);
    registerNotificationJobs(s.ctx);
    for (const trigger of ["reply_posted", "reply_received", "thread_created"])
      await s.call("creditRules.create", s.admin, { title: trigger, trigger, amount: 5 });
    await s.call("threads.watch", s.moderator, { threadId: s.memberThread.thread.id });
    const guest = guestFrom("203.0.113.7");
    const made = await s.guestThread(guest);
    const reply = await s.guestReply(guest);
    await s.approve("thread", made.threadId);
    await s.approve("post", reply.postId);
    // A reaction to a guest's post alerts nobody: the guest account, in the Guest group, holds
    // no notification.view.
    await s.call("reactions.set", s.member, {
      contentType: "post",
      contentId: reply.postId,
      reactionTypeId: 1,
    });
    for (let round = 0; round < 3; round++) {
      await dispatchEvents(s.ctx);
      await runDueJobs(s.ctx);
    }
    expect(s.rows("SELECT user_id, amount FROM credit_transactions")).toEqual([]);
    expect(
      s.rows("SELECT thread_id FROM thread_watches WHERE user_id = ?1", GUEST_ACCOUNT_ID),
    ).toEqual([]);
    expect(s.rows("SELECT id FROM notifications WHERE user_id = ?1", GUEST_ACCOUNT_ID)).toEqual([]);
    const alerts = await s.call("notifications.list", s.moderator, {});
    const watched = alerts.items.find((item: { type: string }) => item.type === "thread.watched");
    expect(watched.actors).toEqual([]);
  });
});

describe("the guest account", () => {
  test("is no member: absent from the member lists, search, rankings, birthdays, online and counts", async () => {
    const s = await site();
    cloudflare();
    s.ctx.sqlite.prepare("UPDATE nodes SET counts_posts = 1 WHERE id = ?1").run(s.forum.id);
    const made = await s.guestThread(guestFrom("203.0.113.7"));
    await s.approve("thread", made.threadId);
    // Even with a post count and a birthday the guest account shows nowhere. It never signs in,
    // so it is never active.
    s.ctx.sqlite
      .prepare("UPDATE users SET post_count = 99, birthday_md = '01-01' WHERE id = ?1")
      .run(GUEST_ACCOUNT_ID);
    const ids = (items: { id?: number; user?: { id: number } }[]) =>
      items.map((item) => item.id ?? item.user?.id);
    const members = [actorUserId(s.admin), actorUserId(s.moderator), s.memberRow.id];
    for (const input of [
      { sort: "newest" },
      { sort: "posts" },
      { sort: "posts", ranked: true },
      { sort: "newest", page: 1 },
    ]) {
      const page = await s.call("users.list", s.admin, input);
      expect(ids(page.items)).not.toContain(GUEST_ACCOUNT_ID);
      if (input.page) expect(page.total).toBe(members.length);
    }
    const searched = await s.call("users.search", s.admin, { prefix: "g" });
    expect(ids(searched.items)).not.toContain(GUEST_ACCOUNT_ID);
    const admins = await s.call("users.adminList", s.admin, {});
    expect(ids(admins.items)).not.toContain(GUEST_ACCOUNT_ID);
    const byEmail = await s.call("users.adminList", s.admin, { prefix: "guest" });
    expect(ids(byEmail.items)).not.toContain(GUEST_ACCOUNT_ID);
    const birthdays = await s.call("users.birthdays", s.admin, {});
    expect(ids(birthdays.items)).not.toContain(GUEST_ACCOUNT_ID);
    const online = await s.call("online.list", s.admin, {});
    expect(JSON.stringify(online)).not.toContain(`"id":${GUEST_ACCOUNT_ID}`);
    const stats = await s.call("site.stats", s.admin, {});
    expect(stats.members).toBe(members.length);
    const groups = await s.call("groups.list", s.admin, { counts: true });
    expect(
      groups.items.find((group: { id: number }) => group.id === GROUP_IDS.guest).memberCount,
    ).toBe(0);
    const net = await s.call("ips.members", s.admin, { ip: "203.0.113.7" });
    expect(net.items).toEqual([]);
  });

  test("earns no award, promotion or place in the month's standings", async () => {
    const s = await site();
    cloudflare();
    const guest = guestFrom("203.0.113.7");
    const made = await s.guestThread(guest);
    const reply = await s.guestReply(guest);
    await s.approve("thread", made.threadId);
    await s.approve("post", reply.postId);
    s.ctx.sqlite.prepare("UPDATE users SET post_count = 5 WHERE id = ?1").run(GUEST_ACCOUNT_ID);
    const rule = { match: "all", conditions: [{ criterion: "post_count", value: 1 }] };
    await s.call("awards.create", s.admin, { name: "Poster", tier: "bronze", rule });
    await s.call("promotions.create", s.admin, {
      title: "Poster",
      rule,
      groupIds: [GROUP_IDS.moderator],
    });
    expect(evaluateAward(s.ctx, GUEST_ACCOUNT_ID)).toBe(0);
    expect(evaluatePromotion(s.ctx, GUEST_ACCOUNT_ID)).toBe(0);
    refreshStandings(s.ctx);
    for (const table of ["member_awards", "user_group_grants", "member_month_stats"])
      expect(s.rows(`SELECT 1 FROM ${table} WHERE user_id = ?1`, GUEST_ACCOUNT_ID)).toEqual([]);
    // The member whose thread the guest replied to still counts.
    expect(evaluateAward(s.ctx, s.memberRow.id)).toBe(1);
  });

  test("cannot sign in and cannot be named by any request", async () => {
    const s = await site();
    const auth = (await import("../auth")).getAuth(s.ctx);
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-sermo-client-ip": "203.0.113.9",
        },
        body: JSON.stringify({ email: "guest-account@sermo.invalid", password: "anything123" }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(
      s.call("profiles.get", GUEST, { userId: GUEST_ACCOUNT_ID }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("guest posting queries", () => {
  test("the per-address limits and the name check read an index", () => {
    const ctx = createTestContext();
    opened.push(ctx);
    expectNoTableScan(ctx, guestRoomSql.posts, ["203.0.113.7", GUEST_ACCOUNT_ID, 0]);
    expectNoTableScan(ctx, guestRoomSql.threads, ["203.0.113.7", GUEST_ACCOUNT_ID, 4]);
    expectNoTableScan(ctx, forumSql.guestNameTaken, ["carla"]);
    const plan = ctx.sqlite
      .prepare<{ detail: string }, [string, number, number]>(
        `EXPLAIN QUERY PLAN ${guestRoomSql.posts}`,
      )
      .all("203.0.113.7", GUEST_ACCOUNT_ID, 0)
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("ip_log_net_member");
  });
});

describe("migration 0074", () => {
  const index = journal.entries.find((entry) => entry.tag.endsWith("guest_authors"))!.idx;
  function applyMigrations(ctx: Ctx, from: number, through: number) {
    ctx.sqlite.transaction(() => {
      for (const entry of journal.entries.filter(
        (entry) => entry.idx >= from && entry.idx <= through,
      )) {
        const sql = readFileSync(
          new URL(`../../../drizzle/${entry.tag}.sql`, import.meta.url),
          "utf8",
        );
        for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
      }
    })();
  }

  test("applies on a database with members and content, keeping every row as it was", () => {
    const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
    opened.push(ctx);
    applyMigrations(ctx, 0, index - 1);
    const author = insertUser(ctx, { username: "Founder" });
    const node = insertNode(ctx, { title: "Old forum" });
    const thread = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Old', 1, 1, ?2) RETURNING id",
      )
      .get(node.id, author.id)!.id;
    ctx.sqlite
      .prepare("INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, 1)")
      .run(thread, author.id);
    const before = ctx.sqlite.prepare("SELECT * FROM posts").all();

    applyMigrations(ctx, index, index);

    expect(ctx.sqlite.prepare("SELECT * FROM posts").all()).toEqual(
      before.map((row) => ({ ...(row as object), guest_name: null })),
    );
    expect(ctx.sqlite.prepare("SELECT id, user_id, guest_name FROM threads").all()).toEqual([
      { id: thread, user_id: author.id, guest_name: null },
    ]);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT u.id, u.group_id, u.show_online, u.profile_view_privacy, a.email_verified FROM users u JOIN auth_user a ON a.id = u.id ORDER BY u.id",
        )
        .all(),
    ).toEqual([
      {
        id: GUEST_ACCOUNT_ID,
        group_id: GROUP_IDS.guest,
        show_online: 0,
        profile_view_privacy: "self",
        email_verified: 1,
      },
      {
        id: author.id,
        group_id: GROUP_IDS.member,
        show_online: 1,
        profile_view_privacy: "everyone",
        email_verified: 0,
      },
    ]);
    // No password: there is nothing to sign in with.
    expect(
      ctx.sqlite.prepare("SELECT id FROM auth_account WHERE user_id = ?1").all(GUEST_ACCOUNT_ID),
    ).toEqual([]);
    // New accounts keep their ids after it.
    expect(insertUser(ctx).id).toBe(author.id + 1);
  });
});
