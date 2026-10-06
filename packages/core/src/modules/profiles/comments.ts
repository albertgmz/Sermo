import * as z from "zod";
import { type Actor, actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  profileCommentsCreate,
  profileCommentsDelete,
  profileCommentsGet,
  profileCommentsList,
  profileCommentsRestore,
  profileCommentsUpdate,
} from "../../contracts/profiles";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, permissionsOf, requirePermission } from "../../permissions";
import { renderMarkdown } from "../../render";
import { loadUserSummaries } from "../../shared/users";
import {
  appendModeratorLog,
  moderateEditedContent,
  prepareModeratedContent,
  withSpamCheck,
} from "../moderation";
import {
  COMMENTS_SQL,
  type CommentRow,
  changeCommentCount,
  commentValue,
  commentValues,
  requireComment,
  requirePost,
  touchProfile,
} from "./shared";

export const profileCommentsListOp = implement(profileCommentsList, (ctx, actor, input) => {
  const post = requirePost(ctx, actor, input.profilePostId);
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const permissions = permissionsOf(ctx, actor);
  const rows = prepared(ctx, "profiles.commentList", () =>
    ctx.sqlite.prepare<CommentRow, [number, number, number, number, number, number]>(COMMENTS_SQL),
  ).all(
    post.id,
    cursor,
    Number(permissions.can("profilePost.viewModerated")),
    Number(permissions.can("profilePost.viewDeleted")),
    actorUserId(actor) ?? 0,
    input.limit + 1,
  );
  const page = rows.slice(0, input.limit);
  const user = loadUserSummaries(
    ctx,
    page.map((row) => row.user_id),
  );
  return {
    items: commentValues(ctx, actor, page, post.profile_user_id, user),
    nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.id]) : null,
  };
});
export const profileCommentsGetOp = implement(profileCommentsGet, (ctx, actor, input) => {
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  return {
    ...commentValue(ctx, actor, comment, post.profile_user_id),
    bodySource: comment.body_source,
  };
});
function ignoredByCommentWall(ctx: Ctx, actor: Actor, wallId: number, authorId: number): boolean {
  return (
    can(ctx, actor, "member.ignorable") &&
    !!prepared(ctx, "profiles.commentWallIgnored", () =>
      ctx.sqlite.prepare<{ id: number }, [number, number]>(
        "SELECT id FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2",
      ),
    ).get(wallId, authorId)
  );
}
export const profileCommentsCreateOp = implement(profileCommentsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const post = requirePost(ctx, actor, input.profilePostId);
  requirePermission(ctx, actor, "profilePost.comment");
  if (post.state !== "visible") throw new ForbiddenError();
  if (ignoredByCommentWall(ctx, actor, post.profile_user_id, user.userId))
    throw new ForbiddenError();
  return withSpamCheck(ctx, actor, input.body, "reply", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, false);
    const html = renderMarkdown(content.source);
    const comment = writeTx(ctx, () => {
      if (requirePost(ctx, actor, post.id).state !== "visible") throw new ForbiddenError();
      if (ignoredByCommentWall(ctx, actor, post.profile_user_id, user.userId))
        throw new ForbiddenError();
      const decision = prepareModeratedContent(ctx, actor, input.body, false);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      const row = prepared(ctx, "profiles.insertComment", () =>
        ctx.sqlite.prepare<CommentRow, [number, number, string, number, string, string]>(
          "INSERT INTO profile_post_comments (profile_post_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *",
        ),
      ).get(
        post.id,
        user.userId,
        decision.moderated || spam ? "moderated" : "visible",
        ctx.now(),
        content.source,
        html,
      )!;
      if (!decision.moderated && !spam)
        prepared(ctx, "profiles.incrementCommentCount", () =>
          ctx.sqlite.prepare<unknown, [number, number]>(
            "UPDATE profile_posts SET comment_count = comment_count + 1, last_comment_at = ?1 WHERE id = ?2",
          ),
        ).run(row.created_at, post.id);
      if (row.state === "visible") touchProfile(ctx, post.profile_user_id);
      publishEvent(ctx, {
        type: "content.created",
        targetType: "profile_post_comment",
        targetId: row.id,
      });
      return row;
    });
    return {
      ...commentValue(ctx, actor, comment, post.profile_user_id),
      bodySource: comment.body_source,
    };
  });
});
export const profileCommentsUpdateOp = implement(profileCommentsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  if (
    !can(ctx, actor, "profilePost.editAny") &&
    !can(ctx, actor, "profilePost.editOwn", { ownerId: comment.user_id })
  )
    throw new ForbiddenError();
  const content = prepareModeratedContent(ctx, actor, input.body, false);
  const html = renderMarkdown(content.source);
  writeTx(ctx, () => {
    const decision = prepareModeratedContent(ctx, actor, input.body, false);
    if (decision.source !== content.source)
      throw new ConflictError("Moderation rules changed; retry.");
    prepared(ctx, "profiles.updateComment", () =>
      ctx.sqlite.prepare<unknown, [string, string, number, number]>(
        "UPDATE profile_post_comments SET body_source = ?1, body_html = ?2, edited_at = ?3 WHERE id = ?4",
      ),
    ).run(content.source, html, ctx.now(), comment.id);
    if (decision.moderated)
      moderateEditedContent(ctx, actor, { type: "profile_post_comment", id: comment.id });
    if (comment.state === "visible") touchProfile(ctx, post.profile_user_id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "profile_post_comment",
      targetId: comment.id,
    });
    if (can(ctx, actor, "profilePost.editAny"))
      appendModeratorLog(ctx, actor, "profile_comment.edit", "profile_post_comment", comment.id);
  });
  return profileCommentsGetOp.run(ctx, actor, input);
});
export const profileCommentsDeleteOp = implement(profileCommentsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  if (
    !can(ctx, actor, "profilePost.deleteAny") &&
    !can(ctx, actor, "profilePost.deleteOwn", { ownerId: comment.user_id }) &&
    !can(ctx, actor, "profilePost.manageOwnWall", { ownerId: post.profile_user_id })
  )
    throw new ForbiddenError();
  writeTx(ctx, () => {
    const current = prepared(ctx, "profiles.commentState", () =>
      ctx.sqlite.prepare<{ state: CommentRow["state"] }, [number]>(
        "SELECT state FROM profile_post_comments WHERE id = ?1",
      ),
    ).get(comment.id)!;
    const result = prepared(ctx, "profiles.deleteComment", () =>
      ctx.sqlite.prepare<unknown, [number, string]>(
        "UPDATE profile_post_comments SET state = 'deleted' WHERE id = ?1 AND state = ?2",
      ),
    ).run(comment.id, current.state);
    if (result.changes === 1 && current.state === "visible") changeCommentCount(ctx, post.id, -1);
    if (result.changes === 1 && current.state === "visible")
      touchProfile(ctx, post.profile_user_id);
    if (result.changes)
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "profile_post_comment",
        targetId: comment.id,
        payload: { previousState: current.state },
      });
    if (can(ctx, actor, "profilePost.deleteAny"))
      appendModeratorLog(ctx, actor, "profile_comment.delete", "profile_post_comment", comment.id);
  });
  return commentValue(ctx, actor, { ...comment, state: "deleted" }, post.profile_user_id);
});
export const profileCommentsRestoreOp = implement(profileCommentsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  writeTx(ctx, () => {
    const current = prepared(ctx, "profiles.commentState", () =>
      ctx.sqlite.prepare<{ state: CommentRow["state"] }, [number]>(
        "SELECT state FROM profile_post_comments WHERE id = ?1",
      ),
    ).get(comment.id)!;
    if (current.state === "deleted") requirePermission(ctx, actor, "profilePost.undelete");
    else requirePermission(ctx, actor, "profilePost.approve");
    const result = prepared(ctx, "profiles.restoreComment", () =>
      ctx.sqlite.prepare<unknown, [number, string]>(
        "UPDATE profile_post_comments SET state = 'visible' WHERE id = ?1 AND state = ?2",
      ),
    ).run(comment.id, current.state);
    if (result.changes === 1 && current.state !== "visible") changeCommentCount(ctx, post.id, 1);
    if (result.changes === 1) touchProfile(ctx, post.profile_user_id);
    if (result.changes)
      publishEvent(ctx, {
        type: "content.state_changed",
        targetType: "profile_post_comment",
        targetId: comment.id,
      });
    appendModeratorLog(ctx, actor, "profile_comment.restore", "profile_post_comment", comment.id);
  });
  return commentValue(ctx, actor, { ...comment, state: "visible" }, post.profile_user_id);
});
