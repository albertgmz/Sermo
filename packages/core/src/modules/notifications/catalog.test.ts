import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { type DomainEvent, dispatchEvents, publishEvent } from "../../events";
import { type AnyOperation, execute } from "../../operation";
import { conversationsCreateOp, conversationsReplyOp } from "../conversations";
import {
  postsCreateOp,
  postsDeleteOp,
  postsRestoreOp,
  postsUpdateOp,
  threadsCreateOp,
  threadsMarkReadOp,
  threadsMergeOp,
  threadsRestoreOp,
  threadsSplitOp,
} from "../forums";
import { enqueueJob, runDueJobs } from "../jobs";
import { operations as moderationOperations } from "../moderation";
import {
  profileCommentsCreateOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsRestoreOp,
  profilePostsUpdateOp,
} from "../profiles";
import { reactionsSetOp } from "../reactions";
import { nodesWatchOp, threadsWatchOp, usersFollowOp } from "../social";
import {
  notificationsListOp,
  notificationsMarkReadOp,
  notificationsSetPreferencesOp,
  registerNotificationJobs,
} from "./index";

type TestCtx = ReturnType<typeof createTestContext>;
function fixture() {
  const ctx = createTestContext();
  registerNotificationJobs(ctx);
  const author = insertUser(ctx);
  const recipient = insertUser(ctx);
  const other = insertUser(ctx);
  const outsider = insertUser(ctx);
  const moderator = insertUser(ctx, { groupId: 3 });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const now = ctx.now();
  const threadId = Number(
    ctx.sqlite
      .prepare(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Topic', ?3, ?3, ?2)",
      )
      .run(node.id, author.id, now).lastInsertRowid,
  );
  const firstId = Number(
    ctx.sqlite
      .prepare(
        "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, ?3)",
      )
      .run(threadId, author.id, now).lastInsertRowid,
  );
  ctx.sqlite
    .prepare("UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2")
    .run(firstId, threadId);
  const postId = Number(
    ctx.sqlite
      .prepare(
        "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 1, ?3)",
      )
      .run(threadId, author.id, now).lastInsertRowid,
  );
  return { ctx, author, recipient, other, outsider, moderator, node, threadId, firstId, postId };
}
async function send(
  ctx: TestCtx,
  type: DomainEvent["type"],
  targetType: string,
  targetId: number,
  payload: Record<string, unknown> = {},
) {
  writeTx(ctx, () => publishEvent(ctx, { type, targetType, targetId, payload }));
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
}
async function types(ctx: TestCtx, user: { id: number; groupId: number }) {
  return (
    await execute(ctx, notificationsListOp, userActor(user), { unreadOnly: true, limit: 100 })
  ).items.map((item) => item.type);
}
async function clear(ctx: TestCtx, user: { id: number; groupId: number }) {
  await execute(ctx, notificationsMarkReadOp, userActor(user), { all: true });
  await runDueJobs(ctx);
}
async function unreadCount(ctx: TestCtx, user: { id: number; groupId: number }) {
  return (await execute(ctx, notificationsListOp, userActor(user), { unreadOnly: true, limit: 1 }))
    .unreadCount;
}
/** Posts and edits containing "holdme" go to moderation. */
function holdWord(ctx: TestCtx) {
  ctx.sqlite
    .prepare(
      "INSERT INTO word_filters (term, action, is_active, created_at, updated_at) VALUES ('holdme', 'moderate', 1, ?1, ?1)",
    )
    .run(ctx.now());
}
function moderationOp(name: string): AnyOperation {
  const op = moderationOperations.find((entry) => entry.name === name);
  if (!op) throw new Error(`Missing operation ${name}`);
  return op as AnyOperation;
}

