import * as z from "zod";
import { actorUserId, requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import {
  profileCommentsCreate,
  profileCommentsDelete,
  profileCommentsGet,
  profileCommentsList,
  profileCommentsRestore,
  profileCommentsUpdate,
} from "../../contracts/profiles";
import { writeTx } from "../../db/tx";
import { ForbiddenError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { renderMarkdown } from "../../render";
import { loadUserSummaries } from "../../shared/users";
import { getGlobalPermissions } from "../permissions";
import {
  COMMENTS_SQL,
  type CommentRow,
  changeCommentCount,
  commentValue,
  commentValues,
  requireComment,
  requirePost,
} from "./shared";

export const profileCommentsListOp = implement(profileCommentsList, (ctx, actor, input) => {
  const post = requirePost(ctx, actor, input.profilePostId);
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const flags = getGlobalPermissions(ctx, actor);
  const rows = prepared(ctx, "profiles.commentList", () =>
    ctx.sqlite.prepare<CommentRow, [number, number, number, number, number]>(COMMENTS_SQL),
  ).all(post.id, cursor, Number(flags.isModerator), actorUserId(actor) ?? 0, input.limit + 1);
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
export const profileCommentsCreateOp = implement(profileCommentsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const post = requirePost(ctx, actor, input.profilePostId);
  if (!getGlobalPermissions(ctx, actor).canPostProfile || post.state !== "visible")
    throw new ForbiddenError();
  const html = renderMarkdown(input.body);
  const comment = writeTx(ctx, () => {
    if (requirePost(ctx, actor, post.id).state !== "visible") throw new ForbiddenError();
    const row = prepared(ctx, "profiles.insertComment", () =>
      ctx.sqlite.prepare<CommentRow, [number, number, number, string, string]>(
        "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *",
      ),
    ).get(post.id, user.userId, ctx.now(), input.body, html)!;
    prepared(ctx, "profiles.incrementCommentCount", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(
        "UPDATE profile_posts SET comment_count = comment_count + 1, last_comment_at = ?1 WHERE id = ?2",
      ),
    ).run(row.created_at, post.id);
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
export const profileCommentsUpdateOp = implement(profileCommentsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { comment } = requireComment(ctx, actor, input.commentId);
  if (comment.user_id !== actorUserId(actor) && !getGlobalPermissions(ctx, actor).isModerator)
    throw new ForbiddenError();
  const html = renderMarkdown(input.body);
  writeTx(ctx, () => {
    prepared(ctx, "profiles.updateComment", () =>
      ctx.sqlite.prepare<unknown, [string, string, number, number]>(
        "UPDATE profile_post_comments SET body_source = ?1, body_html = ?2, edited_at = ?3 WHERE id = ?4",
      ),
    ).run(input.body, html, ctx.now(), comment.id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "profile_post_comment",
      targetId: comment.id,
    });
  });
  return profileCommentsGetOp.run(ctx, actor, input);
});
export const profileCommentsDeleteOp = implement(profileCommentsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  if (
    comment.user_id !== actorUserId(actor) &&
    post.profile_user_id !== actorUserId(actor) &&
    !getGlobalPermissions(ctx, actor).isModerator
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
    if (result.changes)
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "profile_post_comment",
        targetId: comment.id,
      });
  });
  return commentValue(ctx, actor, { ...comment, state: "deleted" }, post.profile_user_id);
});
export const profileCommentsRestoreOp = implement(profileCommentsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  if (!getGlobalPermissions(ctx, actor).isModerator) throw new ForbiddenError();
  writeTx(ctx, () => {
    const current = prepared(ctx, "profiles.commentState", () =>
      ctx.sqlite.prepare<{ state: CommentRow["state"] }, [number]>(
        "SELECT state FROM profile_post_comments WHERE id = ?1",
      ),
    ).get(comment.id)!;
    const result = prepared(ctx, "profiles.restoreComment", () =>
      ctx.sqlite.prepare<unknown, [number, string]>(
        "UPDATE profile_post_comments SET state = 'visible' WHERE id = ?1 AND state = ?2",
      ),
    ).run(comment.id, current.state);
    if (result.changes === 1 && current.state !== "visible") changeCommentCount(ctx, post.id, 1);
    if (result.changes)
      publishEvent(ctx, {
        type: "content.state_changed",
        targetType: "profile_post_comment",
        targetId: comment.id,
      });
  });
  return commentValue(ctx, actor, { ...comment, state: "visible" }, post.profile_user_id);
});
