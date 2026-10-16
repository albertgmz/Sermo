import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getFileRecord } from "../storage";
import {
  profileCommentsCreateOp,
  profileCommentsDeleteOp,
  profileCommentsGetOp,
  profileCommentsListOp,
  profileCommentsRestoreOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsDeleteOp,
  profilePostsHardDeleteOp,
  profilePostsListOp,
} from "./index";

function setup() {
  const ctx = createTestContext();
  const owner = userActor(insertUser(ctx));
  const commenter = userActor(insertUser(ctx));
  const other = userActor(insertUser(ctx));
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  if (
    owner.kind === "guest" ||
    commenter.kind === "guest" ||
    other.kind === "guest" ||
    admin.kind === "guest"
  )
    throw new Error("fixture");
  const file = (uploaderId: number, mime = "text/plain", filename: string | null = null) =>
    Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, filename) VALUES ('fake', ?1, 4, ?2, 'hash', ?3, 'attachment', 'unattached', ?4, ?5)",
        )
        .run(crypto.randomUUID(), mime, uploaderId, ctx.now(), filename).lastInsertRowid,
    );
  const wallPost = () =>
    execute(ctx, profilePostsCreateOp, owner, { userId: owner.userId, body: "wall" });
  const links = (commentId: number) =>
    ctx.sqlite
      .prepare<{ file_id: number; position: number }, [number]>(
        "SELECT file_id, position FROM attachments WHERE content_type = 'profile_post_comment' AND content_id = ?1 ORDER BY position",
      )
      .all(commentId);
  const queued = (fileId: number) =>
    ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM jobs WHERE type = 'storage.deletePermanent' AND json_extract(payload, '$.id') = ?1",
      )
      .get(fileId)!.n;
  return { ctx, owner, commenter, other, admin, file, wallPost, links, queued };
}

