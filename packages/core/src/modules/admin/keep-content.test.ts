import { afterEach, describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { ForbiddenError, NotFoundError } from "../../errors";
import { registerJobHandlers, runDueJobs, startScheduler } from "../jobs";
import { atomFeed, threadMarkdown } from "../seo";
import { readSiteSettings, storeSiteSettings } from "../settings";
import { accounts, closeAll, PASSWORD, type TestCtx } from "./fixtures.test";
import {
  KEEP_CONTENT_CHUNK,
  KEEP_CONTENT_JOB,
  keepContentSql,
  scheduleKeptContent,
} from "./keep-content";

afterEach(closeAll);

const ADDRESS = "leaver@example.test";

const pending = (ctx: TestCtx) =>
  ctx.sqlite
    .prepare<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM jobs WHERE type = ?1 AND status IN ('pending', 'running')",
    )
    .get(KEEP_CONTENT_JOB)!.n;

/** Runs the job to its end, moving the clock past each pause between chunks; returns the chunks run. */
async function settle(ctx: TestCtx): Promise<number> {
  let chunks = 0;
  for (; pending(ctx) > 0 && chunks < 200; chunks++) {
    ctx.clock.advance(1_000);
    await runDueJobs(ctx, { limit: 1 });
  }
  return chunks;
}

/** A member who wrote in every place content lives, beside a member who answered them. */
async function world() {
  const w = await accounts();
  registerJobHandlers(w.ctx);
  const founder = await w.register("Founder", 4);
  const leaver = await w.register("Leaver");
  const fan = await w.register("Fan");
  const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
  invalidate(w.ctx, "node_tree");
  const mine = await w.run("threads.create", leaver.actor, {
    nodeId: node.id,
    title: "Their thread",
    body: "Their words",
  });
  const theirs = await w.run("threads.create", fan.actor, {
    nodeId: node.id,
    title: "Fan thread",
    body: "Fan words",
  });
  // The fan quotes the leaver before the account closes; the leaver answers last in the fan's thread.
  const quoting = await w.run("posts.create", fan.actor, {
    threadId: mine.thread.id,
    body: `[QUOTE="post: ${mine.post.id}"]Their words[/QUOTE]\n\nAgreed.`,
  });
  const answer = await w.run("posts.create", leaver.actor, {
    threadId: theirs.thread.id,
    body: "Leaver answer",
  });
  // The leaver's wall (a post by the fan, a comment by the leaver), and the leaver's writing on the fan's wall.
  const ownWall = await w.run("profilePosts.create", fan.actor, {
    userId: leaver.id,
    body: "Hello leaver",
  });
  await w.run("profileComments.create", leaver.actor, {
    profilePostId: ownWall.id,
    body: "Thanks",
  });
  const fanWall = await w.run("profilePosts.create", fan.actor, {
    userId: fan.id,
    body: "Fan wall",
  });
  const onFanWall = await w.run("profilePosts.create", leaver.actor, {
    userId: fan.id,
    body: "Leaver on the fan wall",
  });
  await w.run("profileComments.create", leaver.actor, {
    profilePostId: fanWall.id,
    body: "Leaver comment on the fan wall",
  });
  const talk = await w.run("conversations.create", leaver.actor, {
    title: "Private",
    recipientIds: [fan.id],
    body: "First message",
  });
  const count = (sql: string, ...params: (number | string)[]) =>
    w.ctx.sqlite.prepare<{ n: number }, (number | string)[]>(sql).get(...params)!.n;
  const nodeRow = () =>
    w.ctx.sqlite
      .prepare<Record<string, unknown>, [number]>(
        "SELECT thread_count, post_count, last_post_id, last_poster_id FROM nodes WHERE id = ?1",
      )
      .get(node.id)!;
  const deleteAccount = () => w.run("users.deleteOwnAccount", leaver.actor, { password: PASSWORD });
  return {
    ...w,
    founder,
    leaver,
    fan,
    node,
    mine,
    theirs,
    quoting,
    answer,
    ownWall,
    fanWall,
    onFanWall,
    talk,
    count,
    nodeRow,
    deleteAccount,
  };
}

const GUEST_WITHOUT_NAME = { kind: "guest", name: null };

