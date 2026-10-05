import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { getAuth, resolveActor } from "../auth";
import {
  conversationsCreateOp,
  conversationsGetOp,
  conversationsListMessagesOp,
} from "../conversations";
import { forumSql, postsCreateOp, postsUpdateOp, threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { updateSiteSettings } from "../settings";
import {
  addWarning,
  applyWordFilters,
  approvalSql,
  banUser,
  bulkModerate,
  cleanupSpam,
  createReport,
  liftBan,
  listApprovals,
  listModeratorLog,
  listPostRevisions,
  listReports,
  moderateContent,
  recordPostRevision,
  registerModerationJobs,
  resumeSpamCleanup,
  setReportState,
  upsertWordFilter,
} from ".";

describe("moderation core", () => {
  test("queued spam cleanup bans immediately and deletes public and private content", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const spammer = userActor(insertUser(ctx));
    const recipient = userActor(insertUser(ctx));
    const adminActor = userActor(insertUser(ctx, { groupId: 4 }));
    if (spammer.kind === "guest" || recipient.kind === "guest") throw new Error("fixture");
    const thread = await execute(ctx, threadsCreateOp, spammer, {
      nodeId: node.id,
      title: "Spam",
      body: "Spam",
    });
    const conversation = await execute(ctx, conversationsCreateOp, spammer, {
      title: "Spam",
      recipientIds: [recipient.userId],
      body: "Spam",
    });
    const queued = await execute(ctx, getOperation("spamCleanup.start"), adminActor, {
      userId: spammer.userId,
    });
    expect(queued.jobId).toBeGreaterThan(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT banned_permanently AS n FROM users WHERE id = ?1")
        .get(spammer.userId)?.n,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(thread.thread.id)?.state,
    ).toBe("visible");
    registerModerationJobs(ctx);
    expect(await runDueJobs(ctx)).toBeGreaterThan(0);
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(thread.thread.id)?.state,
    ).toBe("deleted");
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>(
          "SELECT state FROM conversation_messages WHERE id = ?1",
        )
        .get(conversation.message.id)?.state,
    ).toBe("deleted");
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, recipient, {
          conversationId: conversation.conversation.id,
        })
      ).items,
    ).toEqual([]);
  });
  test("service ban blocks the next authenticated request and queues credential revocation", async () => {
    const ctx = createTestContext();
    const adminActor = userActor(insertUser(ctx, { groupId: 4 }));
    const response = await getAuth(ctx).api.signUpEmail({
      body: {
        name: "Banned",
        email: "banned@example.test",
        username: "Banned_1",
        password: "password123",
      },
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const user = (await response.json()) as { user: { id: string } };
    const userId = Number(user.user.id);
    const key = await getAuth(ctx).api.createApiKey({
      headers: new Headers({ cookie }),
      body: { name: "ban-test" },
    });
    expect((await resolveActor(ctx, new Headers({ cookie }))).actor.kind).toBe("user");
    banUser(ctx, adminActor, userId, "spam", null);
    await expect(resolveActor(ctx, new Headers({ cookie }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resolveActor(ctx, new Headers({ "x-api-key": key.key }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    registerModerationJobs(ctx);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM auth_session WHERE user_id = ?1",
        )
        .get(userId)?.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM auth_apikey WHERE reference_id = ?1",
        )
        .get(String(userId))?.n,
    ).toBe(0);
  });
  test("REST and MCP operation contracts validate moderation responses", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const reporter = userActor(insertUser(ctx));
    const adminActor = userActor(insertUser(ctx, { groupId: 4 }));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "T",
      body: "B",
    });
    const report = await execute(ctx, getOperation("reports.create"), reporter, {
      target: { type: "post", id: thread.post.id },
      reason: "Review",
    });
    expect(
      (await execute(ctx, getOperation("reports.list"), adminActor, { limit: 20 })).items[0]?.id,
    ).toBe(report.groupId);
    expect(
      (await execute(ctx, getOperation("reports.get"), adminActor, { groupId: report.groupId }))
        .reports,
    ).toHaveLength(1);
    await execute(ctx, getOperation("reports.setState"), adminActor, {
      groupId: report.groupId,
      state: "resolved",
    });
    expect(
      (await execute(ctx, getOperation("moderatorLog.list"), adminActor, { limit: 20 })).items[0]
        ?.action,
    ).toBe("report.resolved");
    await execute(ctx, getOperation("wordFilters.upsert"), adminActor, {
      term: "bad",
      action: "replace",
      replacement: "good",
    });
    expect(
      (await execute(ctx, getOperation("wordFilters.list"), adminActor, {})).items[0]?.isActive,
    ).toBe(true);
    await execute(ctx, getOperation("warnings.create"), adminActor, {
      userId: actorUserId(author),
      points: 1,
      reason: "Rule",
    });
    expect(
      (
        await execute(ctx, getOperation("warnings.list"), author, {
          userId: actorUserId(author),
          limit: 20,
        })
      ).items,
    ).toHaveLength(1);
    await execute(ctx, getOperation("moderation.setState"), adminActor, {
      target: { type: "thread", id: thread.thread.id },
      state: "moderated",
    });
    expect(
      (await execute(ctx, getOperation("approvals.list"), adminActor, { limit: 20 })).items,
    ).toHaveLength(1);
  });
  test("private messages enter approval without exposing bodies to recipients", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const recipient = userActor(insertUser(ctx));
    const adminActor = userActor(insertUser(ctx, { groupId: 4 }));
    if (recipient.kind === "guest") throw new Error("fixture");
    upsertWordFilter(ctx, adminActor, { term: "blocked", action: "moderate" });
    const made = await execute(ctx, conversationsCreateOp, author, {
      title: "Private",
      recipientIds: [recipient.userId],
      body: "blocked",
    });
    expect(made.message.state).toBe("moderated");
    expect(made.conversation.messageCount).toBe(0);
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, recipient, {
          conversationId: made.conversation.id,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, author, {
          conversationId: made.conversation.id,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      listApprovals(ctx, adminActor).items.some(
        (item) => item.type === "conversation_message" && item.id === made.message.id,
      ),
    ).toBe(true);
    moderateContent(
      ctx,
      adminActor,
      { type: "conversation_message", id: made.message.id },
      "visible",
    );
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, recipient, {
          conversationId: made.conversation.id,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (await execute(ctx, conversationsGetOp, recipient, { conversationId: made.conversation.id }))
        .isUnread,
    ).toBe(true);
    moderateContent(
      ctx,
      adminActor,
      { type: "conversation_message", id: made.message.id },
      "deleted",
    );
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, recipient, {
          conversationId: made.conversation.id,
        })
      ).items,
    ).toEqual([]);
  });
  test("configured first-post, link, and word rules enter approval with correct counters", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const adminActor = userActor(insertUser(ctx, { groupId: 4 }));
    updateSiteSettings(ctx, adminActor, {
      firstPostsToModerate: 2,
      moderateLinksFromNewMembers: true,
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "First",
      body: "hello",
    });
    expect(thread.thread.state).toBe("moderated");
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT thread_count AS n FROM nodes WHERE id = ?1")
        .get(node.id)?.n,
    ).toBe(0);
    expect(
      listApprovals(ctx, adminActor).items.some(
        (item) => item.type === "thread" && item.id === thread.thread.id,
      ),
    ).toBe(true);
    moderateContent(ctx, adminActor, { type: "thread", id: thread.thread.id }, "visible");
    const second = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "second",
    });
    expect(second.state).toBe("moderated");
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT reply_count AS n FROM threads WHERE id = ?1")
        .get(thread.thread.id)?.n,
    ).toBe(0);
    moderateContent(ctx, adminActor, { type: "post", id: second.id }, "visible");
    const link = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "https://example.test",
    });
    expect(link.state).toBe("moderated");
    upsertWordFilter(ctx, adminActor, { term: "blocked", action: "moderate" });
    upsertWordFilter(ctx, adminActor, {
      term: "replace-me",
      action: "replace",
      replacement: "clean",
    });
    const filtered = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "replace-me blocked",
    });
    expect(filtered.state).toBe("moderated");
    expect(filtered.bodySource).toBe("clean blocked");
    await execute(ctx, postsUpdateOp, author, { postId: second.id, body: "edited" });
    expect(listPostRevisions(ctx, adminActor, second.id).items[0]).toMatchObject({
      body_source: "second",
    });
  });
  test("groups reports and hides inaccessible targets", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const reporter = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const created = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    const target = { type: "post" as const, id: created.post.id };
    expect(() => createReport(ctx, GUEST, target, "spam")).toThrow();
    expect(createReport(ctx, reporter, target, "spam").groupId).toBe(
      createReport(ctx, author, target, "abuse").groupId,
    );
    const group = listReports(ctx, moderator).items[0]!;
    expect(group.report_count).toBe(2);
    setReportState(ctx, moderator, group.id, "resolved", "handled");
    expect(
      listModeratorLog(ctx, userActor(insertUser(ctx, { groupId: 4 }))).items[0],
    ).toMatchObject({ action: "report.resolved", target_id: target.id });
    moderateContent(ctx, moderator, { type: "thread", id: created.thread.id }, "deleted");
    expect(() => createReport(ctx, reporter, target, "hidden")).toThrow(NotFoundError);
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(node.id);
    invalidate(ctx, "permissions");
    expect(() => createReport(ctx, reporter, target, "hidden")).toThrow(NotFoundError);
  });

  test("bulk state changes preserve positions, counters and log coverage", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const created = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: created.thread.id,
      body: "Reply",
    });
    const target = { type: "post" as const, id: reply.id };
    expect(() => moderateContent(ctx, author, target, "deleted")).toThrow(NotFoundError);
    expect(bulkModerate(ctx, mod, [target], "delete", "spam").changed).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM nodes WHERE id = ?1")
        .get(node.id)!.post_count,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
        .get(reply.id)!.position,
    ).toBe(1);
    expect(bulkModerate(ctx, mod, [target], "restore").changed).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM nodes WHERE id = ?1")
        .get(node.id)!.post_count,
    ).toBe(2);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM moderator_log").get()!.n,
    ).toBe(2);
  });

  test("filters, warning expiry, bans and revisions", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const member = userActor(insertUser(ctx));
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    expect(() =>
      upsertWordFilter(ctx, member, { term: "foo", action: "replace", replacement: "bar" }),
    ).toThrow(ForbiddenError);
    upsertWordFilter(ctx, admin, { term: "foo", action: "replace", replacement: "bar" });
    upsertWordFilter(ctx, admin, { term: "bad", action: "moderate" });
    expect(applyWordFilters(ctx, "foo bad")).toEqual({ source: "bar bad", moderated: true });
    const thread = await execute(ctx, threadsCreateOp, member, {
      nodeId: node.id,
      title: "T",
      body: "Original",
    });
    recordPostRevision(ctx, member, thread.post.id);
    expect(() => listPostRevisions(ctx, member, thread.post.id)).toThrow(NotFoundError);
    expect(listPostRevisions(ctx, admin, thread.post.id).items).toHaveLength(1);
    expect(() => listPostRevisions(ctx, userActor(insertUser(ctx)), thread.post.id)).toThrow(
      NotFoundError,
    );
    expect(
      addWarning(ctx, admin, actorUserId(member)!, 2, "reason", ctx.now() + 100).activePoints,
    ).toBe(2);
    ctx.clock.advance(101);
    expect(addWarning(ctx, admin, actorUserId(member)!, 1, "reason").activePoints).toBe(1);
    const ban = banUser(ctx, admin, actorUserId(member)!, "reason", null);
    expect(
      ctx.sqlite
        .prepare<{ banned_permanently: number }, [number]>(
          "SELECT banned_permanently FROM users WHERE id = ?1",
        )
        .get(actorUserId(member)!)!.banned_permanently,
    ).toBe(1);
    liftBan(ctx, admin, ban.id, "appeal");
    expect(
      ctx.sqlite
        .prepare<{ banned_permanently: number }, [number]>(
          "SELECT banned_permanently FROM users WHERE id = ?1",
        )
        .get(actorUserId(member)!)!.banned_permanently,
    ).toBe(0);
  });

  test("approval query uses indexed post order", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, approvalSql, [Number.MAX_SAFE_INTEGER, 50]);
    expectNoTableScan(ctx, forumSql.nodeLast, [1, 0]);
    expectNoTableScan(ctx, forumSql.nodeLast, [1, 1]);
    expectNoTableScan(
      ctx,
      "SELECT * FROM report_groups WHERE state = ?1 AND (updated_at, id) < (?2, ?3) ORDER BY updated_at DESC, id DESC LIMIT ?4",
      ["open", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 50],
    );
    expectNoTableScan(
      ctx,
      "SELECT * FROM moderator_log WHERE (created_at, id) < (?1, ?2) ORDER BY created_at DESC, id DESC LIMIT ?3",
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 50],
    );
  });

  test("private conversations and hidden profile content stay out of reports", () => {
    const ctx = createTestContext();
    const participant = userActor(insertUser(ctx));
    const outsider = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const now = ctx.now();
    const conversationId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id, message_count, participant_count) VALUES ('Private', ?1, ?2, ?2, ?1, 1, 1)",
        )
        .run(actorUserId(participant)!, now).lastInsertRowid,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_message_at) VALUES (?1, ?2, ?3, ?3)",
      )
      .run(conversationId, actorUserId(participant)!, now);
    const messageId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'Private', '<p>Private</p>')",
        )
        .run(conversationId, actorUserId(participant)!, now).lastInsertRowid,
    );
    ctx.sqlite
      .prepare("UPDATE conversations SET last_message_id = ?1 WHERE id = ?2")
      .run(messageId, conversationId);
    expect(() =>
      createReport(ctx, outsider, { type: "conversation_message", id: messageId }, "spam"),
    ).toThrow(NotFoundError);
    expect(() =>
      createReport(ctx, moderator, { type: "conversation_message", id: messageId }, "spam"),
    ).toThrow(NotFoundError);
    createReport(ctx, participant, { type: "conversation_message", id: messageId }, "spam");
    expect(listReports(ctx, moderator).items).toHaveLength(0);
    const profileId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?1, 'moderated', ?2, 'Hidden', '<p>Hidden</p>')",
        )
        .run(actorUserId(participant)!, now).lastInsertRowid,
    );
    expect(() =>
      createReport(ctx, outsider, { type: "profile_post", id: profileId }, "spam"),
    ).toThrow(NotFoundError);
    createReport(ctx, moderator, { type: "profile_post", id: profileId }, "spam");
    expect(listReports(ctx, moderator).items).toHaveLength(1);
  });

  test("warning threshold counts only unexpired points and logs automatic ban", () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const target = insertUser(ctx);
    updateSiteSettings(ctx, admin, { warningBanThreshold: 3, warningBanDays: 2 });
    addWarning(ctx, admin, target.id, 2, "old", ctx.now() + 10);
    ctx.clock.advance(11);
    expect(addWarning(ctx, admin, target.id, 2, "current").activePoints).toBe(2);
    addWarning(ctx, admin, target.id, 1, "threshold");
    expect(
      ctx.sqlite
        .prepare<{ banned_until: number }, [number]>("SELECT banned_until FROM users WHERE id = ?1")
        .get(target.id)!.banned_until,
    ).toBe(ctx.now() + 2 * 86_400_000);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'ban.threshold'",
        )
        .get()!.n,
    ).toBe(1);
  });

  test("lifting one of several bans retains the strongest active ban", () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const target = insertUser(ctx);
    const short = banUser(ctx, admin, target.id, "short", ctx.now() + 100);
    const permanent = banUser(ctx, admin, target.id, "permanent", null);
    liftBan(ctx, admin, short.id, "appeal");
    expect(
      ctx.sqlite
        .prepare<{ banned_permanently: number }, [number]>(
          "SELECT banned_permanently FROM users WHERE id = ?1",
        )
        .get(target.id)!.banned_permanently,
    ).toBe(1);
    liftBan(ctx, admin, permanent.id, "appeal");
    expect(
      ctx.sqlite
        .prepare<{ banned_until: number | null }, [number]>(
          "SELECT banned_until FROM users WHERE id = ?1",
        )
        .get(target.id)!.banned_until,
    ).toBeNull();
  });

  test("approval queue includes moderated forum and profile content with a stable cursor", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "T",
      body: "First",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "Reply",
    });
    moderateContent(ctx, mod, { type: "post", id: reply.id }, "moderated");
    const profileId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?1, 'moderated', ?2, 'Body', '<p>Body</p>')",
        )
        .run(actorUserId(author)!, ctx.now()).lastInsertRowid,
    );
    const first = listApprovals(ctx, mod, { limit: 1 });
    const second = listApprovals(ctx, mod, { cursor: first.nextCursor, limit: 1 });
    expect([...first.items, ...second.items].map((item) => item.type).sort()).toEqual([
      "post",
      "profile_post",
    ]);
    expect([...first.items, ...second.items].map((item) => item.id)).toContain(profileId);
  });

  test("spam cleanup hides recent public content and records each action", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const spammer = userActor(insertUser(ctx));
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const created = await execute(ctx, threadsCreateOp, spammer, {
      nodeId: node.id,
      title: "Spam",
      body: "Body",
    });
    const profileId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?1, ?2, 'Body', '<p>Body</p>')",
        )
        .run(actorUserId(spammer)!, ctx.now()).lastInsertRowid,
    );
    expect(cleanupSpam(ctx, admin, actorUserId(spammer)!, ctx.now() - 1).changed).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(created.thread.id)!.state,
    ).toBe("deleted");
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM profile_posts WHERE id = ?1")
        .get(profileId)!.state,
    ).toBe("deleted");
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'bulk.delete'",
        )
        .get()!.n,
    ).toBe(2);
  });

  test("spam cleanup bans once and resumes past 100 old items", () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const spammer = insertUser(ctx);
    const insert = ctx.sqlite.prepare(
      "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?1, ?2, 'Spam', '<p>Spam</p>')",
    );
    for (let i = 0; i < 205; i++) insert.run(spammer.id, ctx.now() - 1_000_000);
    expect(() => cleanupSpam(ctx, mod, spammer.id, ctx.now())).toThrow(ForbiddenError);
    let batch = cleanupSpam(ctx, admin, spammer.id, ctx.now(), 100);
    expect(batch.changed).toBe(100);
    expect(batch.nextCursor).not.toBeNull();
    while (batch.nextCursor)
      batch = resumeSpamCleanup(ctx, admin, spammer.id, batch.nextCursor, 100);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM profile_posts WHERE user_id = ?1 AND state != 'deleted'",
        )
        .get(spammer.id)!.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM bans WHERE user_id = ?1 AND reason = 'Spam cleanup'",
        )
        .get(spammer.id)!.n,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'moderation.cleanupSpam'",
        )
        .get()!.n,
    ).toBeGreaterThan(0);
  });

  test("no-op moderation decisions are logged", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const created = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "T",
      body: "Body",
    });
    expect(
      moderateContent(ctx, mod, { type: "thread", id: created.thread.id }, "visible").changed,
    ).toBe(false);
    expect(
      bulkModerate(ctx, mod, [{ type: "thread", id: created.thread.id }], "unlock").changed,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM moderator_log WHERE details LIKE '%\"changed\":false%'",
        )
        .get()!.n,
    ).toBe(2);
  });

  test("thread hide, restore and move use reply counter for node totals", async () => {
    const ctx = createTestContext();
    const source = insertNode(ctx, {});
    const destination = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const replier = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: source.id,
      title: "T",
      body: "Body",
    });
    await execute(ctx, postsCreateOp, replier, { threadId: thread.thread.id, body: "Reply" });
    const counts = (id: number) =>
      ctx.sqlite
        .prepare<{ thread_count: number; post_count: number }, [number]>(
          "SELECT thread_count, post_count FROM nodes WHERE id = ?1",
        )
        .get(id);
    moderateContent(ctx, mod, { type: "thread", id: thread.thread.id }, "deleted");
    expect(counts(source.id)).toEqual({ thread_count: 0, post_count: 0 });
    moderateContent(ctx, mod, { type: "thread", id: thread.thread.id }, "visible");
    expect(counts(source.id)).toEqual({ thread_count: 1, post_count: 2 });
    bulkModerate(
      ctx,
      mod,
      [{ type: "thread", id: thread.thread.id }],
      "move",
      "rehome",
      destination.id,
    );
    expect(counts(source.id)).toEqual({ thread_count: 0, post_count: 0 });
    expect(counts(destination.id)).toEqual({ thread_count: 1, post_count: 2 });
  });

  test("large thread state change updates every author immediately", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const secondAuthor = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Large",
      body: "First",
    });
    const add = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    for (let position = 1; position <= 257; position++)
      add.run(
        thread.thread.id,
        position % 2 ? actorUserId(author)! : actorUserId(secondAuthor)!,
        position,
        ctx.now(),
      );
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 257 WHERE id = ?1").run(thread.thread.id);
    ctx.sqlite.prepare("UPDATE nodes SET post_count = 258 WHERE id = ?1").run(node.id);
    ctx.sqlite.prepare("UPDATE users SET post_count = 130 WHERE id = ?1").run(actorUserId(author)!);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = 128 WHERE id = ?1")
      .run(actorUserId(secondAuthor)!);
    const userCount = (id: number) =>
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
        .get(id)!.post_count;
    moderateContent(ctx, mod, { type: "thread", id: thread.thread.id }, "deleted");
    expect(
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM nodes WHERE id = ?1")
        .get(node.id)!.post_count,
    ).toBe(0);
    expect(userCount(actorUserId(author)!)).toBe(0);
    expect(userCount(actorUserId(secondAuthor)!)).toBe(0);
    moderateContent(ctx, mod, { type: "thread", id: thread.thread.id }, "visible");
    expect(userCount(actorUserId(author)!)).toBe(130);
    expect(userCount(actorUserId(secondAuthor)!)).toBe(128);
  });
});
