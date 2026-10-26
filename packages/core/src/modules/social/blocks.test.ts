import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { type Actor, GUEST } from "../../actor";
import { NotFoundError } from "../../errors";
import { dispatchEvents } from "../../events";
import { blockPurgeSql, purgeBlockedConversations } from "../conversations/block-purge";
import { conversationBlockSql } from "../conversations/blocks";
import { type World, world } from "../feed/fixtures.test";
import { forumBlockSql } from "../forums/blocks";
import { runDueJobs } from "../jobs";
import { registerNotificationJobs } from "../notifications";
import { answerIds, colours, withPoll } from "../polls/fixtures.test";
import { PROFILE_ACCESS_SQL } from "../profiles/shared";
import { blockSql } from "./blocks";
import { quoteBlockSql, removeQuotes } from "./quotes";

// Carol blocks Bob in most scenes: the block is mutual, so each check runs both ways.

/** The fixture world with notifications delivered. */
function noticed() {
  const w = world();
  registerNotificationJobs(w.ctx);
  return w;
}
async function settle(w: World) {
  await dispatchEvents(w.ctx);
  await runDueJobs(w.ctx);
}
async function block(w: World, who: Actor, whom: { id: number }) {
  await w.call("users.block", who, { userId: whom.id });
}
function reactionType(w: World): number {
  return w.ctx.sqlite
    .prepare<{ id: number }, []>("SELECT id FROM reaction_types WHERE is_active = 1 LIMIT 1")
    .get()!.id;
}
async function noticeTypes(w: World, actor: Actor): Promise<string[]> {
  const { items } = await w.call("notifications.list", actor, { limit: 50 });
  return items.map((item: { type: string }) => item.type);
}
const ids = (items: { id: number }[]) => items.map((item) => item.id);

