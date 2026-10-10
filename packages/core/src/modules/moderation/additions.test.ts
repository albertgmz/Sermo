import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import {
  conversationsCreateOp,
  conversationsListMessagesOp,
  conversationsReplyOp,
} from "../conversations";
import { threadsCreateOp } from "../forums";
import { profileCommentsCreateOp, profilePostsCreateOp } from "../profiles";
import { reportsViewConversationMessageOp } from "./conversation-reports";
import { createReport } from "./index";
import { restrictionsCreateOp, restrictionsLiftOp, restrictionsListOp } from "./restrictions";

describe("member restrictions", () => {
  test("each kind blocks its permission and lifting the latest restores the previous expiry", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const member = insertUser(ctx);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const peer = insertUser(ctx, { groupId: 3 });
    const future = new Date(ctx.now() + 60_000).toISOString();
    expect(can(ctx, userActor(member), "forum.createThread", { nodeId: node.id })).toBe(true);
    expect(can(ctx, userActor(member), "conversation.start")).toBe(true);
    expect(can(ctx, userActor(member), "profilePost.post")).toBe(true);
    const first = await execute(ctx, restrictionsCreateOp, moderator, {
      userId: member.id,
      kind: "posting",
      reason: "Posting",
      expiresAt: future,
    });
    expect(first.active).toBe(true);
    const restrictedEvent = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'member.restricted' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(restrictedEvent.payload)).toMatchObject({
      moderatorId: moderator.kind === "guest" ? 0 : moderator.userId,
      reason: "Posting",
      kind: "posting",
      lifted: false,
      notify: true,
    });
    expect(can(ctx, userActor(member), "forum.createThread", { nodeId: node.id })).toBe(false);
    expect(
      can(ctx, userActor(member), "forum.reply", { nodeId: node.id, threadBanned: false }),
    ).toBe(false);
    expect(can(ctx, userActor(member), "conversation.start")).toBe(true);
    expect(can(ctx, userActor(member), "profilePost.post")).toBe(true);
    const second = await execute(ctx, restrictionsCreateOp, moderator, {
      userId: member.id,
      kind: "posting",
      reason: "Permanent",
    });
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT restricted_posting_until AS n FROM users WHERE id = ?1",
        )
        .get(member.id)!.n,
    ).toBeGreaterThan(Date.parse(future));
    await execute(ctx, restrictionsLiftOp, moderator, { restrictionId: second.id });
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT restricted_posting_until AS n FROM users WHERE id = ?1",
        )
        .get(member.id)!.n,
    ).toBe(Date.parse(future));
    await execute(ctx, restrictionsLiftOp, moderator, { restrictionId: first.id });
    expect(
      ctx.sqlite
        .prepare<{ n: number | null }, [number]>(
          "SELECT restricted_posting_until AS n FROM users WHERE id = ?1",
        )
        .get(member.id)!.n,
    ).toBeNull();
    const expiring = await execute(ctx, restrictionsCreateOp, moderator, {
      userId: member.id,
      kind: "posting",
      reason: "Short",
      expiresAt: future,
    });
    ctx.clock.advance(60_001);
    expect(
      (await execute(ctx, restrictionsListOp, userActor(member), { userId: member.id })).items.find(
        (item) => item.id === expiring.id,
      )?.active,
    ).toBe(false);
    expect(can(ctx, userActor(member), "forum.createThread", { nodeId: node.id })).toBe(true);
    await execute(ctx, restrictionsLiftOp, moderator, {
      restrictionId: expiring.id,
      message: "Expired",
    });
    const liftedEvent = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'member.restricted' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(liftedEvent.payload)).toMatchObject({
      lifted: true,
      notify: false,
      kind: "posting",
    });
    const conversation = await execute(ctx, restrictionsCreateOp, moderator, {
      userId: member.id,
      kind: "conversations",
      reason: "Conversation",
    });
    expect(can(ctx, userActor(member), "conversation.start")).toBe(false);
    expect(can(ctx, userActor(member), "profilePost.post")).toBe(true);
    expect(
      ctx.sqlite
        .prepare<{ n: number | null }, [number]>(
          "SELECT restricted_conversations_until AS n FROM users WHERE id = ?1",
        )
        .get(member.id)!.n,
    ).not.toBeNull();
    expect(
      ctx.sqlite
        .prepare<{ n: number | null }, [number]>(
          "SELECT restricted_profile_posts_until AS n FROM users WHERE id = ?1",
        )
        .get(member.id)!.n,
    ).toBeNull();
    await execute(ctx, restrictionsLiftOp, moderator, { restrictionId: conversation.id });
    const profile = await execute(ctx, restrictionsCreateOp, moderator, {
      userId: member.id,
      kind: "profile_posts",
      reason: "Wall",
    });
    expect(can(ctx, userActor(member), "profilePost.post")).toBe(false);
    expect(can(ctx, userActor(member), "profilePost.comment")).toBe(false);
    expect(can(ctx, userActor(member), "conversation.start")).toBe(true);
    expect(profile.active).toBe(true);
    expect(
      (await execute(ctx, restrictionsListOp, userActor(member), { userId: member.id })).items,
    ).toHaveLength(5);
    await expect(
      execute(ctx, restrictionsListOp, userActor(insertUser(ctx)), { userId: member.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, restrictionsCreateOp, userActor(member), {
        userId: moderator.kind === "guest" ? 0 : moderator.userId,
        kind: "posting",
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, restrictionsCreateOp, moderator, {
        userId: peer.id,
        kind: "posting",
        reason: "Peer",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, restrictionsListOp, GUEST, { userId: member.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expectNoTableScan(
      ctx,
      "SELECT * FROM user_restrictions WHERE user_id = ?1 AND kind = ?2 ORDER BY id DESC",
      [member.id, "posting"],
    );
    expectNoTableScan(
      ctx,
      "SELECT max(coalesce(expires_at, ?4)) AS expiry FROM user_restrictions WHERE user_id = ?1 AND kind = ?2 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?3)",
      [member.id, "posting", ctx.now(), 253_402_300_799_999],
    );
  });
});

describe("reported conversation context", () => {
  test("only a reported message opens a seven-message window, with an audit row per access", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const recipient = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    if (author.kind === "guest" || recipient.kind === "guest") throw new Error("fixture");
    const started = await execute(ctx, conversationsCreateOp, author, {
      title: "Private",
      recipientIds: [recipient.userId],
      body: "Message 0",
    });
    const ids = [started.message.id];
    for (let i = 1; i < 9; i++) {
      const reply = await execute(ctx, conversationsReplyOp, author, {
        conversationId: started.conversation.id,
        body: `Message ${i}`,
      });
      ids.push(reply.id);
    }
    const reported = createReport(
      ctx,
      recipient,
      { type: "conversation_message", id: ids[4]! },
      "Report",
    );
    await expect(
      execute(ctx, reportsViewConversationMessageOp, moderator, { groupId: reported.groupId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, reportsViewConversationMessageOp, admin, { groupId: reported.groupId + 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (let i = 0; i < 2; i++) {
      const result = await execute(ctx, reportsViewConversationMessageOp, admin, {
        groupId: reported.groupId,
      });
      expect(result.messages.map((message) => message.id)).toEqual(ids.slice(1, 8));
      expect(
        result.messages.filter((message) => message.reported).map((message) => message.id),
      ).toEqual([ids[4]!]);
    }
    ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'deleted' WHERE id IN (?1, ?2)")
      .run(ids[2]!, ids[4]!);
    ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(ids[6]!);
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 3, 0, 1 FROM permission_definitions WHERE key = 'conversation.moderate' ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = 1",
      )
      .run();
    invalidate(ctx, "permissions");
    const limited = await execute(ctx, reportsViewConversationMessageOp, moderator, {
      groupId: reported.groupId,
    });
    expect(limited.messages.map((message) => message.id)).toEqual([
      ids[0]!,
      ids[1]!,
      ids[3]!,
      ids[4]!,
      ids[5]!,
      ids[7]!,
      ids[8]!,
    ]);
    expect(limited.messages.find((message) => message.reported)?.id).toBe(ids[4]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'conversation_message.view'",
        )
        .get()!.n,
    ).toBe(3);
    await expect(
      execute(ctx, conversationsListMessagesOp, admin, { conversationId: started.conversation.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expectNoTableScan(
      ctx,
      "SELECT m.id, m.user_id AS author_id, u.username AS author_username, m.body_html, m.created_at FROM conversation_messages m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?1 AND m.id < ?2 AND (m.state = 'visible' OR ?3 = 1) ORDER BY m.id DESC LIMIT 3",
      [started.conversation.id, ids[4], 0],
    );
    expectNoTableScan(
      ctx,
      "SELECT m.id, m.user_id AS author_id, u.username AS author_username, m.body_html, m.created_at FROM conversation_messages m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?1 AND m.id > ?2 AND (m.state = 'visible' OR ?3 = 1) ORDER BY m.id LIMIT 3",
      [started.conversation.id, ids[4], 0],
    );
  });
});

test("reports cannot target private profile posts or comments without wall access", async () => {
  const ctx = createTestContext();
  const wall = insertUser(ctx);
  const outsider = insertUser(ctx);
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const post = await execute(ctx, profilePostsCreateOp, userActor(wall), {
    userId: wall.id,
    body: "Post",
  });
  const comment = await execute(ctx, profileCommentsCreateOp, userActor(outsider), {
    profilePostId: post.id,
    body: "Comment",
  });
  ctx.sqlite.prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1").run(wall.id);
  expect(() =>
    createReport(ctx, userActor(outsider), { type: "profile_post", id: post.id }, "Report"),
  ).toThrow(NotFoundError);
  expect(() =>
    createReport(
      ctx,
      userActor(outsider),
      { type: "profile_post_comment", id: comment.id },
      "Report",
    ),
  ).toThrow(NotFoundError);
  expect(
    createReport(ctx, moderator, { type: "profile_post", id: post.id }, "Report").groupId,
  ).toBeGreaterThan(0);
});

test("moderation operations carry notice data on their existing event types", async () => {
  const ctx = createTestContext();
  const member = insertUser(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const reporter = userActor(insertUser(ctx));
  const post = await execute(ctx, profilePostsCreateOp, userActor(member), {
    userId: member.id,
    body: "Reported",
  });
  const report = createReport(ctx, reporter, { type: "profile_post", id: post.id }, "Report");
  const notice = { notify: false, message: "Please read the rules", reason: "Rule" };
  await execute(ctx, getOperation("warnings.create"), admin, {
    userId: member.id,
    points: 1,
    ...notice,
  });
  const warning = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'member.warned' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(warning.payload)).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, getOperation("reports.setState"), admin, {
    groupId: report.groupId,
    state: "resolved",
    ...notice,
  });
  const reportEvent = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'report.state_changed' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(reportEvent.payload)).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, getOperation("moderation.setState"), admin, {
    target: { type: "profile_post", id: post.id },
    state: "deleted",
    ...notice,
  });
  const deleted = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'content.deleted' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(deleted.payload)).toMatchObject({
    actorId: admin.kind === "guest" ? 0 : admin.userId,
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, getOperation("moderation.bulk"), admin, {
    targets: [{ type: "profile_post", id: post.id }],
    action: "restore",
    ...notice,
  });
  const restored = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'content.state_changed' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(restored.payload)).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  const ban = (await execute(ctx, getOperation("bans.create"), admin, {
    userId: member.id,
    expiresAt: null,
    ...notice,
  })) as { id: number };
  await execute(ctx, getOperation("bans.lift"), admin, { banId: ban.id, ...notice });
  const bans = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'member.banned' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(bans.payload)).toMatchObject({
    lifted: true,
    notify: false,
    message: notice.message,
  });
  await execute(ctx, getOperation("spamCleanup.start"), admin, { userId: member.id, ...notice });
  const spamBan = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'member.banned' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(spamBan.payload)).toMatchObject({
    lifted: false,
    notify: false,
    message: notice.message,
  });
  const firstNode = insertNode(ctx, {});
  const secondNode = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const thread = await execute(ctx, threadsCreateOp, reporter, {
    nodeId: firstNode.id,
    title: "Move me",
    body: "Body",
  });
  await execute(ctx, getOperation("moderation.bulk"), admin, {
    targets: [{ type: "thread", id: thread.thread.id }],
    action: "move",
    nodeId: secondNode.id,
    ...notice,
  });
  const moved = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'content.edited' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(moved.payload)).toMatchObject({
    movedToNodeId: secondNode.id,
    notify: false,
    message: notice.message,
  });
  await execute(ctx, getOperation("moderation.bulk"), admin, {
    targets: [{ type: "thread", id: thread.thread.id }],
    action: "lock",
    ...notice,
  });
  const locked = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'content.edited' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(locked.payload)).toMatchObject({
    isLocked: true,
    notify: false,
    message: notice.message,
  });
  const ownPost = await execute(ctx, profilePostsCreateOp, admin, {
    userId: admin.kind === "guest" ? 0 : admin.userId,
    body: "Own",
  });
  await execute(ctx, getOperation("moderation.setState"), admin, {
    target: { type: "profile_post", id: ownPost.id },
    state: "deleted",
    ...notice,
  });
  const ownEvent = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'content.deleted' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(ownEvent.payload)).not.toHaveProperty("notify");
  expect(JSON.parse(ownEvent.payload)).not.toHaveProperty("actorId");
  const expiredTarget = insertUser(ctx);
  const temporary = (await execute(ctx, getOperation("bans.create"), admin, {
    userId: expiredTarget.id,
    expiresAt: new Date(ctx.now() + 1_000).toISOString(),
    ...notice,
  })) as { id: number };
  ctx.clock.advance(1_001);
  await execute(ctx, getOperation("bans.lift"), admin, { banId: temporary.id });
  const expiredBan = ctx.sqlite
    .prepare<{ payload: string }, []>(
      "SELECT payload FROM domain_events WHERE type = 'member.banned' ORDER BY id DESC LIMIT 1",
    )
    .get()!;
  expect(JSON.parse(expiredBan.payload)).toMatchObject({ lifted: true, notify: false });
});