describe("notification recipients", () => {
  test("first subscriber registration starts after existing events", async () => {
    const ctx = createTestContext();
    const author = insertUser(ctx);
    const recipient = insertUser(ctx);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "member.followed",
        targetType: "user",
        targetId: recipient.id,
        payload: { followerId: author.id },
      }),
    );
    registerNotificationJobs(ctx);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, recipient)).toEqual([]);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "member.followed",
        targetType: "user",
        targetId: recipient.id,
        payload: { followerId: author.id },
      }),
    );
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, recipient)).toEqual(["member.followed"]);
  });
  test("listing hides the title when the thread becomes hidden", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, nodesWatchOp, userActor(f.recipient), {
      nodeId: f.node.id,
      mode: "threads",
    });
    await send(ctx, "content.created", "thread", f.threadId);
    let page = await execute(ctx, notificationsListOp, userActor(f.recipient), { limit: 10 });
    expect(page.items[0]?.contentTitle).toBe("Topic");
    ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(f.threadId);
    page = await execute(ctx, notificationsListOp, userActor(f.recipient), { limit: 10 });
    expect(page.items[0]?.contentTitle).toBeNull();
  });
  test("real watch, follow, content, reaction and conversation operations deliver once", async () => {
    const f = fixture();
    const { ctx } = f;
    const author = userActor(f.author);
    const recipient = userActor(f.recipient);
    const other = userActor(f.other);
    await execute(ctx, nodesWatchOp, recipient, { nodeId: f.node.id, mode: "threads" });
    await execute(ctx, nodesWatchOp, other, { nodeId: f.node.id, mode: "posts" });
    await execute(ctx, usersFollowOp, userActor(f.outsider), { userId: f.author.id });
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: f.node.id,
      title: "Real thread",
      body: `Hello @${f.recipient.username}`,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.other)).toEqual(["node.thread"]);
    expect(await types(ctx, f.outsider)).toEqual(["member.thread"]);
    await clear(ctx, f.recipient);
    await execute(ctx, threadsWatchOp, recipient, { threadId: made.thread.id });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: made.thread.id,
      body: "reply",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    expect(await types(ctx, f.other)).toEqual(["node.post", "node.thread"]);
    await execute(ctx, reactionsSetOp, recipient, {
      contentType: "post",
      contentId: reply.id,
      reactionTypeId: 1,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect((await types(ctx, f.author)).includes("content.reaction")).toBe(true);
    const conversation = await execute(ctx, conversationsCreateOp, author, {
      title: "Real conversation",
      recipientIds: [f.recipient.id],
      body: "first",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(
      (await types(ctx, f.recipient)).filter((type) => type === "conversation.added"),
    ).toHaveLength(1);
    expect((await types(ctx, f.recipient)).includes("conversation.message")).toBe(false);
    await execute(ctx, conversationsReplyOp, author, {
      conversationId: conversation.conversation.id,
      body: "second",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect((await types(ctx, f.recipient)).includes("conversation.message")).toBe(true);
    expect(await types(ctx, f.outsider)).not.toContain("conversation.message");
  });
  test("a real new thread includes its first post quote in the single notice", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, nodesWatchOp, userActor(f.recipient), {
      nodeId: f.node.id,
      mode: "threads",
    });
    const made = await execute(ctx, threadsCreateOp, userActor(f.other), {
      nodeId: f.node.id,
      title: "Quoted first post",
      body: "An opening post",
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, ?4)",
      )
      .run(made.post.id, f.postId, f.recipient.id, ctx.now());
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.quoted"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(1);
  });
  test("approving a held thread includes first-post mentions and quotes once", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare(
        "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES ('post', ?1, ?2, ?3)",
      )
      .run(f.firstId, f.recipient.id, ctx.now());
    ctx.sqlite
      .prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, ?4)",
      )
      .run(f.firstId, f.postId, f.other.id, ctx.now());
    ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(f.threadId);
    await send(ctx, "content.created", "thread", f.threadId);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual([]);
    ctx.sqlite.prepare("UPDATE threads SET state = 'visible' WHERE id = ?1").run(f.threadId);
    await send(ctx, "content.state_changed", "thread", f.threadId, {
      previousState: "moderated",
      state: "visible",
    });
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.other)).toEqual(["content.quoted"]);
    await clear(ctx, f.recipient);
    await clear(ctx, f.other);
    await send(ctx, "content.state_changed", "thread", f.threadId, {
      previousState: "moderated",
      state: "visible",
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual([]);
  });
  test("a member who turns off a reason falls through to the next reason they receive", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: f.threadId });
    await execute(ctx, notificationsSetPreferencesOp, userActor(f.recipient), {
      items: [{ type: "content.mentioned", inApp: false }],
    });
    const mentioned = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: `Hello @${f.recipient.username}`,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: mentioned.position,
    });
    const quoting = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: `Hello @${f.recipient.username}`,
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, ?4)",
      )
      .run(quoting.id, f.postId, f.recipient.id, ctx.now());
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.quoted"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(1);
    await clear(ctx, f.recipient);
    await execute(ctx, notificationsSetPreferencesOp, userActor(f.recipient), {
      items: [
        { type: "content.mentioned", inApp: true },
        { type: "content.quoted", inApp: false },
      ],
    });
    const both = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: `Hello again @${f.recipient.username}`,
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, ?4)",
      )
      .run(both.id, f.postId, f.recipient.id, ctx.now());
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
  });
  test("real profile approval delivers creation mentions once", async () => {
    const f = fixture();
    const { ctx } = f;
    const made = await execute(ctx, profilePostsCreateOp, userActor(f.author), {
      userId: f.author.id,
      body: `Hello @${f.recipient.username}`,
    });
    ctx.sqlite.prepare("UPDATE profile_posts SET state = 'moderated' WHERE id = ?1").run(made.id);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    await execute(ctx, profilePostsRestoreOp, userActor(f.moderator), {
      profilePostId: made.id,
      notify: true,
      reason: "approved",
      message: "Welcome",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.author), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data,
    ).toMatchObject({
      action: "approved",
      reason: "approved",
      message: "Welcome",
    });
    await clear(ctx, f.recipient);
    ctx.sqlite.prepare("UPDATE profile_posts SET state = 'moderated' WHERE id = ?1").run(made.id);
    await execute(ctx, profilePostsRestoreOp, userActor(f.moderator), { profilePostId: made.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
  });
  test("real wall posts and comments reach the owner, author and earlier commenter", async () => {
    const f = fixture();
    const { ctx } = f;
    const post = await execute(ctx, profilePostsCreateOp, userActor(f.author), {
      userId: f.recipient.id,
      body: "On your wall",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["profile.post"]);
    expect(await types(ctx, f.author)).toEqual([]);
    await execute(ctx, profileCommentsCreateOp, userActor(f.other), {
      profilePostId: post.id,
      body: "First comment",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.author)).toEqual(["profile.comment"]);
    await clear(ctx, f.author);
    await execute(ctx, profileCommentsCreateOp, userActor(f.outsider), {
      profilePostId: post.id,
      body: "Second comment",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.author)).toEqual(["profile.comment"]);
    expect(await types(ctx, f.other)).toEqual(["profile.commented"]);
    expect(await types(ctx, f.outsider)).toEqual([]);
  });
  test("real reactions on each content kind notify the author", async () => {
    const f = fixture();
    const { ctx } = f;
    const author = userActor(f.author);
    const recipient = userActor(f.recipient);
    const threadPost = await execute(ctx, postsCreateOp, author, {
      threadId: f.threadId,
      body: "reply",
    });
    const profilePost = await execute(ctx, profilePostsCreateOp, author, {
      userId: f.author.id,
      body: "wall",
    });
    const comment = await execute(ctx, profileCommentsCreateOp, author, {
      profilePostId: profilePost.id,
      body: "comment",
    });
    const conversation = await execute(ctx, conversationsCreateOp, author, {
      title: "Reaction conversation",
      recipientIds: [f.recipient.id],
      body: "message",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    for (const [contentType, contentId] of [
      ["post", threadPost.id],
      ["profile_post", profilePost.id],
      ["profile_post_comment", comment.id],
      ["conversation_message", conversation.message.id],
    ] as const) {
      await execute(ctx, reactionsSetOp, recipient, { contentType, contentId, reactionTypeId: 1 });
    }
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect((await types(ctx, f.author)).filter((type) => type === "content.reaction")).toHaveLength(
      4,
    );
    expect(await types(ctx, f.other)).toEqual([]);
  });
  test("thread read clears only notices through the read position and keeps moderation notices", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: f.threadId });
    await send(ctx, "content.created", "post", f.postId);
    const later = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 2, ?3)",
        )
        .run(f.threadId, f.author.id, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "content.created", "post", later);
    const moderationId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO notifications (user_id, type, content_type, content_id, thread_id, created_at, updated_at) VALUES (?1, 'moderation.content', 'thread', ?2, ?2, ?3, ?3)",
        )
        .run(f.recipient.id, f.threadId, ctx.now()).lastInsertRowid,
    );
    ctx.sqlite
      .prepare(
        "UPDATE users SET unread_notification_count = unread_notification_count + 1 WHERE id = ?1",
      )
      .run(f.recipient.id);
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: 1,
    });
    const rows = ctx.sqlite
      .prepare<{ content_id: number; read_at: number | null }, [number]>(
        "SELECT content_id, read_at FROM notifications WHERE user_id = ?1 AND read_at IS NULL",
      )
      .all(f.recipient.id);
    expect(rows.map((row) => row.content_id).sort((a, b) => a - b)).toEqual(
      [later, f.threadId].sort((a, b) => a - b),
    );
    expect(
      ctx.sqlite
        .prepare<{ read_at: number | null }, [number]>(
          "SELECT read_at FROM notifications WHERE id = ?1",
        )
        .get(moderationId)?.read_at,
    ).toBeNull();
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(2);
  });
  test("real reports notify moderators once per open group and resolution notifies reporters", async () => {
    const f = fixture();
    const { ctx } = f;
    const first = (await execute(ctx, moderationOp("reports.create"), userActor(f.recipient), {
      target: { type: "post", id: f.postId },
      reason: "review this",
    })) as { groupId: number };
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.report"]);
    expect(await types(ctx, f.recipient)).toEqual([]);
    await clear(ctx, f.moderator);
    await execute(ctx, moderationOp("reports.create"), userActor(f.other), {
      target: { type: "post", id: f.postId },
      reason: "same concern",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.moderator)).toEqual([]);
    await execute(ctx, moderationOp("reports.setState"), userActor(f.moderator), {
      groupId: first.groupId,
      state: "resolved",
      reason: "handled",
      notify: true,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["report.resolved"]);
    expect(await types(ctx, f.other)).toEqual(["report.resolved"]);
  });
  test("conversation message reports go to conversation moderators", async () => {
    const f = fixture();
    const { ctx } = f;
    const admin = insertUser(ctx, { groupId: 4 });
    const made = await execute(ctx, conversationsCreateOp, userActor(f.author), {
      title: "Reported conversation",
      recipientIds: [f.recipient.id],
      body: "first",
    });
    await execute(ctx, moderationOp("reports.create"), userActor(f.recipient), {
      target: { type: "conversation_message", id: made.message.id },
      reason: "review",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, admin)).toEqual(["moderator.report"]);
    expect(await types(ctx, f.moderator)).toEqual([]);
    expect(await types(ctx, f.recipient)).toEqual(["conversation.added"]);
  });
  test("real moderation approval delivers a held post once and labels later undelete", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    await execute(ctx, threadsWatchOp, userActor(f.other), { threadId: f.threadId });
    const post = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: `holdme @${f.recipient.username}`,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual([]);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.approval"]);
    await execute(ctx, moderationOp("moderation.bulk"), userActor(f.moderator), {
      targets: [{ type: "post", id: post.id }],
      action: "approve",
      reason: "accepted",
      notify: true,
      message: "okay",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.other)).toEqual(["thread.watched"]);
    expect(await types(ctx, f.moderator)).toEqual([]);
    expect(await unreadCount(ctx, f.moderator)).toBe(0);
    await clear(ctx, f.recipient);
    await clear(ctx, f.other);
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "post", id: post.id },
      state: "moderated",
      reason: "hold again",
    });
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "post", id: post.id },
      state: "visible",
      reason: "accepted again",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual([]);
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "post", id: post.id },
      state: "deleted",
      reason: "removed",
      notify: true,
    });
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "post", id: post.id },
      state: "visible",
      reason: "restored",
      notify: true,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    const notices = await execute(ctx, notificationsListOp, userActor(f.author), {
      unreadOnly: true,
      limit: 10,
    });
    expect(notices.items.map((item) => item.data.action)).toContain("undeleted");
  });
  test("real warning and restriction operations notify; an account ban stays email-only", async () => {
    const f = fixture();
    const { ctx } = f;
    const moderator = userActor(f.moderator);
    await execute(ctx, moderationOp("warnings.create"), moderator, {
      userId: f.recipient.id,
      points: 1,
      reason: "warning",
      notify: true,
      message: "Please stop",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data,
    ).toMatchObject({
      action: "warned",
      reason: "warning",
      message: "Please stop",
    });
    await clear(ctx, f.recipient);
    const restriction = (await execute(ctx, moderationOp("restrictions.create"), moderator, {
      userId: f.recipient.id,
      kind: "posting",
      reason: "pause",
      notify: true,
    })) as { id: number };
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data.action,
    ).toBe("restricted");
    await clear(ctx, f.recipient);
    await execute(ctx, moderationOp("restrictions.lift"), moderator, {
      restrictionId: restriction.id,
      notify: true,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data.action,
    ).toBe("restriction_lifted");
    await clear(ctx, f.recipient);
    const admin = insertUser(ctx, { groupId: 4 });
    await execute(ctx, moderationOp("bans.create"), userActor(admin), {
      userId: f.recipient.id,
      reason: "account ban",
      notify: true,
      expiresAt: null,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NULL AND epoch = (SELECT notification_epoch FROM users WHERE id = ?1)",
        )
        .get(f.recipient.id)?.n,
    ).toBe(0);
  });
  test("node watch modes, thread watch, follows, quote and mention choose the correct member", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare(
        "INSERT INTO node_watches (user_id, node_id, mode, created_at) VALUES (?1, ?2, 'threads', ?3)",
      )
      .run(f.recipient.id, f.node.id, ctx.now());
    ctx.sqlite
      .prepare(
        "INSERT INTO node_watches (user_id, node_id, mode, created_at) VALUES (?1, ?2, 'posts', ?3)",
      )
      .run(f.other.id, f.node.id, ctx.now());
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.outsider.id, f.author.id, ctx.now());
    await send(ctx, "content.created", "thread", f.threadId);
    expect(await types(ctx, f.recipient)).toEqual(["node.thread"]);
    expect(await types(ctx, f.other)).toEqual(["node.thread"]);
    expect(await types(ctx, f.outsider)).toEqual(["member.thread"]);
    expect(await types(ctx, f.author)).toEqual([]);
    await clear(ctx, f.recipient);
    await clear(ctx, f.other);
    await clear(ctx, f.outsider);
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.threadId, ctx.now());
    await send(ctx, "content.created", "post", f.postId);
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    expect(await types(ctx, f.other)).toEqual(["node.post"]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    await clear(ctx, f.recipient);
    await clear(ctx, f.other);
    ctx.sqlite
      .prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, ?4)",
      )
      .run(f.postId, f.firstId, f.recipient.id, ctx.now());
    ctx.sqlite
      .prepare(
        "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES ('post', ?1, ?2, ?3)",
      )
      .run(f.postId, f.other.id, ctx.now());
    await send(ctx, "content.created", "post", f.postId);
    expect(await types(ctx, f.recipient)).toEqual(["content.quoted"]);
    expect(await types(ctx, f.other)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.author)).toEqual([]);
  });

  test("edit mentions use only the newlyMentioned payload", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare(
        "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES ('post', ?1, ?2, ?3)",
      )
      .run(f.postId, f.recipient.id, ctx.now());
    await send(ctx, "content.edited", "post", f.postId, { newlyMentioned: [f.other.id] });
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.author)).toEqual([]);
  });

  test("reactions on all four supported content kinds reach the author, except hidden or self reactions", async () => {
    const f = fixture();
    const { ctx } = f;
    const profilePostId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?1, ?2, 'x', '<p>x</p>')",
        )
        .run(f.author.id, ctx.now()).lastInsertRowid,
    );
    const commentId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'x', '<p>x</p>')",
        )
        .run(profilePostId, f.author.id, ctx.now()).lastInsertRowid,
    );
    const convId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES ('Talk', ?1, ?2, ?2, ?1)",
        )
        .run(f.author.id, ctx.now()).lastInsertRowid,
    );
    for (const id of [f.author.id, f.recipient.id])
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at) VALUES (?1, ?2, 'active', ?3, ?3)",
        )
        .run(convId, id, ctx.now());
    const messageId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'x', '<p>x</p>')",
        )
        .run(convId, f.author.id, ctx.now()).lastInsertRowid,
    );
    for (const [kind, id] of [
      ["post", f.postId],
      ["profile_post", profilePostId],
      ["profile_post_comment", commentId],
      ["conversation_message", messageId],
    ] as const) {
      await send(ctx, "reaction.added", kind, id, {
        userId: f.recipient.id,
        contentUserId: f.author.id,
        reactionTypeId: 1,
      });
      expect(await types(ctx, f.author)).toEqual(["content.reaction"]);
      expect(await types(ctx, f.other)).toEqual([]);
      await clear(ctx, f.author);
    }
    ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(f.postId);
    await send(ctx, "reaction.added", "post", f.postId, {
      userId: f.recipient.id,
      contentUserId: f.author.id,
      reactionTypeId: 1,
    });
    expect(await types(ctx, f.author)).toEqual([]);
    await send(ctx, "reaction.added", "profile_post", profilePostId, {
      userId: f.author.id,
      contentUserId: f.author.id,
      reactionTypeId: 1,
    });
    expect(await types(ctx, f.author)).toEqual([]);
    await send(ctx, "reaction.added", "post", 999999, {
      userId: f.recipient.id,
      contentUserId: f.author.id,
      reactionTypeId: 1,
    });
    expect(await types(ctx, f.author)).toEqual([]);
  });

  test("wall posts and comments notify wall owner, post author and prior commenters only", async () => {
    const f = fixture();
    const { ctx } = f;
    const profilePostId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'x', '<p>x</p>')",
        )
        .run(f.recipient.id, f.author.id, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "content.created", "profile_post", profilePostId);
    expect(await types(ctx, f.recipient)).toEqual(["profile.post"]);
    expect(await types(ctx, f.other)).toEqual([]);
    await clear(ctx, f.recipient);
    ctx.sqlite
      .prepare(
        "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'old', '<p>old</p>')",
      )
      .run(profilePostId, f.other.id, ctx.now());
    const commentId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'new', '<p>new</p>')",
        )
        .run(profilePostId, f.outsider.id, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "content.created", "profile_post_comment", commentId);
    expect(await types(ctx, f.author)).toEqual(["profile.comment"]);
    expect(await types(ctx, f.other)).toEqual(["profile.commented"]);
    expect(await types(ctx, f.outsider)).toEqual([]);
  });

  test("conversation additions and messages reach active participants, never the sender or outsiders", async () => {
    const f = fixture();
    const { ctx } = f;
    const convId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES ('Talk', ?1, ?2, ?2, ?1)",
        )
        .run(f.author.id, ctx.now()).lastInsertRowid,
    );
    for (const [id, state] of [
      [f.author.id, "active"],
      [f.recipient.id, "active"],
      [f.other.id, "left"],
    ] as const)
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        )
        .run(convId, id, state, ctx.now());
    await send(ctx, "conversation.participants_added", "conversation", convId, {
      userIds: [f.recipient.id, f.other.id],
      actorId: f.author.id,
    });
    expect(await types(ctx, f.recipient)).toEqual(["conversation.added"]);
    expect(await types(ctx, f.other)).toEqual([]);
    await clear(ctx, f.recipient);
    const messageId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'x', '<p>x</p>')",
        )
        .run(convId, f.author.id, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "content.created", "conversation_message", messageId, {
      conversationId: convId,
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    const replyId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'reply', '<p>reply</p>')",
        )
        .run(convId, f.author.id, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "content.created", "conversation_message", replyId, { conversationId: convId });
    expect(await types(ctx, f.recipient)).toEqual(["conversation.message"]);
    const messageNotice = (
      await execute(ctx, notificationsListOp, userActor(f.recipient), {
        unreadOnly: true,
        limit: 10,
      })
    ).items[0]!;
    expect(messageNotice.contentTitle).toBe("Talk");
    expect(messageNotice.url).toBe(`/conversations/${convId}`);
    expect(await types(ctx, f.other)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    expect(await types(ctx, f.author)).toEqual([]);
  });

  test("moderation content actions notify the affected author only when requested, with details", async () => {
    const f = fixture();
    const { ctx } = f;
    for (const [eventType, payload, expectedAction] of [
      ["content.edited", { actorId: f.moderator.id, reason: "edit", message: "changed" }, "edited"],
      [
        "content.state_changed",
        {
          actorId: f.moderator.id,
          reason: "approval",
          message: "accepted",
          previousState: "moderated",
        },
        "approved",
      ],
      [
        "content.edited",
        { actorId: f.moderator.id, reason: "move", message: "relocated", movedToNodeId: f.node.id },
        "moved",
      ],
      [
        "content.edited",
        { actorId: f.moderator.id, reason: "lock", message: "closed", isLocked: true },
        "locked",
      ],
      [
        "moderation.action",
        {
          moderatorId: f.moderator.id,
          contentUserId: f.author.id,
          action: "merge",
          reason: "duplicate",
          message: "merged",
        },
        "merged",
      ],
    ] as const) {
      await send(ctx, eventType, "post", f.postId, { ...payload, notify: true });
      const page = await execute(ctx, notificationsListOp, userActor(f.author), {
        unreadOnly: true,
        limit: 10,
      });
      expect(page.items.map((item) => item.type)).toEqual(["moderation.content"]);
      expect(page.items[0]?.data.reason).toBe(payload.reason);
      expect(page.items[0]?.data.message).toBe(payload.message);
      expect(page.items[0]?.data.action).toBe(expectedAction);
      expect(await types(ctx, f.other)).toEqual([]);
      await clear(ctx, f.author);
    }
    await send(ctx, "content.edited", "post", f.postId, {
      actorId: f.moderator.id,
      notify: false,
      reason: "silent",
    });
    expect(await types(ctx, f.author)).toEqual([]);
    await send(ctx, "moderation.action", "post", f.postId, {
      moderatorId: f.moderator.id,
      contentUserId: f.author.id,
      notify: false,
      action: "split",
    });
    expect(await types(ctx, f.author)).toEqual([]);
    ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(f.postId);
    await send(ctx, "content.deleted", "post", f.postId, {
      actorId: f.moderator.id,
      notify: true,
      reason: "removed",
      message: "rule",
    });
    expect(await types(ctx, f.author)).toEqual(["moderation.content"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.author), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data.reason,
    ).toBe("removed");
  });

  test("member actions, lifts and group changes target the member, not bystanders", async () => {
    const f = fixture();
    const { ctx } = f;
    for (const action of ["member.warned", "member.thread_banned", "member.restricted"] as const) {
      await send(ctx, action, "user", f.recipient.id, {
        moderatorId: f.moderator.id,
        notify: true,
        reason: action,
        message: "Please review",
      });
      const page = await execute(ctx, notificationsListOp, userActor(f.recipient), {
        unreadOnly: true,
        limit: 10,
      });
      expect(page.items.map((item) => item.type)).toEqual(["moderation.member"]);
      expect(page.items[0]?.data.reason).toBe(action);
      expect(await types(ctx, f.other)).toEqual([]);
      await clear(ctx, f.recipient);
    }
    await send(ctx, "member.restricted", "user", f.recipient.id, {
      moderatorId: f.moderator.id,
      notify: true,
      lifted: true,
      reason: "expired",
    });
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data.action,
    ).toBe("restriction_lifted");
    await clear(ctx, f.recipient);
    await send(ctx, "member.thread_banned", "user", f.recipient.id, {
      moderatorId: f.moderator.id,
      notify: true,
      lifted: true,
      reason: "expired",
    });
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data.action,
    ).toBe("thread_ban_lifted");
    await clear(ctx, f.recipient);
    await send(ctx, "member.banned", "user", f.recipient.id, {
      moderatorId: f.moderator.id,
      notify: true,
      reason: "ban",
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    await send(ctx, "member.warned", "user", f.recipient.id, {
      moderatorId: f.moderator.id,
      notify: false,
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    await send(ctx, "member.groups_changed", "user", f.recipient.id, {
      actorId: f.moderator.id,
      added: [3],
      removed: [],
    });
    expect(await types(ctx, f.recipient)).toEqual(["member.groups"]);
    expect(await types(ctx, f.other)).toEqual([]);
  });

  test("reports and pending approvals go to moderators; resolution goes to reporters", async () => {
    const f = fixture();
    const { ctx } = f;
    const groupId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO report_groups (target_type, target_id, state, created_at, updated_at, node_id) VALUES ('post', ?1, 'open', ?2, ?2, ?3)",
        )
        .run(f.postId, ctx.now(), f.node.id).lastInsertRowid,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO reports (group_id, reporter_id, reason, created_at) VALUES (?1, ?2, 'reason', ?3)",
      )
      .run(groupId, f.recipient.id, ctx.now());
    await send(ctx, "report.created", "report_group", groupId, {
      reporterId: f.recipient.id,
      nodeId: f.node.id,
    });
    expect(await types(ctx, f.moderator)).toEqual(["moderator.report"]);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    await send(ctx, "report.state_changed", "report_group", groupId, {
      state: "resolved",
      moderatorId: f.moderator.id,
      notify: true,
      reason: "handled",
      message: "thank you",
    });
    expect(await types(ctx, f.recipient)).toEqual(["report.resolved"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items[0]?.data.message,
    ).toBe("thank you");
    await clear(ctx, f.recipient);
    await send(ctx, "report.state_changed", "report_group", groupId, {
      state: "rejected",
      moderatorId: f.moderator.id,
      notify: false,
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(f.postId);
    await send(ctx, "content.created", "post", f.postId);
    expect(await types(ctx, f.moderator)).toContain("moderator.approval");
    expect(await types(ctx, f.outsider)).toEqual([]);
    expect(await types(ctx, f.author)).toEqual([]);
  });

  test("hidden nodes, ignored actors, banned recipients and self actions suppress delivery", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.threadId, ctx.now());
    const permissionId = ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get("node.view")!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, 0, ?3, -1)",
      )
      .run(permissionId, f.node.id, f.recipient.id);
    invalidate(ctx, "permissions");
    await send(ctx, "content.created", "post", f.postId);
    expect(await types(ctx, f.recipient)).toEqual([]);
    ctx.sqlite
      .prepare("DELETE FROM permission_entries WHERE permission_id = ?1 AND user_id = ?2")
      .run(permissionId, f.recipient.id);
    invalidate(ctx, "permissions");
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.author.id, ctx.now());
    await send(ctx, "content.created", "post", f.postId);
    expect(await types(ctx, f.recipient)).toEqual([]);
    ctx.sqlite.prepare("DELETE FROM user_ignores WHERE user_id = ?1").run(f.recipient.id);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(f.recipient.id);
    await send(ctx, "content.created", "post", f.postId);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 0 WHERE id = ?1").run(f.recipient.id);
    expect(await types(ctx, f.recipient)).toEqual([]);
    await send(ctx, "member.followed", "user", f.author.id, { followerId: f.author.id });
    expect(await types(ctx, f.author)).toEqual([]);
  });

  test("following, profile reports and profile approvals deliver only to their intended members", async () => {
    const f = fixture();
    const { ctx } = f;
    await send(ctx, "member.followed", "user", f.recipient.id, { followerId: f.author.id });
    expect(await types(ctx, f.recipient)).toEqual(["member.followed"]);
    expect(await types(ctx, f.other)).toEqual([]);
    await clear(ctx, f.recipient);
    const profilePostId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, 'moderated', ?3, 'x', '<p>x</p>')",
        )
        .run(f.recipient.id, f.author.id, ctx.now()).lastInsertRowid,
    );
    const groupId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO report_groups (target_type, target_id, state, created_at, updated_at) VALUES ('profile_post', ?1, 'open', ?2, ?2)",
        )
        .run(profilePostId, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "report.created", "report_group", groupId, { reporterId: f.other.id });
    expect(await types(ctx, f.moderator)).toEqual(["moderator.report"]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    await clear(ctx, f.moderator);
    await send(ctx, "content.created", "profile_post", profilePostId);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.approval"]);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
  });

  test("read grouping, deletion and event replay keep counters exact", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.threadId, ctx.now());
    await send(ctx, "content.created", "post", f.postId);
    await send(ctx, "content.created", "post", f.postId);
    let page = await execute(ctx, notificationsListOp, userActor(f.recipient), {
      unreadOnly: true,
      limit: 10,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.actorCount).toBe(1);
    expect(page.unreadCount).toBe(1);
    await clear(ctx, f.recipient);
    const replayId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM domain_events WHERE type = 'content.created' AND target_type = 'post' ORDER BY id DESC LIMIT 1",
      )
      .get()!.id;
    ctx.sqlite.prepare("DELETE FROM jobs WHERE unique_key = ?1").run(`notify:${replayId}`);
    enqueueJob(
      ctx,
      "notifications.fanout",
      { eventId: replayId, phase: 0, after: 0 },
      { uniqueKey: `notify:${replayId}` },
    );
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    await send(ctx, "content.created", "post", f.postId);
    page = await execute(ctx, notificationsListOp, userActor(f.recipient), {
      unreadOnly: true,
      limit: 10,
    });
    expect(page.items).toHaveLength(1);
    expect(page.unreadCount).toBe(1);
    ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(f.postId);
    await send(ctx, "content.deleted", "post", f.postId, {
      actorId: f.moderator.id,
      notify: true,
      reason: "remove",
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.author)).toEqual(["moderation.content"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.author), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(1);
    const eventId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM domain_events WHERE type = 'content.deleted' ORDER BY id DESC LIMIT 1",
      )
      .get()!.id;
    enqueueJob(
      ctx,
      "notifications.fanout",
      { eventId, phase: 0, after: 0 },
      { uniqueKey: `notify:${eventId}` },
    );
    await runDueJobs(ctx);
    expect(await types(ctx, f.author)).toEqual(["moderation.content"]);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(f.author), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(1);
  });

  test("post, profile post and comment editors publish only newly mentioned member ids", async () => {
    const f = fixture();
    const { ctx } = f;
    const author = userActor(f.author);
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: f.node.id,
      title: "Editable",
      body: "plain",
    });
    const profilePost = await execute(ctx, profilePostsCreateOp, author, {
      userId: f.author.id,
      body: "plain",
    });
    const comment = await execute(ctx, profileCommentsCreateOp, author, {
      profilePostId: profilePost.id,
      body: "plain",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    const edits = [
      {
        kind: "post",
        id: thread.post.id,
        run: (body: string) =>
          execute(ctx, postsUpdateOp, author, { postId: thread.post.id, body }),
      },
      {
        kind: "profile_post",
        id: profilePost.id,
        run: (body: string) =>
          execute(ctx, profilePostsUpdateOp, author, { profilePostId: profilePost.id, body }),
      },
      {
        kind: "profile_post_comment",
        id: comment.id,
        run: (body: string) =>
          execute(ctx, profileCommentsUpdateOp, author, { commentId: comment.id, body }),
      },
    ];
    for (const edit of edits) {
      await edit.run(`@${f.recipient.username}`);
      const payload = ctx.sqlite
        .prepare<{ payload: string }, [string, number]>(
          "SELECT payload FROM domain_events WHERE type = 'content.edited' AND target_type = ?1 AND target_id = ?2 ORDER BY id DESC LIMIT 1",
        )
        .get(edit.kind, edit.id)!;
      expect((JSON.parse(payload.payload) as { newlyMentioned: number[] }).newlyMentioned).toEqual([
        f.recipient.id,
      ]);
      await dispatchEvents(ctx);
      await runDueJobs(ctx);
      expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
      await clear(ctx, f.recipient);
      await edit.run(`@${f.recipient.username} again`);
      const repeat = ctx.sqlite
        .prepare<{ payload: string }, [string, number]>(
          "SELECT payload FROM domain_events WHERE type = 'content.edited' AND target_type = ?1 AND target_id = ?2 ORDER BY id DESC LIMIT 1",
        )
        .get(edit.kind, edit.id)!;
      expect((JSON.parse(repeat.payload) as { newlyMentioned: number[] }).newlyMentioned).toEqual(
        [],
      );
      await dispatchEvents(ctx);
      await runDueJobs(ctx);
      expect(await types(ctx, f.recipient)).toEqual([]);
    }
  });

  test("deleting a container removes unread notices for its hidden children", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.threadId, ctx.now());
    await send(ctx, "content.created", "post", f.postId);
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(f.threadId);
    await send(ctx, "content.deleted", "thread", f.threadId);
    expect(await types(ctx, f.recipient)).toEqual([]);
    const profilePostId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'x', '<p>x</p>')",
        )
        .run(f.author.id, f.recipient.id, ctx.now()).lastInsertRowid,
    );
    const commentId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'x', '<p>x</p>')",
        )
        .run(profilePostId, f.other.id, ctx.now()).lastInsertRowid,
    );
    await send(ctx, "content.created", "profile_post_comment", commentId);
    expect(await types(ctx, f.recipient)).toEqual(["profile.comment"]);
    ctx.sqlite
      .prepare("UPDATE profile_posts SET state = 'deleted' WHERE id = ?1")
      .run(profilePostId);
    await send(ctx, "content.deleted", "profile_post", profilePostId);
    expect(await types(ctx, f.recipient)).toEqual([]);
  });

  test("recipient batches and event replay deliver each event once", async () => {
    const f = fixture();
    const { ctx } = f;
    const watchers = Array.from({ length: 205 }, () => insertUser(ctx));
    const watch = ctx.sqlite.prepare(
      "INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)",
    );
    for (const watcher of watchers) watch.run(watcher.id, f.threadId, ctx.now());
    await send(ctx, "content.created", "post", f.postId);
    const eventId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM domain_events WHERE type = 'content.created' AND target_type = 'post' ORDER BY id DESC LIMIT 1",
      )
      .get()!.id;
    const count = () =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE last_event_id = ?1",
        )
        .get(eventId)!.n;
    expect(count()).toBe(watchers.length);
    const createdEvents = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'notification.created' ORDER BY id",
      )
      .all();
    expect(createdEvents).toHaveLength(Math.ceil(watchers.length / 40));
    expect(
      createdEvents.flatMap((row) => (JSON.parse(row.payload) as { userIds: number[] }).userIds),
    ).toHaveLength(watchers.length);
    enqueueJob(
      ctx,
      "notifications.fanout",
      { eventId, phase: 0, after: 0 },
      { uniqueKey: `notify:${eventId}` },
    );
    await runDueJobs(ctx);
    expect(count()).toBe(watchers.length);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(watchers.at(-1)!), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(1);
    ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(f.postId);
    await send(ctx, "content.deleted", "post", f.postId);
    expect(
      (
        await execute(ctx, notificationsListOp, userActor(watchers.at(-1)!), {
          unreadOnly: true,
          limit: 10,
        })
      ).unreadCount,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE last_event_id = ?1",
        )
        .get(eventId)!.n,
    ).toBe(0);
  });

  test("reading a thread before a queued fan-out completes leaves it read", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.threadId, ctx.now());
    writeTx(ctx, () =>
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: f.postId }),
    );
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: 1,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
  });
});

