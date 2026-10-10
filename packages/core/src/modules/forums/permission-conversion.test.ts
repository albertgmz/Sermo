import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import {
  nodesCreateOp,
  nodesGetOp,
  nodesUpdateOp,
  postsCreateOp,
  postsDeleteOp,
  postsGetOp,
  postsListOp,
  postsRestoreOp,
  postsUpdateOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsGetOp,
  threadsListOp,
  threadsMoveOp,
  threadsRestoreOp,
  threadsSetLockedOp,
  threadsSetStickyOp,
  threadsUpdateOp,
} from "./index";

function setEntry(
  ctx: ReturnType<typeof createTestContext>,
  groupId: number,
  key: string,
  value: number,
  nodeId: number,
) {
  ctx.sqlite
    .prepare(
      "DELETE FROM permission_entries WHERE permission_id = (SELECT id FROM permission_definitions WHERE key = ?1) AND node_id = ?2 AND group_id = ?3 AND user_id = 0",
    )
    .run(key, nodeId, groupId);
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = ?1), ?2, ?3, 0, ?4)",
    )
    .run(key, nodeId, groupId, value);
  invalidate(ctx, "permissions");
}

function customMember(ctx: ReturnType<typeof createTestContext>) {
  const user = insertUser(ctx);
  const groupId = ctx.sqlite
    .prepare<{ id: number }, [string]>(
      "INSERT INTO groups (title, rank) VALUES (?1, 10) RETURNING id",
    )
    .get(crypto.randomUUID())!.id;
  ctx.sqlite
    .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
    .run(user.id, groupId);
  return { actor: userActor(user), user, groupId };
}

function file(ctx: ReturnType<typeof createTestContext>, uploaderId: number) {
  return Number(
    ctx.sqlite
      .prepare(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('fake', ?1, 4, 'text/plain', 'hash', ?2, 'attachment', 'unattached', ?3)",
      )
      .run(crypto.randomUUID(), uploaderId, ctx.now()).lastInsertRowid,
  );
}

test("a custom group can edit other members' posts only in its granted node", async () => {
  const ctx = createTestContext();
  const allowed = insertNode(ctx, {});
  const denied = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const editorUser = insertUser(ctx);
  const groupId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Editors', 10) RETURNING id",
    )
    .get()!.id;
  ctx.sqlite
    .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
    .run(editorUser.id, groupId);
  setEntry(ctx, groupId, "forum.editAny", 1, allowed.id);
  const editor = userActor(editorUser);
  const first = await execute(ctx, threadsCreateOp, author, {
    nodeId: allowed.id,
    title: "A",
    body: "Body",
  });
  const second = await execute(ctx, threadsCreateOp, author, {
    nodeId: denied.id,
    title: "B",
    body: "Body",
  });
  const allowedPost = await execute(ctx, postsCreateOp, author, {
    threadId: first.thread.id,
    body: "Reply",
  });
  const deniedPost = await execute(ctx, postsCreateOp, author, {
    threadId: second.thread.id,
    body: "Reply",
  });
  expect(
    (await execute(ctx, postsUpdateOp, editor, { postId: allowedPost.id, body: "Edited" }))
      .bodySource,
  ).toBe("Edited");
  await expect(
    execute(ctx, postsUpdateOp, editor, { postId: deniedPost.id, body: "No" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("viewDeleted without viewModerated separates hidden post states", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const viewer = userActor(insertUser(ctx));
  setEntry(ctx, 2, "forum.viewDeleted", 1, node.id);
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "T",
    body: "Body",
  });
  const deleted = await execute(ctx, postsCreateOp, author, {
    threadId: thread.thread.id,
    body: "Deleted",
  });
  const moderated = await execute(ctx, postsCreateOp, author, {
    threadId: thread.thread.id,
    body: "Moderated",
  });
  await execute(ctx, postsDeleteOp, author, { postId: deleted.id });
  ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(moderated.id);
  expect(
    (await execute(ctx, postsListOp, viewer, { threadId: thread.thread.id })).items.map(
      (p) => p.id,
    ),
  ).toEqual([thread.post.id, deleted.id]);
  expect((await execute(ctx, postsGetOp, viewer, { postId: deleted.id })).id).toBe(deleted.id);
  await expect(execute(ctx, postsGetOp, viewer, { postId: moderated.id })).rejects.toBeInstanceOf(
    NotFoundError,
  );
  const hiddenThread = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Hidden",
    body: "Body",
  });
  ctx.sqlite
    .prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1")
    .run(hiddenThread.thread.id);
  const waitingThread = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Waiting",
    body: "Body",
  });
  ctx.sqlite
    .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
    .run(waitingThread.thread.id);
  const listed = await execute(ctx, threadsListOp, viewer, { nodeId: node.id });
  expect(listed.items.map((item) => item.id)).toContain(hiddenThread.thread.id);
  expect(listed.items.map((item) => item.id)).not.toContain(waitingThread.thread.id);
});