describe("a member who deletes their account", () => {
  test("keeps their threads and posts, shown as written by a guest with no name", async () => {
    const w = await world();
    const before = w.nodeRow();
    await w.deleteAccount();
    await settle(w.ctx);

    const mine = await w.run("threads.get", GUEST, { threadId: w.mine.thread.id });
    expect(mine.thread.author).toEqual(GUEST_WITHOUT_NAME);
    expect(JSON.stringify(mine)).not.toMatch(/Leaver|Deleted member/);
    const theirs = await w.run("threads.get", GUEST, { threadId: w.theirs.thread.id });
    expect(theirs.thread.lastPost.user).toEqual(GUEST_WITHOUT_NAME);
    expect(theirs.thread.author).toMatchObject({ kind: "member", username: "Fan" });

    const posts = await w.run("posts.list", GUEST, { threadId: w.mine.thread.id });
    expect(posts.items.map((post: { author: unknown }) => post.author)).toEqual([
      GUEST_WITHOUT_NAME,
      { kind: "member", id: w.fan.id, username: "Fan" },
    ]);
    const answers = await w.run("posts.list", GUEST, { threadId: w.theirs.thread.id });
    expect(answers.items[1].author).toEqual(GUEST_WITHOUT_NAME);

    const listed = await w.run("threads.list", GUEST, { nodeId: w.node.id });
    expect(listed.items.map((thread: { author: unknown }) => thread.author)).toContainEqual(
      GUEST_WITHOUT_NAME,
    );

    // Nothing of the member is left on the content, and the forum's figures are what they were.
    for (const table of ["threads", "posts"])
      expect(w.count(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`, w.leaver.id)).toBe(0);
    expect(
      w.count("SELECT count(*) AS n FROM threads WHERE last_poster_id = ?1", w.leaver.id),
    ).toBe(0);
    expect(w.nodeRow()).toMatchObject({
      thread_count: before.thread_count,
      post_count: before.post_count,
      last_post_id: before.last_post_id,
      last_poster_id: GUEST_ACCOUNT_ID,
    });
    expect(w.count("SELECT post_count AS n FROM users WHERE id = ?1", w.leaver.id)).toBe(0);
    expect(
      w.count("SELECT guest_name IS NULL AS n FROM posts WHERE user_id = ?1 LIMIT 1", -2),
    ).toBe(1);
  });

  test("leaves what other members quoted of them as it was written", async () => {
    const w = await world();
    const html = () =>
      w.ctx.sqlite
        .prepare<{ body_html: string }, [number]>(
          "SELECT body_html FROM post_bodies WHERE post_id = ?1",
        )
        .get(w.quoting.id)!.body_html;
    const before = html();
    expect(before).toContain("Leaver");
    await w.deleteAccount();
    await settle(w.ctx);
    expect(html()).toBe(before);
  });

  test("closes the profile and takes the wall with it, but keeps what they wrote on other walls", async () => {
    const w = await world();
    await w.deleteAccount();
    // At once, before the content is moved.
    await expect(w.run("profiles.get", GUEST, { userId: w.leaver.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await settle(w.ctx);
    await expect(
      w.run("profiles.get", w.fan.actor, { userId: w.leaver.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      w.count("SELECT count(*) AS n FROM profile_posts WHERE profile_user_id = ?1", w.leaver.id),
    ).toBe(0);
    expect(
      w.count(
        "SELECT count(*) AS n FROM profile_post_comments WHERE profile_post_id = ?1",
        w.ownWall.id,
      ),
    ).toBe(0);
    // Their wall post and comment on the fan's wall stay under the reserved account.
    const wall = await w.run("profilePosts.list", w.fan.actor, { userId: w.fan.id });
    const posted = wall.items.find((post: { id: number }) => post.id === w.onFanWall.id);
    expect(posted.author).toEqual(GUEST_WITHOUT_NAME);
    const commented = wall.items.find((post: { id: number }) => post.id === w.fanWall.id);
    expect(commented.latestComments[0].author).toEqual(GUEST_WITHOUT_NAME);
    for (const table of ["profile_posts", "profile_post_comments"])
      expect(w.count(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`, w.leaver.id)).toBe(0);
  });

  test("keeps their conversation messages under the reserved account", async () => {
    const w = await world();
    await w.deleteAccount();
    await settle(w.ctx);
    const messages = await w.run("conversations.listMessages", w.fan.actor, {
      conversationId: w.talk.conversation.id,
    });
    expect(messages.items.map((message: { author: unknown }) => message.author)).toEqual([
      GUEST_WITHOUT_NAME,
    ]);
    const talk = await w.run("conversations.get", w.fan.actor, {
      conversationId: w.talk.conversation.id,
    });
    expect(talk.lastMessage.user).toEqual(GUEST_WITHOUT_NAME);
  });

  test("a moderator reading a reported message of a deleted member sees a guest", async () => {
    const w = await world();
    await w.deleteAccount();
    await settle(w.ctx);
    const reported = await w.run("reports.create", w.fan.actor, {
      target: { type: "conversation_message", id: w.talk.message.id },
      reason: "Rude",
    });
    const read = await w.run("reports.viewConversationMessage", w.founder.actor, {
      groupId: reported.groupId,
    });
    expect(read.messages.map((message: { author: unknown }) => message.author)).toEqual([
      GUEST_WITHOUT_NAME,
    ]);
  });

  test("a new quote of their post cites the site's word for a guest, with no member reference", async () => {
    const w = await world();
    storeSiteSettings(w.ctx, { ...readSiteSettings(w.ctx), defaultLanguage: "es" });
    await w.deleteAccount();
    await settle(w.ctx);
    const quoting = await w.run("posts.create", w.fan.actor, {
      threadId: w.theirs.thread.id,
      body: `[QUOTE="someone, post: ${w.answer.id}"]Leaver answer[/QUOTE] Agreed`,
    });
    expect(quoting.bodySource).toBe(
      `[QUOTE="Invitado, post: ${w.answer.id}"]Leaver answer[/QUOTE] Agreed`,
    );
    expect(quoting.bodyHtml).toMatch(
      new RegExp(`<a href="/posts/${w.answer.id}"[^>]*>Invitado</a></cite>`),
    );
    expect(
      w.count("SELECT count(*) AS n FROM content_quotes WHERE content_id = ?1", quoting.id),
    ).toBe(0);
  });

  test("a new quote of their conversation message cites the site's word for a guest, with no member", async () => {
    const w = await world();
    storeSiteSettings(w.ctx, { ...readSiteSettings(w.ctx), defaultLanguage: "es" });
    await w.deleteAccount();
    await settle(w.ctx);
    const reply = await w.run("conversations.reply", w.fan.actor, {
      conversationId: w.talk.conversation.id,
      body: `[QUOTE="someone, convMessage: ${w.talk.message.id}"]First message[/QUOTE] Agreed`,
    });
    const source = w.ctx.sqlite
      .prepare<{ body_source: string }, [number]>(
        "SELECT body_source FROM conversation_messages WHERE id = ?1",
      )
      .get(reply.id)!.body_source;
    expect(source).toContain(`"Invitado, convMessage: ${w.talk.message.id}"`);
    expect(source).not.toContain("member:");
    expect(reply.bodyHtml).toContain("Invitado");
  });

  test("frees the username and the address for a new sign-up", async () => {
    const w = await world();
    await w.deleteAccount();
    const again = await w.register("Leaver");
    expect(again.id).not.toBe(w.leaver.id);
    expect(await w.signIn(ADDRESS)).toBeDefined();
  });

  test("moves a large account in several short transactions", async () => {
    const w = await world();
    const rows = KEEP_CONTENT_CHUNK * 2 + 5;
    const insertPost = w.ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const insertBody = w.ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html, body_text) VALUES (last_insert_rowid(), 'x', '<p>x</p>', 'x')",
    );
    for (let at = 0; at < rows; at++) {
      insertPost.run(w.theirs.thread.id, w.leaver.id, 100 + at, w.ctx.now());
      insertBody.run();
    }
    await w.deleteAccount();
    const chunks = await settle(w.ctx);
    expect(chunks).toBeGreaterThan(2);
    expect(w.count("SELECT count(*) AS n FROM posts WHERE user_id = ?1", w.leaver.id)).toBe(0);
    expect(w.count("SELECT count(*) AS n FROM posts WHERE user_id = ?1", GUEST_ACCOUNT_ID)).toBe(
      rows + 2,
    );
  });

  test("a member who is not signed in as themselves, or who cannot delete, moves nothing", async () => {
    const w = await world();
    await expect(
      w.run("users.deleteOwnAccount", w.fan.actor, { password: "wrong-wrong-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(pending(w.ctx)).toBe(0);
    expect(w.count("SELECT count(*) AS n FROM posts WHERE user_id = ?1", w.leaver.id)).toBe(2);
  });
});

describe("accounts erased before", () => {
  test("a self-deleted account still holding content is converted at start, and a second pass changes nothing", async () => {
    const w = await world();
    await w.deleteAccount();
    // As it stood before this change: the job never ran, the profile was never closed.
    w.ctx.sqlite.prepare("DELETE FROM jobs WHERE type = ?1").run(KEEP_CONTENT_JOB);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'everyone' WHERE id = ?1")
      .run(w.leaver.id);
    expect(w.count("SELECT count(*) AS n FROM posts WHERE user_id = ?1", w.leaver.id)).toBe(2);

    startScheduler(w.ctx)();
    expect(pending(w.ctx)).toBe(1);
    await settle(w.ctx);
    expect(w.count("SELECT count(*) AS n FROM posts WHERE user_id = ?1", w.leaver.id)).toBe(0);
    const theirs = await w.run("threads.get", GUEST, { threadId: w.theirs.thread.id });
    expect(theirs.thread.lastPost.user).toEqual(GUEST_WITHOUT_NAME);
    await expect(w.run("profiles.get", GUEST, { userId: w.leaver.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const snapshot = () =>
      JSON.stringify(
        [
          "threads",
          "posts",
          "profile_posts",
          "profile_post_comments",
          "conversation_messages",
          "nodes",
          "users",
        ].map((table) => w.ctx.sqlite.query(`SELECT * FROM ${table} ORDER BY id`).all()),
      );
    const converted = snapshot();
    scheduleKeptContent(w.ctx);
    expect(pending(w.ctx)).toBe(0);
    expect(snapshot()).toBe(converted);
  });

  test("an account an administrator erased keeps its content under its name", async () => {
    const w = await world();
    await w.run("users.adminErase", w.founder.actor, {
      userId: w.leaver.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    scheduleKeptContent(w.ctx);
    expect(pending(w.ctx)).toBe(0);
    const thread = await w.run("threads.get", GUEST, { threadId: w.mine.thread.id });
    expect(thread.thread.author).toMatchObject({
      kind: "member",
      username: `Deleted member ${w.leaver.id}`,
    });
    // Its profile opens, empty, as before.
    expect(await w.run("profiles.get", GUEST, { userId: w.leaver.id })).toMatchObject({
      about: "",
    });
  });
});

describe("the texts the backend writes itself", () => {
  const BASE = "https://forum.example.test";
  const siteLanguage = (w: Awaited<ReturnType<typeof world>>, language: "en" | "es") =>
    storeSiteSettings(w.ctx, { ...readSiteSettings(w.ctx), defaultLanguage: language });

  test.each([
    ["es", "Invitado"],
    ["en", "Guest"],
  ] as const)("name the author in the site's language (%s)", async (language, word) => {
    const w = await world();
    siteLanguage(w, language);
    await w.deleteAccount();
    await settle(w.ctx);
    const feed = atomFeed(w.ctx, BASE, "Forum");
    expect(feed).toContain(`<author><name>${word}</name></author>`);
    expect(feed).not.toContain("Deleted member");
    const page = threadMarkdown(w.ctx, BASE, w.mine.thread.id, "", 1);
    if (!("markdown" in page)) throw new Error("expected a page");
    expect(page.markdown).toContain(`started by ${word} on`);
    expect(page.markdown).toContain(`## ${word}, [`);
    expect(page.markdown).not.toContain("Deleted member");
  });
});

describe("the queries of one chunk", () => {
  test("each seeks content through its key", async () => {
    const w = await accounts();
    const chunk = [1, KEEP_CONTENT_CHUNK];
    expectNoTableScan(w.ctx, keepContentSql.threads, chunk);
    expectNoTableScan(w.ctx, keepContentSql.posts, chunk);
    expectNoTableScan(w.ctx, keepContentSql.profilePosts, chunk);
    expectNoTableScan(w.ctx, keepContentSql.comments, chunk);
    expectNoTableScan(w.ctx, keepContentSql.messages, chunk);
    expectNoTableScan(w.ctx, keepContentSql.wall, [1]);
    expectNoTableScan(w.ctx, keepContentSql.wallComments, chunk);
    expectNoTableScan(w.ctx, keepContentSql.threadsMoved, [-2, 1, JSON.stringify([1])]);
    expectNoTableScan(w.ctx, keepContentSql.postsMoved, [-2, JSON.stringify([1])]);
    expectNoTableScan(w.ctx, keepContentSql.lastPosters, [-2, JSON.stringify([1]), 1]);
    expectNoTableScan(w.ctx, keepContentSql.tagAuthors, [-2, JSON.stringify([1])]);
    expectNoTableScan(w.ctx, keepContentSql.messagesMoved, [-2, JSON.stringify([1])]);
    expectNoTableScan(w.ctx, keepContentSql.lastMessageUsers, [-2, JSON.stringify([1]), 1]);
  });
});