describe("notification delivery rules", () => {
  function insertPost(ctx: TestCtx, threadId: number, userId: number, position: number) {
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(threadId, userId, position, ctx.now()).lastInsertRowid,
    );
  }
  function deny(
    ctx: TestCtx,
    permission: string,
    target: { userId?: number; groupId?: number; nodeId?: number },
  ) {
    const permissionId = ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get(permission)!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, ?3, ?4, -1)",
      )
      .run(permissionId, target.nodeId ?? 0, target.groupId ?? 0, target.userId ?? 0);
    invalidate(ctx, "permissions");
  }

  test("watch suppression and thread reads compare post ids, not positions", async () => {
    const f = fixture();
    const { ctx } = f;
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.threadId, ctx.now());
    const older = [2, 3, 4, 5].map((position) =>
      insertPost(ctx, f.threadId, f.author.id, position),
    );
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: 5,
    });
    // A post older than the one read counts as read wherever it sits.
    await send(ctx, "content.created", "post", older[1]!);
    expect(await types(ctx, f.recipient)).toEqual([]);
    // A newer post at a low position (as a merge places it) is unread, and reading an older post
    // at a higher position leaves it unread.
    const merged = insertPost(ctx, f.threadId, f.author.id, 3);
    await send(ctx, "content.created", "post", merged);
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: 5,
    });
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    const newest = insertPost(ctx, f.threadId, f.author.id, 6);
    await send(ctx, "content.created", "post", newest);
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: 6,
    });
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await unreadCount(ctx, f.recipient)).toBe(0);
  });

  test("an edit that sends a visible post to moderation holds its new mentions until approval", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    await execute(ctx, threadsWatchOp, userActor(f.other), { threadId: f.threadId });
    const post = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: "plain reply",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.other)).toEqual(["thread.watched"]);
    await clear(ctx, f.other);
    await execute(ctx, postsUpdateOp, userActor(f.author), {
      postId: post.id,
      body: `holdme @${f.recipient.username}`,
    });
    await execute(ctx, threadsWatchOp, userActor(f.outsider), { threadId: f.threadId });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    await execute(ctx, moderationOp("moderation.bulk"), userActor(f.moderator), {
      targets: [{ type: "post", id: post.id }],
      action: "approve",
      notify: false,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await unreadCount(ctx, f.recipient)).toBe(1);
    // Approving content that was visible before is not a new reply.
    expect(await types(ctx, f.other)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    // Holding and approving it again delivers nothing more.
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "post", id: post.id },
      state: "moderated",
      reason: "hold",
    });
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "post", id: post.id },
      state: "visible",
      reason: "fine",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await unreadCount(ctx, f.recipient)).toBe(1);
  });

  test("approving a held post through posts.restore delivers it as new content", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    await execute(ctx, threadsWatchOp, userActor(f.other), { threadId: f.threadId });
    const post = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: `holdme @${f.recipient.username}`,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.approval"]);
    await execute(ctx, postsRestoreOp, userActor(f.moderator), { postId: post.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.other)).toEqual(["thread.watched"]);
    expect(await types(ctx, f.moderator)).toEqual([]);
  });

  test("jobs that run late act on the state the content had at their event", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    await execute(ctx, threadsWatchOp, userActor(f.other), { threadId: f.threadId });
    // Approved before the created job runs: delivered once, by the approval.
    const held = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: `holdme @${f.recipient.username}`,
    });
    await execute(ctx, moderationOp("moderation.bulk"), userActor(f.moderator), {
      targets: [{ type: "post", id: held.id }],
      action: "approve",
      notify: false,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await unreadCount(ctx, f.recipient)).toBe(1);
    expect(await types(ctx, f.other)).toEqual(["thread.watched"]);
    expect(await types(ctx, f.moderator)).toEqual([]);
    await clear(ctx, f.other);
    // Created visible and edited into moderation before the created job runs: moderators get no
    // approval notice for a post that was not held when created.
    const edited = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: "visible reply",
    });
    await execute(ctx, postsUpdateOp, userActor(f.author), {
      postId: edited.id,
      body: "holdme now",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.moderator)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual([]);
  });

  test("an edit job that runs after the approval does not repeat a held mention", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    const post = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: "plain",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    await execute(ctx, postsUpdateOp, userActor(f.author), {
      postId: post.id,
      body: `holdme @${f.recipient.username}`,
    });
    await dispatchEvents(ctx);
    // The edit's job is retried later than the approval's.
    ctx.sqlite
      .prepare(
        "UPDATE jobs SET run_at = run_at + 1000000 WHERE status = 'pending' AND type = 'notifications.fanout'",
      )
      .run();
    await execute(ctx, moderationOp("moderation.bulk"), userActor(f.moderator), {
      targets: [{ type: "post", id: post.id }],
      action: "approve",
      notify: false,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    ctx.sqlite.prepare("UPDATE jobs SET run_at = 0 WHERE status = 'pending'").run();
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["content.mentioned"]);
    expect(await unreadCount(ctx, f.recipient)).toBe(1);
  });

  test("approving a held thread through threads.restore delivers it once as new content", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    await execute(ctx, nodesWatchOp, userActor(f.recipient), {
      nodeId: f.node.id,
      mode: "threads",
    });
    await execute(ctx, usersFollowOp, userActor(f.outsider), { userId: f.author.id });
    const made = await execute(ctx, threadsCreateOp, userActor(f.author), {
      nodeId: f.node.id,
      title: "Held thread",
      body: `holdme @${f.other.username}`,
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual([]);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.approval"]);
    await execute(ctx, threadsRestoreOp, userActor(f.moderator), { threadId: made.thread.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["node.thread"]);
    expect(await types(ctx, f.outsider)).toEqual(["member.thread"]);
    expect(await types(ctx, f.other)).toEqual(["content.mentioned"]);
    expect(await types(ctx, f.moderator)).toEqual([]);
    expect(await unreadCount(ctx, f.moderator)).toBe(0);
    for (const user of [f.recipient, f.outsider, f.other]) await clear(ctx, user);
    // Holding and restoring it again is not new content.
    await execute(ctx, moderationOp("moderation.setState"), userActor(f.moderator), {
      target: { type: "thread", id: made.thread.id },
      state: "moderated",
      reason: "hold",
    });
    await execute(ctx, threadsRestoreOp, userActor(f.moderator), { threadId: made.thread.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    for (const user of [f.recipient, f.outsider, f.other])
      expect(await types(ctx, user)).toEqual([]);
  });

  test("merging and splitting threads notify only the affected author, never watchers", async () => {
    const f = fixture();
    const { ctx } = f;
    const target = await execute(ctx, threadsCreateOp, userActor(f.author), {
      nodeId: f.node.id,
      title: "Target",
      body: "target topic",
    });
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: target.thread.id });
    await execute(ctx, nodesWatchOp, userActor(f.outsider), { nodeId: f.node.id, mode: "posts" });
    const source = await execute(ctx, threadsCreateOp, userActor(f.other), {
      nodeId: f.node.id,
      title: "Duplicate",
      body: "duplicate topic",
    });
    await execute(ctx, postsCreateOp, userActor(f.other), {
      threadId: source.thread.id,
      body: "a reply that moves",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    for (const user of [f.recipient, f.outsider, f.other]) await clear(ctx, user);
    await execute(ctx, threadsMergeOp, userActor(f.moderator), {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
      reason: "duplicate",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual(["moderation.content"]);
    await clear(ctx, f.other);
    await execute(ctx, threadsSplitOp, userActor(f.moderator), {
      threadId: target.thread.id,
      fromPosition: 1,
      title: "Split off",
      nodeId: f.node.id,
      reason: "off topic",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await types(ctx, f.outsider)).toEqual([]);
    // The moved posts start with the merged thread's first post, by the same author.
    expect(await types(ctx, f.other)).toEqual(["moderation.content"]);
  });

  test("a reopened report notifies moderators again and resolution reaches only its own reporters", async () => {
    const f = fixture();
    const { ctx } = f;
    const report = (reporter: { id: number; groupId: number }) =>
      execute(ctx, moderationOp("reports.create"), userActor(reporter), {
        target: { type: "post", id: f.postId },
        reason: "review",
      }) as Promise<{ groupId: number }>;
    const resolve = (groupId: number) =>
      execute(ctx, moderationOp("reports.setState"), userActor(f.moderator), {
        groupId,
        state: "resolved",
        reason: "handled",
        notify: true,
      });
    const { groupId } = await report(f.recipient);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.report"]);
    await resolve(groupId);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual(["report.resolved"]);
    // The report notice clears for moderators once the group is resolved.
    expect(await types(ctx, f.moderator)).toEqual([]);
    expect(await unreadCount(ctx, f.moderator)).toBe(0);
    await clear(ctx, f.recipient);
    expect((await report(f.other)).groupId).toBe(groupId);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.moderator)).toEqual(["moderator.report"]);
    await resolve(groupId);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.other)).toEqual(["report.resolved"]);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await unreadCount(ctx, f.moderator)).toBe(0);
  });

  test("moderators ignoring a member still get report and approval duty notices", async () => {
    const f = fixture();
    const { ctx } = f;
    holdWord(ctx);
    for (const ignored of [f.author.id, f.recipient.id])
      ctx.sqlite
        .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)")
        .run(f.moderator.id, ignored, ctx.now());
    await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: "holdme",
    });
    await execute(ctx, moderationOp("reports.create"), userActor(f.recipient), {
      target: { type: "post", id: f.postId },
      reason: "review",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect((await types(ctx, f.moderator)).sort()).toEqual([
      "moderator.approval",
      "moderator.report",
    ]);
  });

  test("each fan-out batch re-checks the content's state and current node", async () => {
    const f = fixture();
    const { ctx } = f;
    const watchers = Array.from({ length: 45 }, () => insertUser(ctx));
    const watch = ctx.sqlite.prepare(
      "INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)",
    );
    for (const watcher of watchers) watch.run(watcher.id, f.threadId, ctx.now());
    const delivered = (postId: number) =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE content_type = 'post' AND content_id = ?1",
        )
        .get(postId)!.n;
    // The post is deleted while the first batch is written: the rest of the fan-out stops.
    ctx.sqlite.run(
      `CREATE TEMP TRIGGER hide_after_first AFTER INSERT ON notifications BEGIN UPDATE posts SET state = 'deleted' WHERE id = ${f.postId}; END`,
    );
    await send(ctx, "content.created", "post", f.postId);
    expect(delivered(f.postId)).toBe(40);
    ctx.sqlite.run("DROP TRIGGER hide_after_first");
    ctx.sqlite.run("DELETE FROM notifications");
    ctx.sqlite.run("UPDATE users SET unread_notification_count = 0");
    // The thread moves to a node members cannot view while the first batch is written.
    const hidden = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    deny(ctx, "node.view", { groupId: 2, nodeId: hidden.id });
    const later = insertPost(ctx, f.threadId, f.author.id, 2);
    ctx.sqlite.run(
      `CREATE TEMP TRIGGER move_after_first AFTER INSERT ON notifications BEGIN UPDATE threads SET node_id = ${hidden.id} WHERE id = ${f.threadId}; END`,
    );
    await send(ctx, "content.created", "post", later);
    expect(delivered(later)).toBe(40);
  });

  test("members without notification.view get nothing; announcement authors skip themselves", async () => {
    const f = fixture();
    const { ctx } = f;
    deny(ctx, "notification.view", { userId: f.recipient.id });
    await send(ctx, "member.followed", "user", f.recipient.id, { followerId: f.author.id });
    await send(ctx, "announcement.published", "announcement", 1, { userId: f.author.id });
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE user_id = ?1",
        )
        .get(f.recipient.id)!.n,
    ).toBe(0);
    expect(await types(ctx, f.author)).toEqual([]);
    expect(await types(ctx, f.other)).toEqual(["announcement"]);
  });

  test("a move notice names the destination only to authors who can view it", async () => {
    const f = fixture();
    const { ctx } = f;
    const hidden = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    deny(ctx, "node.view", { userId: f.author.id, nodeId: hidden.id });
    const notice = async (nodeId: number) => {
      await send(ctx, "content.edited", "post", f.postId, {
        actorId: f.moderator.id,
        notify: true,
        reason: "move",
        movedToNodeId: nodeId,
      });
      const page = await execute(ctx, notificationsListOp, userActor(f.author), {
        unreadOnly: true,
        limit: 10,
      });
      await clear(ctx, f.author);
      return page.items[0]!.data;
    };
    expect(await notice(f.node.id)).toMatchObject({ action: "moved", movedToNodeId: f.node.id });
    const data = await notice(hidden.id);
    expect(data.action).toBe("moved");
    expect(data).not.toHaveProperty("movedToNodeId");
  });

  test("deleting the newest reply of a thread-watch group falls back to an earlier reply", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: f.threadId });
    const first = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: "first reply",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    const second = await execute(ctx, postsCreateOp, userActor(f.other), {
      threadId: f.threadId,
      body: "second reply",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    const listed = async () =>
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items;
    expect((await listed()).map((item) => [item.contentId, item.actorCount])).toEqual([
      [second.id, 2],
    ]);
    await execute(ctx, postsDeleteOp, userActor(f.other), { postId: second.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    // The deleted reply's author leaves the group.
    expect(
      (await listed()).map((item) => [
        item.type,
        item.contentId,
        item.actorCount,
        item.actors.map((actor) => actor.id),
      ]),
    ).toEqual([["thread.watched", first.id, 1, [f.author.id]]]);
    expect((await listed())[0]!.data).not.toHaveProperty("_firstPostId");
    expect(await unreadCount(ctx, f.recipient)).toBe(1);
    await execute(ctx, postsDeleteOp, userActor(f.author), { postId: first.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await listed()).toEqual([]);
    expect(await unreadCount(ctx, f.recipient)).toBe(0);
  });

  test("a repointed group keeps authors with remaining replies and leads with the fallback's", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: f.threadId });
    const reply = async (user: { id: number; groupId: number }, body: string) => {
      const made = await execute(ctx, postsCreateOp, userActor(user), {
        threadId: f.threadId,
        body,
      });
      await dispatchEvents(ctx);
      await runDueJobs(ctx);
      return made;
    };
    const notice = async () =>
      (
        await execute(ctx, notificationsListOp, userActor(f.recipient), {
          unreadOnly: true,
          limit: 10,
        })
      ).items.map((item) => [item.contentId, item.actorCount, item.actors.map((a) => a.id)]);
    // The author of the deleted reply stays while an earlier reply of theirs remains.
    await reply(f.author, "first");
    const r2 = await reply(f.other, "second");
    const r3 = await reply(f.author, "third");
    await execute(ctx, postsDeleteOp, userActor(f.author), { postId: r3.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await notice()).toEqual([[r2.id, 2, [f.other.id, f.author.id]]]);
    // A fallback reply whose author never joined the group (its event was not delivered) leads.
    const r4 = await execute(ctx, postsCreateOp, userActor(f.outsider), {
      threadId: f.threadId,
      body: "fourth",
    });
    ctx.sqlite
      .prepare("DELETE FROM domain_events WHERE type = 'content.created' AND target_id = ?1")
      .run(r4.id);
    const r5 = await reply(f.other, "fifth");
    await execute(ctx, postsDeleteOp, userActor(f.other), { postId: r5.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await notice()).toEqual([[r4.id, 3, [f.outsider.id, f.other.id, f.author.id]]]);
  });

  test("a repointed group skips replies by members the recipient ignores", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: f.threadId });
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)")
      .run(f.recipient.id, f.outsider.id, ctx.now());
    const posted = [];
    for (const [user, body] of [
      [f.other, "first"],
      [f.outsider, "ignored"],
      [f.author, "third"],
    ] as const) {
      posted.push(
        await execute(ctx, postsCreateOp, userActor(user), { threadId: f.threadId, body }),
      );
      await dispatchEvents(ctx);
      await runDueJobs(ctx);
    }
    await execute(ctx, postsDeleteOp, userActor(f.author), { postId: posted[2]!.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    const items = (
      await execute(ctx, notificationsListOp, userActor(f.recipient), {
        unreadOnly: true,
        limit: 10,
      })
    ).items;
    expect(
      items.map((item) => [item.contentId, item.actorCount, item.actors.map((a) => a.id)]),
    ).toEqual([[posted[0]!.id, 1, [f.other.id]]]);
    expect(await unreadCount(ctx, f.recipient)).toBe(1);
  });

  test("a deleted newest reply does not fall back to a reply the member has read", async () => {
    const f = fixture();
    const { ctx } = f;
    await execute(ctx, threadsWatchOp, userActor(f.recipient), { threadId: f.threadId });
    const first = await execute(ctx, postsCreateOp, userActor(f.author), {
      threadId: f.threadId,
      body: "first reply",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    const second = await execute(ctx, postsCreateOp, userActor(f.other), {
      threadId: f.threadId,
      body: "second reply",
    });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    await execute(ctx, threadsMarkReadOp, userActor(f.recipient), {
      threadId: f.threadId,
      position: first.position,
    });
    expect(await types(ctx, f.recipient)).toEqual(["thread.watched"]);
    await execute(ctx, postsDeleteOp, userActor(f.other), { postId: second.id });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(await types(ctx, f.recipient)).toEqual([]);
    expect(await unreadCount(ctx, f.recipient)).toBe(0);
  });
});