test("editOwnTimeLimit stops editing a post after ten minutes", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  setEntry(ctx, 2, "forum.editOwnTimeLimit", 10, node.id);
  const author = userActor(insertUser(ctx));
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "T",
    body: "Body",
  });
  ctx.clock.advance(5 * 60_000);
  const post = await execute(ctx, postsCreateOp, author, {
    threadId: thread.thread.id,
    body: "Reply",
  });
  await execute(ctx, postsUpdateOp, author, { postId: post.id, body: "Soon" });
  ctx.clock.advance(5 * 60_000 + 1);
  expect((await execute(ctx, postsGetOp, author, { postId: post.id })).canEdit).toBe(true);
  ctx.clock.advance(5 * 60_000);
  expect((await execute(ctx, postsGetOp, author, { postId: post.id })).canEdit).toBe(false);
  await expect(
    execute(ctx, postsUpdateOp, author, { postId: post.id, body: "Late" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("an active thread ban denies replies and clears after expiry", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const authorUser = insertUser(ctx);
  const memberUser = insertUser(ctx);
  const author = userActor(authorUser);
  const member = userActor(memberUser);
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "T",
    body: "Body",
  });
  ctx.sqlite
    .prepare(
      "INSERT INTO thread_bans (thread_id, user_id, moderator_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .run(thread.thread.id, memberUser.id, authorUser.id, ctx.now(), ctx.now() + 60_000);
  expect(
    (await execute(ctx, threadsGetOp, member, { threadId: thread.thread.id })).permissions.canReply,
  ).toBe(false);
  await expect(
    execute(ctx, postsCreateOp, member, { threadId: thread.thread.id, body: "Denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  ctx.clock.advance(60_001);
  expect(
    (await execute(ctx, threadsGetOp, member, { threadId: thread.thread.id })).permissions.canReply,
  ).toBe(true);
  expect(
    (await execute(ctx, postsCreateOp, member, { threadId: thread.thread.id, body: "Allowed" }))
      .bodySource,
  ).toBe("Allowed");
  ctx.sqlite
    .prepare("UPDATE thread_bans SET expires_at = NULL WHERE thread_id = ?1 AND user_id = ?2")
    .run(thread.thread.id, memberUser.id);
  expect(
    (await execute(ctx, threadsGetOp, member, { threadId: thread.thread.id })).permissions.canReply,
  ).toBe(false);
  await expect(
    execute(ctx, postsCreateOp, member, { threadId: thread.thread.id, body: "Still denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("custom attachment grants distinguish new files, retained files, and viewing", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const owner = customMember(ctx);
  const viewer = customMember(ctx);
  const thread = await execute(ctx, threadsCreateOp, owner.actor, {
    nodeId: node.id,
    title: "T",
    body: "Body",
  });
  const existing = file(ctx, owner.user.id);
  const extra = file(ctx, owner.user.id);
  const post = await execute(ctx, postsCreateOp, owner.actor, {
    threadId: thread.thread.id,
    body: "Attached",
    attachmentIds: [existing],
  });
  setEntry(ctx, owner.groupId, "forum.uploadAttachments", -1, node.id);
  expect(
    (
      await execute(ctx, postsUpdateOp, owner.actor, {
        postId: post.id,
        body: "Retained",
        attachmentIds: [existing],
      })
    ).attachmentCount,
  ).toBe(1);
  await expect(
    execute(ctx, postsUpdateOp, owner.actor, {
      postId: post.id,
      body: "Denied",
      attachmentIds: [existing, extra],
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    execute(ctx, postsCreateOp, owner.actor, {
      threadId: thread.thread.id,
      body: "Denied",
      attachmentIds: [extra],
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, owner.groupId, "forum.uploadAttachments", 1, node.id);
  expect(
    (
      await execute(ctx, postsUpdateOp, owner.actor, {
        postId: post.id,
        body: "Added",
        attachmentIds: [existing, extra],
      })
    ).attachmentCount,
  ).toBe(2);
  setEntry(ctx, viewer.groupId, "forum.viewAttachments", -1, node.id);
  expect((await execute(ctx, postsGetOp, viewer.actor, { postId: post.id })).attachments).toEqual(
    [],
  );
  setEntry(ctx, viewer.groupId, "forum.viewAttachments", 1, node.id);
  expect(
    (await execute(ctx, postsGetOp, viewer.actor, { postId: post.id })).attachments.map(
      (a) => a.fileId,
    ),
  ).toEqual([existing, extra]);
});

test("custom approve and undelete grants apply to their states and visible no-ops", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const approver = customMember(ctx);
  const undelete = customMember(ctx);
  for (const member of [approver, undelete]) {
    setEntry(ctx, member.groupId, "forum.viewModerated", 1, node.id);
    setEntry(ctx, member.groupId, "forum.viewDeleted", 1, node.id);
  }
  expect(
    (await execute(ctx, nodesGetOp, approver.actor, { nodeId: node.id })).node.permissions
      .canModerate,
  ).toBe(false);
  setEntry(ctx, approver.groupId, "forum.approve", 1, node.id);
  setEntry(ctx, undelete.groupId, "forum.undelete", 1, node.id);
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "T",
    body: "Body",
  });
  const post = await execute(ctx, postsCreateOp, author, {
    threadId: thread.thread.id,
    body: "Reply",
  });
  expect(
    (await execute(ctx, nodesGetOp, approver.actor, { nodeId: node.id })).node.permissions
      .canModerate,
  ).toBe(true);
  expect(
    (await execute(ctx, threadsGetOp, approver.actor, { threadId: thread.thread.id })).permissions
      .canModerate,
  ).toBe(true);
  await execute(ctx, postsRestoreOp, approver.actor, { postId: post.id });
  await execute(ctx, threadsRestoreOp, undelete.actor, { threadId: thread.thread.id });
  ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(post.id);
  await expect(
    execute(ctx, postsRestoreOp, undelete.actor, { postId: post.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await execute(ctx, postsRestoreOp, approver.actor, { postId: post.id });
  ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(thread.thread.id);
  await expect(
    execute(ctx, threadsRestoreOp, undelete.actor, { threadId: thread.thread.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await execute(ctx, threadsRestoreOp, approver.actor, { threadId: thread.thread.id });
  ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(post.id);
  await expect(
    execute(ctx, postsRestoreOp, approver.actor, { postId: post.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await execute(ctx, postsRestoreOp, undelete.actor, { postId: post.id });
  ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(thread.thread.id);
  await expect(
    execute(ctx, threadsRestoreOp, approver.actor, { threadId: thread.thread.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await execute(ctx, threadsRestoreOp, undelete.actor, { threadId: thread.thread.id });
});

test("custom grants separately control stick, lock, move, and locked replies", async () => {
  const ctx = createTestContext();
  const source = insertNode(ctx, {});
  const target = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const operator = customMember(ctx);
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: source.id,
    title: "T",
    body: "Body",
  });
  await expect(
    execute(ctx, threadsSetStickyOp, operator.actor, {
      threadId: thread.thread.id,
      isSticky: true,
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, operator.groupId, "forum.stick", 1, source.id);
  expect(
    (
      await execute(ctx, threadsSetStickyOp, operator.actor, {
        threadId: thread.thread.id,
        isSticky: true,
      })
    ).isSticky,
  ).toBe(true);
  await expect(
    execute(ctx, threadsSetLockedOp, operator.actor, {
      threadId: thread.thread.id,
      isLocked: true,
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, operator.groupId, "forum.lock", 1, source.id);
  await execute(ctx, threadsSetLockedOp, operator.actor, {
    threadId: thread.thread.id,
    isLocked: true,
  });
  await expect(
    execute(ctx, postsCreateOp, operator.actor, { threadId: thread.thread.id, body: "Denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, operator.groupId, "forum.replyLocked", 1, source.id);
  expect(
    (await execute(ctx, threadsGetOp, operator.actor, { threadId: thread.thread.id })).permissions
      .canReply,
  ).toBe(true);
  await execute(ctx, postsCreateOp, operator.actor, {
    threadId: thread.thread.id,
    body: "Allowed",
  });
  await expect(
    execute(ctx, threadsMoveOp, operator.actor, { threadId: thread.thread.id, nodeId: target.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, operator.groupId, "forum.move", 1, source.id);
  await expect(
    execute(ctx, threadsMoveOp, operator.actor, { threadId: thread.thread.id, nodeId: target.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, operator.groupId, "forum.move", 1, target.id);
  expect(
    (
      await execute(ctx, threadsMoveOp, operator.actor, {
        threadId: thread.thread.id,
        nodeId: target.id,
      })
    ).nodeId,
  ).toBe(target.id);
});

test("custom createThread, editOwnThreadTitle, deleteOwn, and deleteAny grants are distinct", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const member = customMember(ctx);
  const other = userActor(insertUser(ctx));
  setEntry(ctx, member.groupId, "forum.createThread", -1, node.id);
  await expect(
    execute(ctx, threadsCreateOp, member.actor, { nodeId: node.id, title: "Denied", body: "Body" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, member.groupId, "forum.createThread", 1, node.id);
  const own = await execute(ctx, threadsCreateOp, member.actor, {
    nodeId: node.id,
    title: "Own",
    body: "Body",
  });
  const foreign = await execute(ctx, threadsCreateOp, other, {
    nodeId: node.id,
    title: "Other",
    body: "Body",
  });
  setEntry(ctx, member.groupId, "forum.editOwnThreadTitle", -1, node.id);
  await expect(
    execute(ctx, threadsUpdateOp, member.actor, { threadId: own.thread.id, title: "Denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, member.groupId, "forum.editOwnThreadTitle", 1, node.id);
  expect(
    (
      await execute(ctx, threadsUpdateOp, member.actor, {
        threadId: own.thread.id,
        title: "Allowed",
      })
    ).title,
  ).toBe("Allowed");
  await expect(
    execute(ctx, threadsUpdateOp, member.actor, { threadId: foreign.thread.id, title: "Denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  const ownPost = await execute(ctx, postsCreateOp, member.actor, {
    threadId: own.thread.id,
    body: "Own reply",
  });
  const foreignPost = await execute(ctx, postsCreateOp, other, {
    threadId: own.thread.id,
    body: "Other reply",
  });
  setEntry(ctx, member.groupId, "forum.deleteOwn", -1, node.id);
  await expect(
    execute(ctx, postsDeleteOp, member.actor, { postId: ownPost.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, member.groupId, "forum.deleteOwn", 1, node.id);
  await execute(ctx, postsDeleteOp, member.actor, { postId: ownPost.id });
  await expect(
    execute(ctx, postsDeleteOp, member.actor, { postId: foreignPost.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    execute(ctx, threadsDeleteOp, member.actor, { threadId: foreign.thread.id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, member.groupId, "forum.deleteAny", 1, node.id);
  expect(
    (await execute(ctx, nodesGetOp, member.actor, { nodeId: node.id })).node.permissions
      .canModerate,
  ).toBe(true);
  await execute(ctx, postsDeleteOp, member.actor, { postId: foreignPost.id });
  await execute(ctx, threadsDeleteOp, member.actor, { threadId: foreign.thread.id });
});

test("a custom global admin.nodes grant enables node creation and updates", async () => {
  const ctx = createTestContext();
  const member = customMember(ctx);
  await expect(
    execute(ctx, nodesCreateOp, member.actor, { parentId: null, type: "forum", title: "Denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  setEntry(ctx, member.groupId, "admin.nodes", 1, 0);
  const node = await execute(ctx, nodesCreateOp, member.actor, {
    parentId: null,
    type: "forum",
    title: "Allowed",
  });
  expect(
    (await execute(ctx, nodesUpdateOp, member.actor, { nodeId: node.id, title: "Updated" })).title,
  ).toBe("Updated");
  setEntry(ctx, member.groupId, "admin.nodes", -1, 0);
  await expect(
    execute(ctx, nodesUpdateOp, member.actor, { nodeId: node.id, title: "Denied" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});
