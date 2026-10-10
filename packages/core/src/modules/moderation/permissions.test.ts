import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import type { PermissionId } from "../../permissions";
import { conversationsCreateOp } from "../conversations";
import { postsCreateOp, threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { updateSiteSettings } from "../settings";
import {
  addWarning,
  banUser,
  bulkModerate,
  cleanupSpam,
  createReport,
  liftBan,
  listApprovals,
  listModeratorLog,
  listPostRevisions,
  listReports,
  listWarnings,
  listWordFilters,
  moderateContent,
  moderateEditedContent,
  recordPostRevision,
  registerModerationJobs,
  upsertWordFilter,
} from ".";

function grant(ctx: Ctx, permission: PermissionId, groupId: number, nodeId = 0) {
  const definition = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
    .get(permission)!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, ?3, 0, 1)",
    )
    .run(definition, nodeId, groupId);
}

function group(ctx: Ctx, title: string, rank = 20): number {
  return ctx.sqlite
    .prepare<{ id: number }, [string, number]>(
      "INSERT INTO groups (title, rank) VALUES (?1, ?2) RETURNING id",
    )
    .get(title, rank)!.id;
}

describe("moderation permission decisions", () => {
  test("a group granted reports on one node sees only that node's reports", async () => {
    const ctx = createTestContext();
    const first = insertNode(ctx, {});
    const second = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const reporter = userActor(insertUser(ctx));
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Report triage', 20) RETURNING id",
      )
      .get()!.id;
    grant(ctx, "node.view", groupId, first.id);
    grant(ctx, "node.view", groupId, second.id);
    grant(ctx, "forum.manageReports", groupId, first.id);
    const triager = userActor(insertUser(ctx, { groupId }));
    const firstThread = await execute(ctx, threadsCreateOp, author, {
      nodeId: first.id,
      title: "First",
      body: "Body",
    });
    const secondThread = await execute(ctx, threadsCreateOp, author, {
      nodeId: second.id,
      title: "Second",
      body: "Body",
    });
    const visible = createReport(
      ctx,
      reporter,
      { type: "post", id: firstThread.post.id },
      "First report",
    );
    const hidden = createReport(
      ctx,
      reporter,
      { type: "post", id: secondThread.post.id },
      "Second report",
    );
    expect(listReports(ctx, triager).items.map((group) => group.id)).toEqual([visible.groupId]);
    expect((await execute(ctx, getOperation("reports.list"), author, {})).items).toEqual([]);
    await expect(
      execute(ctx, getOperation("reports.get"), triager, { groupId: hidden.groupId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("approval permission admits the queue and approval action without granting deletion", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Approvers', 20) RETURNING id",
      )
      .get()!.id;
    grant(ctx, "node.view", groupId, node.id);
    grant(ctx, "forum.approve", groupId, node.id);
    const approver = userActor(insertUser(ctx, { groupId }));
    const created = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Review",
      body: "Body",
    });
    const target = { type: "thread" as const, id: created.thread.id };
    moderateContent(ctx, admin, target, "moderated");
    expect(
      listApprovals(ctx, approver).items.some(
        (item) => item.type === "thread" && item.id === target.id,
      ),
    ).toBe(true);
    expect((await execute(ctx, getOperation("approvals.list"), author, {})).items).toEqual([]);
    expect(moderateContent(ctx, approver, target, "visible").changed).toBe(true);
    expect(() => moderateContent(ctx, approver, target, "deleted")).toThrow(NotFoundError);
  });

  test("forum editing requires editAny, independently of deleteAny", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Edits",
      body: "First",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "Reply",
    });
    const deleters = group(ctx, "Deleters");
    grant(ctx, "node.view", deleters, node.id);
    grant(ctx, "forum.deleteAny", deleters, node.id);
    const deleter = userActor(insertUser(ctx, { groupId: deleters }));
    expect(() => recordPostRevision(ctx, deleter, reply.id)).toThrow(NotFoundError);
    expect(() => moderateEditedContent(ctx, deleter, { type: "post", id: reply.id })).toThrow(
      NotFoundError,
    );
    const editors = group(ctx, "Editors");
    grant(ctx, "node.view", editors, node.id);
    grant(ctx, "forum.editAny", editors, node.id);
    const editor = userActor(insertUser(ctx, { groupId: editors }));
    expect(recordPostRevision(ctx, editor, reply.id)).toBeGreaterThan(0);
    writeTx(ctx, () => moderateEditedContent(ctx, editor, { type: "post", id: reply.id }));
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM posts WHERE id = ?1")
        .get(reply.id)!.state,
    ).toBe("moderated");
  });

  test("move requires forum.move on both the target and destination nodes", async () => {
    const ctx = createTestContext();
    const source = insertNode(ctx, {});
    const destination = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const created = await execute(ctx, threadsCreateOp, author, {
      nodeId: source.id,
      title: "Move",
      body: "Body",
    });
    const movers = group(ctx, "Movers");
    grant(ctx, "node.view", movers, source.id);
    grant(ctx, "node.view", movers, destination.id);
    grant(ctx, "forum.move", movers, destination.id);
    const mover = userActor(insertUser(ctx, { groupId: movers }));
    const target = { type: "thread" as const, id: created.thread.id };
    expect(() => bulkModerate(ctx, mover, [target], "move", "", destination.id)).toThrow(
      NotFoundError,
    );
    grant(ctx, "forum.move", movers, source.id);
    expect(bulkModerate(ctx, mover, [target], "move", "", destination.id).changed).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ node_id: number }, [number]>("SELECT node_id FROM threads WHERE id = ?1")
        .get(target.id)!.node_id,
    ).toBe(destination.id);
  });

  test("forum.viewHistory grants revision reads without editAny", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const post = (
      await execute(ctx, threadsCreateOp, author, {
        nodeId: node.id,
        title: "History",
        body: "Before",
      })
    ).post;
    recordPostRevision(ctx, author, post.id);
    const historians = group(ctx, "Historians");
    grant(ctx, "node.view", historians, node.id);
    grant(ctx, "forum.viewHistory", historians, node.id);
    const historian = userActor(insertUser(ctx, { groupId: historians }));
    const ordinary = userActor(insertUser(ctx));
    expect(listPostRevisions(ctx, historian, post.id).items).toHaveLength(1);
    expect(() => listPostRevisions(ctx, ordinary, post.id)).toThrow(NotFoundError);
    expect(() => recordPostRevision(ctx, historian, post.id)).toThrow(NotFoundError);
  });

  test("report.create controls reporting independently of node visibility", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const post = (
      await execute(ctx, threadsCreateOp, author, {
        nodeId: node.id,
        title: "Report",
        body: "Body",
      })
    ).post;
    const viewers = group(ctx, "Viewers");
    grant(ctx, "node.view", viewers, node.id);
    const viewer = userActor(insertUser(ctx, { groupId: viewers }));
    expect(() => createReport(ctx, viewer, { type: "post", id: post.id }, "Reason")).toThrow(
      ForbiddenError,
    );
    expect(createReport(ctx, author, { type: "post", id: post.id }, "Reason").id).toBeGreaterThan(
      0,
    );
  });

  test("conversation.moderate grants message moderation and queue visibility", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const recipient = userActor(insertUser(ctx));
    const ordinary = userActor(insertUser(ctx));
    const conversation = await execute(ctx, conversationsCreateOp, author, {
      title: "Conversation",
      recipientIds: [actorUserId(recipient)!],
      body: "Body",
    });
    const target = { type: "conversation_message" as const, id: conversation.message.id };
    const groupId = group(ctx, "Message moderators");
    grant(ctx, "conversation.moderate", groupId);
    const moderator = userActor(insertUser(ctx, { groupId }));
    expect(() => moderateContent(ctx, ordinary, target, "moderated")).toThrow(ForbiddenError);
    expect(moderateContent(ctx, moderator, target, "moderated").changed).toBe(true);
    expect(listApprovals(ctx, ordinary).items).toEqual([]);
    expect(
      listApprovals(ctx, moderator).items.some(
        (item) => item.type === target.type && item.id === target.id,
      ),
    ).toBe(true);
    expect(moderateContent(ctx, moderator, target, "deleted").changed).toBe(true);
  });

  test("moderators can warn members but not equal or higher ranked members", () => {
    const ctx = createTestContext();
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const member = insertUser(ctx);
    const peer = insertUser(ctx, { groupId: 3 });
    const admin = insertUser(ctx, { groupId: 4 });
    expect(addWarning(ctx, moderator, member.id, 1, "Rule").id).toBeGreaterThan(0);
    expect(() => addWarning(ctx, moderator, peer.id, 1, "Rule")).toThrow(ForbiddenError);
    expect(() => addWarning(ctx, moderator, admin.id, 1, "Rule")).toThrow(ForbiddenError);
  });

  test("warning.view grants reading another member's warnings while self access remains", () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const target = userActor(insertUser(ctx));
    const ordinary = userActor(insertUser(ctx));
    const viewers = group(ctx, "Warning readers");
    grant(ctx, "warning.view", viewers);
    const viewer = userActor(insertUser(ctx, { groupId: viewers }));
    addWarning(ctx, admin, actorUserId(target)!, 1, "Rule");
    expect(listWarnings(ctx, target, actorUserId(target)!).items).toHaveLength(1);
    expect(listWarnings(ctx, viewer, actorUserId(target)!).items).toHaveLength(1);
    expect(() => listWarnings(ctx, ordinary, actorUserId(target)!)).toThrow(ForbiddenError);
  });

  test("equal-ranked admins cannot ban, lift bans on, or spam-clean one another", async () => {
    const ctx = createTestContext();
    const actor = userActor(insertUser(ctx, { groupId: 4 }));
    const target = insertUser(ctx, { groupId: 4 });
    expect(() => banUser(ctx, actor, target.id, "Rule", null)).toThrow(ForbiddenError);
    const banId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at) VALUES (?1, ?2, 'Earlier', ?3, NULL)",
        )
        .run(target.id, actorUserId(actor)!, ctx.now()).lastInsertRowid,
    );
    expect(() => liftBan(ctx, actor, banId, "Appeal")).toThrow(ForbiddenError);
    expect(() => cleanupSpam(ctx, actor, target.id, ctx.now())).toThrow(ForbiddenError);
    await expect(
      execute(ctx, getOperation("spamCleanup.start"), actor, { userId: target.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("member permission denial precedes invalid warning, ban, and cleanup input", () => {
    const ctx = createTestContext();
    const ordinary = userActor(insertUser(ctx));
    const target = insertUser(ctx);
    expect(() => addWarning(ctx, ordinary, target.id, 0, "")).toThrow(ForbiddenError);
    expect(() => banUser(ctx, ordinary, target.id, "", null)).toThrow(ForbiddenError);
    expect(() => cleanupSpam(ctx, ordinary, target.id, ctx.now(), 0)).toThrow(ForbiddenError);
  });

  test("warning immunity prevents the automatic threshold ban", () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Immune', 15) RETURNING id",
      )
      .get()!.id;
    grant(ctx, "member.immuneToAutoBan", groupId);
    const target = insertUser(ctx, { groupId });
    updateSiteSettings(ctx, admin, { warningBanThreshold: 2, warningBanDays: 2 });
    expect(addWarning(ctx, admin, target.id, 2, "Rule").activePoints).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ banned_until: number | null }, [number]>(
          "SELECT banned_until FROM users WHERE id = ?1",
        )
        .get(target.id)!.banned_until,
    ).toBeNull();
    const ordinary = insertUser(ctx);
    expect(addWarning(ctx, admin, ordinary.id, 2, "Rule").activePoints).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ banned_until: number | null }, [number]>(
          "SELECT banned_until FROM users WHERE id = ?1",
        )
        .get(ordinary.id)!.banned_until,
    ).toBeGreaterThan(ctx.now());
  });

  test("a custom spam cleanup grant survives queued actor reconstruction", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const spammer = userActor(insertUser(ctx));
    const created = await execute(ctx, threadsCreateOp, spammer, {
      nodeId: node.id,
      title: "Spam",
      body: "Body",
    });
    const cleaners = group(ctx, "Spam cleaners", 50);
    grant(ctx, "member.spamCleanup", cleaners);
    const cleaner = userActor(insertUser(ctx, { groupId: cleaners }));
    const queued = await execute(ctx, getOperation("spamCleanup.start"), cleaner, {
      userId: actorUserId(spammer)!,
    });
    const payload = JSON.parse(
      ctx.sqlite
        .prepare<{ payload: string }, [number]>("SELECT payload FROM jobs WHERE id = ?1")
        .get(queued.jobId)!.payload,
    ) as Record<string, unknown>;
    expect(payload.actorGroupId).toBeUndefined();
    expect(payload.actorId).toBe(actorUserId(cleaner));
    registerModerationJobs(ctx);
    expect(await runDueJobs(ctx)).toBeGreaterThan(0);
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(created.thread.id)!.state,
    ).toBe("deleted");
  });

  test("moderatorLog.view grants log access without other moderation permissions", () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const target = insertUser(ctx);
    addWarning(ctx, admin, target.id, 1, "Rule");
    const readers = group(ctx, "Log readers");
    grant(ctx, "moderatorLog.view", readers);
    const reader = userActor(insertUser(ctx, { groupId: readers }));
    const ordinary = userActor(insertUser(ctx));
    expect(listModeratorLog(ctx, reader).items).toHaveLength(1);
    expect(() => listModeratorLog(ctx, ordinary)).toThrow(ForbiddenError);
  });

  test("word filter viewing does not grant changes", () => {
    const ctx = createTestContext();
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Filter readers', 20) RETURNING id",
      )
      .get()!.id;
    grant(ctx, "wordFilter.view", groupId);
    const reader = userActor(insertUser(ctx, { groupId }));
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    upsertWordFilter(ctx, admin, { term: "blocked", action: "moderate" });
    expect(listWordFilters(ctx, reader).items).toHaveLength(1);
    expect(() => upsertWordFilter(ctx, reader, { term: "new", action: "moderate" })).toThrow(
      ForbiddenError,
    );
  });
});
