import type { Actor } from "../../actor";
import { actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { getGlobalPermissions } from "../permissions";

export type State = "visible" | "moderated" | "deleted";
export type PostRow = {
  id: number;
  profile_user_id: number;
  user_id: number;
  state: State;
  created_at: number;
  edited_at: number | null;
  body_source: string;
  body_html: string;
  reaction_counts: string;
  comment_count: number;
  last_comment_at: number | null;
};
export type CommentRow = {
  id: number;
  profile_post_id: number;
  user_id: number;
  state: State;
  created_at: number;
  edited_at: number | null;
  body_source: string;
  body_html: string;
  reaction_counts: string;
};

export function requireView(ctx: Ctx, actor: Actor) {
  const flags = getGlobalPermissions(ctx, actor);
  if (!flags.canViewProfiles) throw new ForbiddenError();
  return flags;
}
export function maySee(state: State, authorId: number, actor: Actor, moderator: boolean) {
  return (
    state === "visible" || moderator || (state === "moderated" && authorId === actorUserId(actor))
  );
}
export function requirePost(ctx: Ctx, actor: Actor, id: number): PostRow {
  const flags = requireView(ctx, actor);
  const row = prepared(ctx, "profiles.post", () =>
    ctx.sqlite.prepare<PostRow, [number]>("SELECT * FROM profile_posts WHERE id = ?1"),
  ).get(id);
  if (!row || !maySee(row.state, row.user_id, actor, flags.isModerator)) throw new NotFoundError();
  return row;
}
export function requireComment(
  ctx: Ctx,
  actor: Actor,
  id: number,
): { comment: CommentRow; post: PostRow } {
  const comment = prepared(ctx, "profiles.comment", () =>
    ctx.sqlite.prepare<CommentRow, [number]>("SELECT * FROM profile_post_comments WHERE id = ?1"),
  ).get(id);
  if (!comment) {
    requireView(ctx, actor);
    throw new NotFoundError();
  }
  const post = requirePost(ctx, actor, comment.profile_post_id);
  if (!maySee(comment.state, comment.user_id, actor, getGlobalPermissions(ctx, actor).isModerator))
    throw new NotFoundError();
  return { comment, post };
}
export function reactableProfilePost(
  ctx: Ctx,
  actor: Actor,
  profilePostId: number,
): { authorId: number; isVisible: boolean } {
  const row = requirePost(ctx, actor, profilePostId);
  return { authorId: row.user_id, isVisible: row.state === "visible" };
}
export function reactableProfileComment(
  ctx: Ctx,
  actor: Actor,
  commentId: number,
): { authorId: number; isVisible: boolean } {
  const { comment, post } = requireComment(ctx, actor, commentId);
  return {
    authorId: comment.user_id,
    isVisible: comment.state === "visible" && post.state === "visible",
  };
}

export function latestComments(ctx: Ctx, actor: Actor, rows: PostRow[]): CommentRow[] {
  if (!rows.length) return [];
  const flags = getGlobalPermissions(ctx, actor);
  return prepared(ctx, "profiles.latestComments", () =>
    ctx.sqlite.prepare<CommentRow, [string, number, number]>(
      "SELECT id, profile_post_id, user_id, state, created_at, edited_at, body_source, body_html, reaction_counts FROM (" +
        "SELECT c.*, row_number() OVER (PARTITION BY profile_post_id ORDER BY id DESC) AS rn " +
        "FROM profile_post_comments c WHERE profile_post_id IN (SELECT value FROM json_each(?1)) " +
        "AND (state = 'visible' OR ?2 = 1 OR (state = 'moderated' AND user_id = ?3))) WHERE rn <= 3",
    ),
  ).all(
    JSON.stringify(rows.map((row) => row.id)),
    Number(flags.isModerator),
    actorUserId(actor) ?? 0,
  );
}
export function commentValues(
  ctx: Ctx,
  actor: Actor,
  rows: CommentRow[],
  wallOwnerId: number | Map<number, number>,
  user: ReturnType<typeof loadUserSummaries>,
) {
  const viewer = actorUserId(actor);
  const moderator = getGlobalPermissions(ctx, actor).isModerator;
  const reactions = loadViewerReactions(
    ctx,
    actor,
    "profile_post_comment",
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    profilePostId: row.profile_post_id,
    author: user(row.user_id),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: row.body_html,
    reactions: reactionSummary(row.reaction_counts, reactions.get(row.id)),
    canEdit: viewer !== null && (moderator || viewer === row.user_id),
    canDelete:
      viewer !== null &&
      (moderator ||
        viewer === row.user_id ||
        viewer ===
          (typeof wallOwnerId === "number" ? wallOwnerId : wallOwnerId.get(row.profile_post_id))),
  }));
}
export function postValues(ctx: Ctx, actor: Actor, rows: PostRow[], latest: CommentRow[] = []) {
  const viewer = actorUserId(actor);
  const flags = getGlobalPermissions(ctx, actor);
  const user = loadUserSummaries(ctx, [
    ...rows.map((row) => row.user_id),
    ...latest.map((row) => row.user_id),
  ]);
  const commentsByPost = new Map<number, ReturnType<typeof commentValues>>();
  const ownerByPost = new Map(rows.map((row) => [row.id, row.profile_user_id]));
  for (const value of commentValues(ctx, actor, latest, ownerByPost, user)) {
    const group = commentsByPost.get(value.profilePostId) ?? [];
    group.push(value);
    commentsByPost.set(value.profilePostId, group);
  }
  for (const group of commentsByPost.values()) group.sort((a, b) => a.id - b.id);
  const reactions = loadViewerReactions(
    ctx,
    actor,
    "profile_post",
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    profileUserId: row.profile_user_id,
    author: user(row.user_id),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: row.body_html,
    reactions: reactionSummary(row.reaction_counts, reactions.get(row.id)),
    commentCount: row.comment_count,
    latestComments: commentsByPost.get(row.id) ?? [],
    canEdit: viewer !== null && (flags.isModerator || viewer === row.user_id),
    canDelete:
      viewer !== null &&
      (flags.isModerator || viewer === row.user_id || viewer === row.profile_user_id),
    canComment: viewer !== null && flags.canPostProfile && row.state === "visible",
  }));
}
export function postValue(ctx: Ctx, actor: Actor, row: PostRow) {
  return postValues(ctx, actor, [row], latestComments(ctx, actor, [row]))[0]!;
}
export function commentValue(ctx: Ctx, actor: Actor, row: CommentRow, wallOwnerId: number) {
  const user = loadUserSummaries(ctx, [row.user_id]);
  return commentValues(ctx, actor, [row], wallOwnerId, user)[0]!;
}
export function changeCommentCount(ctx: Ctx, postId: number, delta: number) {
  ctx.sqlite
    .prepare(
      "UPDATE profile_posts SET comment_count = comment_count + ?2, " +
        "last_comment_at = (SELECT created_at FROM profile_post_comments WHERE profile_post_id = ?1 AND state = 'visible' ORDER BY id DESC LIMIT 1) WHERE id = ?1",
    )
    .run(postId, delta);
}