describe("block: threads and posts", () => {
  test("posts of the other member are left out of a thread and not found, both ways", async () => {
    const w = world();
    const { thread } = await w.thread(w.alice, w.open.id, "Shared");
    const bobPost = await w.reply(w.bob, thread.id, "bob says");
    const carolPost = await w.reply(w.carol, thread.id, "carol says");
    await block(w, w.carol, w.bobUser);
    const authors = async (actor: Actor) =>
      (await w.call("posts.list", actor, { threadId: thread.id })).items.map(
        (post: { author: { id: number } }) => post.author.id,
      );
    expect(await authors(w.carol)).toEqual([w.aliceUser.id, w.carolUser.id]);
    expect(await authors(w.bob)).toEqual([w.aliceUser.id, w.bobUser.id]);
    expect(await authors(w.alice)).toHaveLength(3);
    await expect(w.call("posts.get", w.carol, { postId: bobPost.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.call("posts.get", w.bob, { postId: carolPost.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a thread started by the other member is neither listed nor found", async () => {
    const w = world();
    const { thread: bobs } = await w.thread(w.bob, w.open.id, "Bobs");
    const { thread: carols } = await w.thread(w.carol, w.open.id, "Carols");
    await block(w, w.carol, w.bobUser);
    const listed = async (actor: Actor) =>
      ids((await w.call("threads.list", actor, { nodeId: w.open.id })).items);
    expect(await listed(w.carol)).toEqual([carols.id]);
    expect(await listed(w.bob)).toEqual([bobs.id]);
    expect(await listed(w.alice)).toEqual([carols.id, bobs.id]);
    await expect(w.call("threads.get", w.carol, { threadId: bobs.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.call("threads.get", w.bob, { threadId: carols.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      w.call("posts.create", w.bob, { threadId: carols.id, body: "reply" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("where the other member posted last, lists show the newest post before theirs", async () => {
    const w = world();
    const { thread } = await w.thread(w.alice, w.open.id, "Busy");
    const alicePost = await w.reply(w.alice, thread.id, "alice reply");
    await w.reply(w.bob, thread.id, "bob last");
    await block(w, w.carol, w.bobUser);
    const [listed] = (await w.call("threads.list", w.carol, { nodeId: w.open.id })).items;
    expect(listed.lastPost.user.id).toBe(w.aliceUser.id);
    expect(listed.lastPost.postId).toBe(alicePost.id);
    const [forAlice] = (await w.call("threads.list", w.alice, { nodeId: w.open.id })).items;
    expect(forAlice.lastPost.user.id).toBe(w.bobUser.id);
    // The forum's own newest post is not shown to Carol at all.
    const node = (await w.call("nodes.list", w.carol, {})).items.find(
      (item: { id: number }) => item.id === w.open.id,
    );
    expect(node.lastPost).toBeNull();
    const forBob = (await w.call("nodes.list", w.bob, {})).items.find(
      (item: { id: number }) => item.id === w.open.id,
    );
    expect(forBob.lastPost.user.id).toBe(w.bobUser.id);
  });

  test("a quote of the other member is taken out of a third member's post", async () => {
    const w = world();
    const { thread } = await w.thread(w.alice, w.open.id, "Quotes");
    const bobPost = await w.reply(w.bob, thread.id, "bob words");
    const quoting = await w.reply(
      w.alice,
      thread.id,
      `[QUOTE="bob, post: ${bobPost.id}, member: ${w.bobUser.id}"]bob words[/QUOTE]alice answer`,
    );
    await block(w, w.carol, w.bobUser);
    const body = async (actor: Actor) =>
      (await w.call("posts.get", actor, { postId: quoting.id })).bodyHtml as string;
    expect(await body(w.alice)).toContain("bob words");
    const forCarol = await body(w.carol);
    expect(forCarol).not.toContain("bob words");
    expect(forCarol).toContain("alice answer");
  });

  test("search leaves out the other member's posts and threads, and members", async () => {
    const w = world();
    const { thread } = await w.thread(w.bob, w.open.id, "Zebra crossing");
    await w.reply(w.alice, thread.id, "zebra in bob's thread");
    await w.thread(w.alice, w.open.id, "Zebra alone");
    await block(w, w.carol, w.bobUser);
    const found = async (actor: Actor) =>
      (await w.call("search.query", actor, { q: "zebra" })).items.length;
    expect(await found(w.alice)).toBe(3);
    expect(await found(w.carol)).toBe(1);
    const names = async (actor: Actor, prefix: string) =>
      (await w.call("users.search", actor, { prefix })).items.map(
        (item: { username: string }) => item.username,
      );
    expect(await names(w.carol, "bo")).toEqual([]);
    expect(await names(w.bob, "car")).toEqual([]);
    expect(await names(w.alice, "bo")).toEqual(["bob"]);
  });
});

describe("block: reactions, follows and notifications", () => {
  test("neither reacts to the other, and reaction lists leave them out", async () => {
    const w = world();
    const { thread } = await w.thread(w.alice, w.open.id, "Reacted");
    const alicePost = await w.reply(w.alice, thread.id, "alice post");
    const type = reactionType(w);
    const ref = { contentType: "post", contentId: alicePost.id };
    await w.call("reactions.set", w.bob, { ...ref, reactionTypeId: type });
    await w.call("reactions.set", w.carol, { ...ref, reactionTypeId: type });
    await block(w, w.carol, w.bobUser);
    const reactors = async (actor: Actor) =>
      (await w.call("reactions.list", actor, ref)).items.map(
        (item: { user: { id: number } }) => item.user.id,
      );
    expect(await reactors(w.carol)).toEqual([w.carolUser.id]);
    expect(await reactors(w.bob)).toEqual([w.bobUser.id]);
    const carolPost = await w.reply(w.carol, thread.id, "carol post");
    await expect(
      w.call("reactions.set", w.bob, {
        contentType: "post",
        contentId: carolPost.id,
        reactionTypeId: type,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a block ends the follows between the two, and neither can follow again", async () => {
    const w = world();
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    await w.call("users.follow", w.bob, { userId: w.carolUser.id });
    await block(w, w.carol, w.bobUser);
    const counts = w.ctx.sqlite
      .prepare<{ follower_count: number; following_count: number }, [number]>(
        "SELECT follower_count, following_count FROM users WHERE id = ?1",
      )
      .get(w.bobUser.id);
    expect(counts).toEqual({ follower_count: 0, following_count: 0 });
    expect(w.ctx.sqlite.prepare("SELECT id FROM user_follows").all()).toEqual([]);
    await expect(w.call("users.follow", w.carol, { userId: w.bobUser.id })).rejects.toThrow();
    await expect(w.call("users.follow", w.bob, { userId: w.carolUser.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("replies, mentions and quotes of the other member notify nobody across the block", async () => {
    const w = noticed();
    const { thread } = await w.thread(w.carol, w.open.id, "Watched by carol");
    await w.call("threads.watch", w.bob, { threadId: thread.id });
    const { thread: other } = await w.thread(w.alice, w.open.id, "Open talk");
    const carolPost = await w.reply(w.carol, other.id, "carol words");
    await block(w, w.carol, w.bobUser);
    await w.reply(w.bob, other.id, "@carol hello");
    await w.reply(
      w.bob,
      other.id,
      `[QUOTE="carol, post: ${carolPost.id}, member: ${w.carolUser.id}"]carol words[/QUOTE]yes`,
    );
    await w.reply(w.carol, other.id, "@bob hello");
    await settle(w);
    expect(await noticeTypes(w, w.carol)).toEqual([]);
    expect(await noticeTypes(w, w.bob)).toEqual([]);
    // Alice, outside the block, still hears of both.
    await w.reply(w.alice, other.id, "@carol @bob hi");
    await settle(w);
    expect(await noticeTypes(w, w.carol)).toEqual(["content.mentioned"]);
    expect(await noticeTypes(w, w.bob)).toEqual(["content.mentioned"]);
  });

  test("an older notice from the other member is left out of the list", async () => {
    const w = noticed();
    const { thread } = await w.thread(w.carol, w.open.id, "Old");
    await w.reply(w.bob, thread.id, "@carol before the block");
    await settle(w);
    expect(await noticeTypes(w, w.carol)).toEqual(["content.mentioned"]);
    await block(w, w.carol, w.bobUser);
    expect(await noticeTypes(w, w.carol)).toEqual([]);
    await w.call("users.unblock", w.carol, { userId: w.bobUser.id });
    expect(await noticeTypes(w, w.carol)).toEqual(["content.mentioned"]);
  });
});

describe("block: profiles, cards and member lists", () => {
  test("the member blocked finds no profile or card; the blocker still opens theirs to unblock", async () => {
    const w = world();
    await block(w, w.carol, w.bobUser);
    await expect(w.call("profiles.get", w.bob, { userId: w.carolUser.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const seen = await w.call("profiles.get", w.carol, { userId: w.bobUser.id });
    expect(seen.viewer).toEqual({ isFollowing: false, isBlocking: true });
    const cards = async (actor: Actor, id: number) =>
      (await w.call("users.cards", actor, { userIds: [id] })).items.length;
    expect(await cards(w.bob, w.carolUser.id)).toBe(0);
    expect(await cards(w.carol, w.bobUser.id)).toBe(1);
    expect(await cards(w.alice, w.carolUser.id)).toBe(1);
  });

  test("wall posts and comments of the other member are left out, the feed's included", async () => {
    const w = world();
    const wall = await w.wall(w.alice, w.aliceUser.id, "alice wall");
    await w.call("profileComments.create", w.bob, { profilePostId: wall.id, body: "bob comment" });
    await w.call("profileComments.create", w.carol, {
      profilePostId: wall.id,
      body: "carol comment",
    });
    await w.wall(w.bob, w.aliceUser.id, "bob wall");
    await block(w, w.carol, w.bobUser);
    const listed = async (actor: Actor) =>
      (await w.call("profilePosts.list", actor, { userId: w.aliceUser.id })).items;
    const forCarol = await listed(w.carol);
    expect(forCarol.map((post: { id: number }) => post.id)).toEqual([wall.id]);
    expect(
      forCarol[0].latestComments.map((comment: { author: { id: number } }) => comment.author.id),
    ).toEqual([w.carolUser.id]);
    const comments = async (actor: Actor) =>
      (await w.call("profileComments.list", actor, { profilePostId: wall.id })).items.map(
        (comment: { author: { id: number } }) => comment.author.id,
      );
    expect(await comments(w.bob)).toEqual([w.bobUser.id]);
    // What's new: the wall post is there, the other member's comment under it is not.
    const feed = (await w.call("feed.list", w.carol, {})).items as {
      profilePost?: {
        id: number;
        author: { id: number };
        latestComments: { author: { id: number } }[];
      };
    }[];
    const entry = feed.find((item) => item.profilePost?.id === wall.id);
    expect(entry?.profilePost?.latestComments.map((comment) => comment.author.id)).toEqual([
      w.carolUser.id,
    ]);
    expect(feed.some((item) => item.profilePost?.author.id === w.bobUser.id)).toBe(false);
  });

  test("member lists leave the other member out: directory, followers, online", async () => {
    const w = world();
    await w.call("users.follow", w.alice, { userId: w.bobUser.id });
    await w.call("users.follow", w.alice, { userId: w.carolUser.id });
    w.ctx.sqlite.prepare("UPDATE users SET follower_count = 0, following_count = 0").run();
    await block(w, w.carol, w.bobUser);
    const directory = async (actor: Actor) =>
      (await w.call("users.list", actor, { limit: 50 })).items.map(
        (item: { card: { id: number } }) => item.card.id,
      );
    expect(await directory(w.carol)).not.toContain(w.bobUser.id);
    expect(await directory(w.bob)).not.toContain(w.carolUser.id);
    expect(await directory(w.alice)).toContain(w.bobUser.id);
    const following = async (actor: Actor) =>
      (await w.call("users.listFollowing", actor, { userId: w.aliceUser.id, limit: 10 })).items.map(
        (item: { user: { id: number } }) => item.user.id,
      );
    expect(await following(w.carol)).toEqual([w.carolUser.id]);
    expect(await following(w.bob)).toEqual([w.bobUser.id]);
  });

  test("an unblock brings back public content but not what the block hid", async () => {
    const w = world();
    const { thread } = await w.thread(w.alice, w.open.id, "Again");
    await w.reply(w.bob, thread.id, "bob reply");
    await block(w, w.carol, w.bobUser);
    expect((await w.call("posts.list", w.carol, { threadId: thread.id })).items).toHaveLength(1);
    await w.call("users.unblock", w.carol, { userId: w.bobUser.id });
    expect((await w.call("posts.list", w.carol, { threadId: thread.id })).items).toHaveLength(2);
    expect((await w.call("profiles.get", w.bob, { userId: w.carolUser.id })).id).toBe(
      w.carolUser.id,
    );
  });
});

describe("block: staff", () => {
  test("a member can block staff; staff still see that member and moderate them", async () => {
    const w = noticed();
    const modUser = { id: (w.mod as { userId: number }).userId };
    const { thread } = await w.thread(w.mod, w.open.id, "Rules");
    const carolPost = await w.reply(w.carol, thread.id, "carol post");
    await block(w, w.carol, modUser);
    // Carol no longer sees the moderator's thread.
    await expect(w.call("threads.get", w.carol, { threadId: thread.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // The moderator sees Carol and her content, and acts on it.
    expect((await w.call("profiles.get", w.mod, { userId: w.carolUser.id })).id).toBe(
      w.carolUser.id,
    );
    expect(
      (await w.call("posts.list", w.mod, { threadId: thread.id })).items.map(
        (post: { id: number }) => post.id,
      ),
    ).toContain(carolPost.id);
    await w.call("posts.delete", w.mod, { postId: carolPost.id, reason: "off topic" });
    await w.call("warnings.create", w.mod, {
      userId: w.carolUser.id,
      points: 1,
      reason: "Rude",
    });
    await settle(w);
    // Official notices reach the member who blocked the moderator.
    expect(await noticeTypes(w, w.carol)).toContain("moderation.member");
  });
});

describe("block: conversations", () => {
  async function talk(w: World, from: Actor, to: { id: number }[], title = "Talk") {
    return w.call("conversations.create", from, {
      recipientIds: to.map((user) => user.id),
      title,
      body: `${title} first`,
    });
  }
  const inbox = async (w: World, actor: Actor) =>
    (await w.call("conversations.list", actor, { limit: 20 })).items.map(
      (item: { id: number }) => item.id,
    );
  const messages = async (w: World, actor: Actor, conversationId: number) =>
    (await w.call("conversations.listMessages", actor, { conversationId, limit: 50 })).items.map(
      (item: { author: { id: number } }) => item.author.id,
    );

  test("a new block hides the private conversations of the two, for both, for good", async () => {
    const w = world();
    const pair = await talk(w, w.carol, [w.bobUser]);
    const group = await talk(w, w.carol, [w.bobUser, w.aliceUser], "Group");
    await block(w, w.carol, w.bobUser);
    expect(await inbox(w, w.carol)).toEqual([group.conversation.id]);
    expect(await inbox(w, w.bob)).toEqual([group.conversation.id]);
    for (const actor of [w.carol, w.bob])
      await expect(
        w.call("conversations.get", actor, { conversationId: pair.conversation.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    await w.call("users.unblock", w.carol, { userId: w.bobUser.id });
    expect(await inbox(w, w.carol)).toEqual([group.conversation.id]);
    expect(await inbox(w, w.bob)).toEqual([group.conversation.id]);
    // Neither can start a new one while the block stands.
    await block(w, w.bob, w.carolUser);
    await expect(talk(w, w.carol, [w.bobUser])).rejects.toThrow();
    await expect(talk(w, w.bob, [w.carolUser])).rejects.toThrow();
  });

  test("in a group, messages sent after the block are hidden between the two only", async () => {
    const w = noticed();
    const group = await talk(w, w.alice, [w.bobUser, w.carolUser], "Group");
    const id = group.conversation.id;
    const reply = (actor: Actor, body: string) =>
      w.call("conversations.reply", actor, { conversationId: id, body });
    await reply(w.bob, "bob before");
    await block(w, w.carol, w.bobUser);
    await reply(w.bob, "bob after");
    await reply(w.carol, "carol after");
    const a = w.aliceUser.id;
    const b = w.bobUser.id;
    const c = w.carolUser.id;
    expect(await messages(w, w.carol, id)).toEqual([a, b, c]);
    expect(await messages(w, w.bob, id)).toEqual([a, b, b]);
    expect(await messages(w, w.alice, id)).toEqual([a, b, b, c]);
    // Nor is Bob alerted to Carol's message.
    await settle(w);
    const { items: alerts } = await w.call("notifications.list", w.bob, { limit: 50 });
    expect(
      alerts.flatMap((item: { actors: { id: number }[] }) => item.actors.map((actor) => actor.id)),
    ).not.toContain(c);
    expect(alerts.length).toBeGreaterThan(0);
    // The inbox does not tell Bob that Carol wrote last, nor show it unread.
    const [entry] = (await w.call("conversations.list", w.bob, { limit: 5 })).items;
    expect(entry.lastMessage.user.id).toBe(b);
    expect(entry.isUnread).toBe(false);
    // An unblock leaves what was hidden hidden; new messages show again.
    await w.call("users.unblock", w.carol, { userId: b });
    await reply(w.bob, "bob later");
    expect(await messages(w, w.carol, id)).toEqual([a, b, c, b]);
  });

  test("a member added to a group does not see the messages of a member in a block with them", async () => {
    const w = world();
    const group = await talk(w, w.alice, [w.bobUser], "Group");
    const id = group.conversation.id;
    await w.call("conversations.reply", w.bob, { conversationId: id, body: "bob" });
    await block(w, w.carol, w.bobUser);
    await w.call("conversations.addParticipants", w.alice, {
      conversationId: id,
      userIds: [w.carolUser.id],
    });
    expect(await messages(w, w.carol, id)).toEqual([w.aliceUser.id]);
  });

  test("staff blocked by a member keep the private conversation, and still reach the member", async () => {
    const w = world();
    const modUser = { id: (w.mod as { userId: number }).userId };
    const pair = await talk(w, w.mod, [w.carolUser]);
    await block(w, w.carol, modUser);
    expect(await inbox(w, w.carol)).toEqual([]);
    expect(await inbox(w, w.mod)).toEqual([pair.conversation.id]);
    const fresh = await talk(w, w.mod, [w.carolUser], "Official");
    expect(await inbox(w, w.carol)).toEqual([fresh.conversation.id]);
    await w.call("conversations.reply", w.mod, {
      conversationId: fresh.conversation.id,
      body: "please read",
    });
    expect(await messages(w, w.carol, fresh.conversation.id)).toEqual([modUser.id, modUser.id]);
    // Hidden from one side only: never purged.
    w.ctx.clock.advance(91 * 86_400_000);
    expect(await purgeBlockedConversations(w.ctx)).toBe(0);
    expect(await inbox(w, w.mod)).toContain(pair.conversation.id);
  });

  test("the purge deletes a hidden conversation 90 days after the block, not before", async () => {
    const w = world();
    const pair = await talk(w, w.carol, [w.bobUser]);
    await w.call("conversations.reply", w.bob, {
      conversationId: pair.conversation.id,
      body: "bob reply",
    });
    const kept = await talk(w, w.carol, [w.aliceUser]);
    await block(w, w.carol, w.bobUser);
    const exists = (id: number) =>
      !!w.ctx.sqlite.prepare("SELECT id FROM conversations WHERE id = ?1").get(id);
    w.ctx.clock.advance(89 * 86_400_000);
    expect(await purgeBlockedConversations(w.ctx)).toBe(0);
    expect(exists(pair.conversation.id)).toBe(true);
    w.ctx.clock.advance(2 * 86_400_000);
    expect(await purgeBlockedConversations(w.ctx)).toBe(1);
    expect(exists(pair.conversation.id)).toBe(false);
    expect(exists(kept.conversation.id)).toBe(true);
    expect(
      w.ctx.sqlite
        .prepare("SELECT count(*) AS n FROM conversation_messages WHERE conversation_id = ?1")
        .get(pair.conversation.id),
    ).toEqual({ n: 0 });
    expect(await purgeBlockedConversations(w.ctx)).toBe(0);
  });

  test("a block converted from an ignore hides no conversation message, past or new", async () => {
    const w = world();
    const pair = await talk(w, w.carol, [w.bobUser]);
    const group = await talk(w, w.alice, [w.bobUser, w.carolUser], "Group");
    // As the migration converts it: a row that hides no conversation, nothing else done.
    w.ctx.sqlite
      .prepare(
        "INSERT INTO user_blocks (user_id, blocked_id, created_at, hides_conversations) VALUES (?1, ?2, 0, 0)",
      )
      .run(w.carolUser.id, w.bobUser.id);
    expect(await inbox(w, w.carol)).toContain(pair.conversation.id);
    expect(await inbox(w, w.bob)).toContain(pair.conversation.id);
    for (const conversationId of [pair.conversation.id, group.conversation.id]) {
      await w.call("conversations.reply", w.bob, { conversationId, body: "bob after" });
      await w.call("conversations.reply", w.carol, { conversationId, body: "carol after" });
    }
    const b = w.bobUser.id;
    const c = w.carolUser.id;
    expect(await messages(w, w.carol, pair.conversation.id)).toEqual([c, b, c]);
    expect(await messages(w, w.bob, pair.conversation.id)).toEqual([c, b, c]);
    expect(await messages(w, w.carol, group.conversation.id)).toEqual([w.aliceUser.id, b, c]);
    expect(await messages(w, w.bob, group.conversation.id)).toEqual([w.aliceUser.id, b, c]);
    // A member added later sees the converted pair's messages too.
    const later = await talk(w, w.alice, [w.bobUser], "Later");
    await w.call("conversations.reply", w.bob, {
      conversationId: later.conversation.id,
      body: "bob",
    });
    await w.call("conversations.addParticipants", w.alice, {
      conversationId: later.conversation.id,
      userIds: [c],
    });
    expect(await messages(w, w.carol, later.conversation.id)).toEqual([w.aliceUser.id, b]);
    // The rest of the block holds: neither starts a conversation with the other.
    await expect(talk(w, w.bob, [w.carolUser])).rejects.toThrow();
  });

  test("the purge keeps a hidden conversation under an open report, and deletes it once closed", async () => {
    const w = world();
    const pair = await talk(w, w.carol, [w.bobUser]);
    const message = await w.call("conversations.reply", w.bob, {
      conversationId: pair.conversation.id,
      body: "rude",
    });
    await w.call("reports.create", w.carol, {
      target: { type: "conversation_message", id: message.id },
      reason: "rude",
    });
    await block(w, w.carol, w.bobUser);
    const exists = () =>
      !!w.ctx.sqlite
        .prepare("SELECT id FROM conversations WHERE id = ?1")
        .get(pair.conversation.id);
    w.ctx.clock.advance(91 * 86_400_000);
    expect(await purgeBlockedConversations(w.ctx)).toBe(0);
    expect(exists()).toBe(true);
    w.ctx.sqlite.prepare("UPDATE report_groups SET state = 'resolved'").run();
    expect(await purgeBlockedConversations(w.ctx)).toBe(1);
    expect(exists()).toBe(false);
  });
});

describe("block: notices, places, voters and page metadata", () => {
  test("a block clears the unread badge of what the list no longer shows", async () => {
    const w = noticed();
    const { thread } = await w.thread(w.carol, w.open.id, "Mine");
    await w.reply(w.bob, thread.id, "@carol one");
    await settle(w);
    const unread = async (actor: Actor) =>
      (await w.call("notifications.list", actor, { limit: 1 })).unreadCount;
    expect(await unread(w.carol)).toBe(1);
    await block(w, w.carol, w.bobUser);
    expect(await unread(w.carol)).toBe(0);
    expect(await noticeTypes(w, w.carol)).toEqual([]);
  });

  test("notices about a thread the other member started reach nobody across the block", async () => {
    const w = noticed();
    const { thread } = await w.thread(w.bob, w.open.id, "Bobs thread");
    await w.call("threads.watch", w.carol, { threadId: thread.id });
    await w.reply(w.alice, thread.id, "before");
    await settle(w);
    expect(await noticeTypes(w, w.carol)).toEqual(["thread.watched"]);
    await block(w, w.carol, w.bobUser);
    // The older notice is left out, and no new one comes.
    expect(await noticeTypes(w, w.carol)).toEqual([]);
    await w.reply(w.alice, thread.id, "@carol after");
    await settle(w);
    expect(await noticeTypes(w, w.carol)).toEqual([]);
  });

  test("activity, places and the newest member do not name the other member", async () => {
    const w = world();
    await block(w, w.bob, w.carolUser);
    w.ctx.sqlite
      .prepare("UPDATE users SET last_activity_at = ?1 WHERE id IN (?2, ?3)")
      .run(w.ctx.now(), w.bobUser.id, w.carolUser.id);
    const activity = async (actor: Actor, id: number) =>
      (await w.call("users.activity", actor, { userIds: [id] })).items.length;
    expect(await activity(w.carol, w.bobUser.id)).toBe(0);
    expect(await activity(w.bob, w.carolUser.id)).toBe(0);
    expect(await activity(w.alice, w.bobUser.id)).toBe(1);
    // Carol is the newest member: Bob, who blocked her, is not shown her card.
    const newest = async (actor: Actor) =>
      (await w.call("site.stats", actor, {})).latestMember?.id ?? null;
    expect(await newest(w.alice)).toBe(w.carolUser.id);
    expect(await newest(w.bob)).toBeNull();
  });

  test("the voters of a poll leave out the other member", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ results: "after_vote" }));
    const [red] = answerIds(poll);
    for (const actor of [w.bob, w.carol])
      await w.call("polls.vote", actor, {
        pollId: poll.id,
        questionId: poll.questions[0]!.id,
        answerIds: [red],
      });
    await block(w, w.carol, w.bobUser);
    const voters = async (actor: Actor) =>
      (await w.call("polls.voters", actor, { pollId: poll.id, answerId: red })).items.map(
        (item: { user: { id: number } }) => item.user.id,
      );
    expect(await voters(w.carol)).toEqual([w.carolUser.id]);
    expect(await voters(w.bob)).toEqual([w.bobUser.id]);
  });

  test("thread metadata follows threads.get for a signed-in viewer, and not for guests", async () => {
    const w = world();
    const { thread: bobs } = await w.thread(w.bob, w.open.id, "Bobs");
    const { thread } = await w.thread(w.alice, w.open.id, "Shared");
    await w.reply(w.bob, thread.id, "bob reply");
    await w.reply(w.alice, thread.id, "alice reply");
    await block(w, w.carol, w.bobUser);
    await expect(w.call("seo.thread", w.carol, { threadId: bobs.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const comments = async (actor: Actor) =>
      JSON.stringify((await w.call("seo.thread", actor, { threadId: thread.id })).jsonLd);
    expect(await comments(w.carol)).not.toContain("bob reply");
    expect(await comments(w.carol)).toContain("alice reply");
    expect(await comments(GUEST)).toContain("bob reply");
    expect((await w.call("seo.thread", GUEST, { threadId: bobs.id })).title).toContain("Bobs");
  });
});

test("the block queries use their indexes", () => {
  const w = world();
  expectNoTableScan(w.ctx, blockSql.among, [1, "[1,2]"]);
  expectNoTableScan(w.ctx, blockSql.pair, [1, 2]);
  expectNoTableScan(w.ctx, blockSql.all, [1]);
  expectNoTableScan(w.ctx, PROFILE_ACCESS_SQL, [1, "[1,2]"]);
  expectNoTableScan(w.ctx, conversationBlockSql.hidden, [1, "[1,2]"]);
  expectNoTableScan(w.ctx, conversationBlockSql.newestSeen, [1, 2]);
  expectNoTableScan(w.ctx, conversationBlockSql.privateOfPair, [1, 2]);
  expectNoTableScan(w.ctx, forumBlockSql.olderPosts, [1, 5, 20]);
  expectNoTableScan(w.ctx, forumBlockSql.starters, ["[1,2]"]);
  expectNoTableScan(w.ctx, quoteBlockSql.quoted, ["post", "[1,2]"]);
  expectNoTableScan(w.ctx, blockPurgeSql.due, [1]);
  expectNoTableScan(w.ctx, blockPurgeSql.messages, [1, 200]);
});

test("removeQuotes takes out the quotes of the given posts, nested ones too", () => {
  const quote = (id: number, inner = "") =>
    `<blockquote class="bb-quote quote" data-post-id="${id}"><cite class="bb-quote-author">x</cite>${inner}text ${id}</blockquote>`;
  const html = `<p>a</p>${quote(1, quote(2))}<p>b</p>${quote(3)}`;
  expect(removeQuotes(html, new Set([1]))).toBe(`<p>a</p><p>b</p>${quote(3)}`);
  expect(removeQuotes(html, new Set([2]))).toBe(`<p>a</p>${quote(1)}<p>b</p>${quote(3)}`);
  expect(removeQuotes(html, new Set([9]))).toBe(html);
});