describe("profile comment attachments", () => {
  test("a comment is created with files, which come back with their names in every listing", async () => {
    const s = setup();
    const post = await s.wallPost();
    const picture = s.file(s.commenter.userId, "image/png", "holiday photo.png");
    const note = s.file(s.commenter.userId, "text/plain", "notes.txt");
    const comment = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: `look [ATTACH]${picture}[/ATTACH]`,
      attachmentIds: [picture, note],
    });
    expect(comment.attachmentCount).toBe(2);
    expect(comment.attachments.map((file) => [file.fileId, file.filename])).toEqual([
      [picture, "holiday photo.png"],
      [note, "notes.txt"],
    ]);
    expect(comment.bodyHtml).toContain(`data-attach-id="${picture}"`);
    expect(s.links(comment.id)).toEqual([
      { file_id: picture, position: 0 },
      { file_id: note, position: 1 },
    ]);
    const listed = await execute(s.ctx, profileCommentsListOp, GUEST, {
      profilePostId: post.id,
      limit: 20,
    });
    expect(listed.items[0]?.attachments.map((file) => file.fileId)).toEqual([picture, note]);
    const wall = await execute(s.ctx, profilePostsListOp, GUEST, {
      userId: s.owner.userId,
      limit: 20,
    });
    expect(wall.items[0]?.latestComments[0]?.attachments.map((file) => file.fileId)).toEqual([
      picture,
      note,
    ]);
    const fetched = await execute(s.ctx, profileCommentsGetOp, GUEST, { commentId: comment.id });
    expect(fetched.attachmentCount).toBe(2);
    expect(getFileRecord(s.ctx, GUEST, picture).filename).toBe("holiday photo.png");
  });

  test("a comment without files has none, and files must be the commenter's own and unused", async () => {
    const s = setup();
    const post = await s.wallPost();
    const plain = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "plain",
    });
    expect(plain.attachmentCount).toBe(0);
    expect(plain.attachments).toEqual([]);
    const foreign = s.file(s.other.userId);
    await expect(
      execute(s.ctx, profileCommentsCreateOp, s.commenter, {
        profilePostId: post.id,
        body: "bad",
        attachmentIds: [foreign],
      }),
    ).rejects.toThrow(NotFoundError);
    const mine = s.file(s.commenter.userId);
    await expect(
      execute(s.ctx, profileCommentsCreateOp, s.commenter, {
        profilePostId: post.id,
        body: "bad",
        attachmentIds: [mine, mine],
      }),
    ).rejects.toThrow(ValidationError);
    await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "first",
      attachmentIds: [mine],
    });
    await expect(
      execute(s.ctx, profileCommentsCreateOp, s.other, {
        profilePostId: post.id,
        body: "reuse",
        attachmentIds: [mine],
      }),
    ).rejects.toThrow(NotFoundError);
    // A refused comment leaves nothing behind.
    expect(
      s.ctx.sqlite
        .prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM profile_post_comments")
        .get()!.n,
    ).toBe(2);
  });

  test("an edit adds and removes files; leaving the list out keeps them", async () => {
    const s = setup();
    const post = await s.wallPost();
    const first = s.file(s.commenter.userId);
    const second = s.file(s.commenter.userId);
    const comment = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "one",
      attachmentIds: [first],
    });
    const kept = await execute(s.ctx, profileCommentsUpdateOp, s.commenter, {
      commentId: comment.id,
      body: "one edited",
    });
    expect(kept.attachments.map((file) => file.fileId)).toEqual([first]);
    const swapped = await execute(s.ctx, profileCommentsUpdateOp, s.commenter, {
      commentId: comment.id,
      body: "two",
      attachmentIds: [second],
    });
    expect(swapped.attachmentCount).toBe(1);
    expect(swapped.attachments.map((file) => file.fileId)).toEqual([second]);
    expect(s.links(comment.id).map((link) => link.file_id)).toEqual([second]);
    expect(s.queued(first)).toBe(1);
    expect(s.queued(second)).toBe(0);
    expect(() => getFileRecord(s.ctx, GUEST, first)).toThrow(NotFoundError);
    const cleared = await execute(s.ctx, profileCommentsUpdateOp, s.commenter, {
      commentId: comment.id,
      body: "none",
      attachmentIds: [],
    });
    expect(cleared.attachmentCount).toBe(0);
    expect(cleared.attachments).toEqual([]);
    expect(s.queued(second)).toBe(1);
    expect(
      s.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT attachment_count AS n FROM profile_post_comments WHERE id = ?1",
        )
        .get(comment.id)!.n,
    ).toBe(0);
  });

  test("editing follows the comment's permissions: only the author or a moderator", async () => {
    const s = setup();
    const post = await s.wallPost();
    const mine = s.file(s.commenter.userId);
    const comment = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "one",
      attachmentIds: [mine],
    });
    const intruder = s.file(s.other.userId);
    await expect(
      execute(s.ctx, profileCommentsUpdateOp, s.other, {
        commentId: comment.id,
        body: "hijack",
        attachmentIds: [intruder],
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(s.ctx, profileCommentsUpdateOp, GUEST, {
        commentId: comment.id,
        body: "hijack",
        attachmentIds: [],
      }),
    ).rejects.toThrow();
    // A moderator may edit the comment; the files they add are their own, never another member's.
    const edited = await execute(s.ctx, profileCommentsUpdateOp, s.admin, {
      commentId: comment.id,
      body: "moderated",
      attachmentIds: [mine],
    });
    expect(edited.attachments.map((file) => file.fileId)).toEqual([mine]);
    await expect(
      execute(s.ctx, profileCommentsUpdateOp, s.admin, {
        commentId: comment.id,
        body: "moderated",
        attachmentIds: [mine, intruder],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test("a deleted comment's files are hidden like the comment, and come back on restore", async () => {
    const s = setup();
    const post = await s.wallPost();
    const mine = s.file(s.commenter.userId, "text/plain", "plan.txt");
    const comment = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "files",
      attachmentIds: [mine],
    });
    expect(getFileRecord(s.ctx, GUEST, mine).id).toBe(mine);
    expect(getFileRecord(s.ctx, s.other, mine).id).toBe(mine);
    await execute(s.ctx, profileCommentsDeleteOp, s.commenter, { commentId: comment.id });
    // A soft delete keeps the files, as it does for a profile post.
    expect(s.links(comment.id)).toHaveLength(1);
    expect(s.queued(mine)).toBe(0);
    expect(() => getFileRecord(s.ctx, GUEST, mine)).toThrow(NotFoundError);
    expect(() => getFileRecord(s.ctx, s.other, mine)).toThrow(NotFoundError);
    expect(getFileRecord(s.ctx, s.admin, mine).id).toBe(mine);
    await execute(s.ctx, profileCommentsRestoreOp, s.admin, { commentId: comment.id });
    expect(getFileRecord(s.ctx, GUEST, mine).id).toBe(mine);
  });

  test("a visible comment on a wall post that is deleted or awaiting approval keeps its files from guests and other members", async () => {
    const s = setup();
    for (const state of ["deleted", "moderated"]) {
      const post = await s.wallPost();
      const mine = s.file(s.commenter.userId, "text/plain", "plan.txt");
      await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
        profilePostId: post.id,
        body: "files",
        attachmentIds: [mine],
      });
      expect(getFileRecord(s.ctx, GUEST, mine).id).toBe(mine);
      s.ctx.sqlite.prepare("UPDATE profile_posts SET state = ?1 WHERE id = ?2").run(state, post.id);
      expect(() => getFileRecord(s.ctx, GUEST, mine)).toThrow(NotFoundError);
      expect(() => getFileRecord(s.ctx, s.other, mine)).toThrow(NotFoundError);
      expect(() => getFileRecord(s.ctx, s.commenter, mine)).toThrow(NotFoundError);
      expect(getFileRecord(s.ctx, s.admin, mine).id).toBe(mine);
    }
  });

  test("the file of a comment awaiting approval is limited to its author and moderators", async () => {
    const s = setup();
    const post = await s.wallPost();
    const mine = s.file(s.commenter.userId, "text/plain", "plan.txt");
    const comment = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "files",
      attachmentIds: [mine],
    });
    s.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id = ?1")
      .run(comment.id);
    expect(() => getFileRecord(s.ctx, GUEST, mine)).toThrow(NotFoundError);
    expect(() => getFileRecord(s.ctx, s.other, mine)).toThrow(NotFoundError);
    expect(getFileRecord(s.ctx, s.commenter, mine).id).toBe(mine);
    expect(getFileRecord(s.ctx, s.admin, mine).id).toBe(mine);
  });

  test("deleting the wall post for good removes the comments' files", async () => {
    const s = setup();
    const post = await s.wallPost();
    const mine = s.file(s.commenter.userId);
    const comment = await execute(s.ctx, profileCommentsCreateOp, s.commenter, {
      profilePostId: post.id,
      body: "files",
      attachmentIds: [mine],
    });
    await execute(s.ctx, profilePostsDeleteOp, s.owner, { profilePostId: post.id });
    const result = await execute(s.ctx, profilePostsHardDeleteOp, s.admin, {
      profilePostId: post.id,
    });
    expect(result.completed).toBe(true);
    expect(s.links(comment.id)).toEqual([]);
    expect(s.queued(mine)).toBe(1);
    expect(() => getFileRecord(s.ctx, s.admin, mine)).toThrow(NotFoundError);
  });
});
