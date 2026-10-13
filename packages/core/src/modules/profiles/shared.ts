import type { Actor } from "../../actor";
import { actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { NotFoundError } from "../../errors";
import { markPublic } from "../../operation";
import { can, permissionsOf, requirePermission } from "../../permissions";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { loadAttachments } from "../attachments";
import { readSiteSettings } from "../settings";

export type ProfileAccess = {
  profile_view_privacy: "everyone" | "members" | "followed" | "self";
  profile_post_privacy: "members" | "followed" | "self";
  follows: number;
};
/**
 * The privacy settings of one member and whether that member follows the viewer, as
 * `profileAccessMany` reads them for a page.
 */
export const PROFILE_ACCESS_SQL =
  "SELECT id, profile_view_privacy, profile_post_privacy, EXISTS(SELECT 1 FROM user_follows WHERE user_id = users.id AND followed_id = ?1) AS follows FROM users WHERE id IN (SELECT value FROM json_each(?2))";
export const profileAccess = markPublic(
  "Callers enforce profile visibility before returning content.",
  function profileAccess(ctx: Ctx, actor: Actor, userId: number): ProfileAccess {
    const row = profileAccessMany(ctx, actor, [userId]).get(userId);
    if (!row) throw new NotFoundError();
    return row;
  },
);
/** `profileAccess` for several members in one query; members that do not exist are absent. */
export const profileAccessMany = markPublic(
  "Callers enforce profile visibility before returning content.",
  function profileAccessMany(
    ctx: Ctx,
    actor: Actor,
    userIds: Iterable<number>,
  ): Map<number, ProfileAccess> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    return new Map(
      prepared(ctx, "profiles.privacy", () =>
        ctx.sqlite.prepare<ProfileAccess & { id: number }, [number, string]>(PROFILE_ACCESS_SQL),
      )
        .all(actorUserId(actor) ?? 0, JSON.stringify(ids))
        .map((row) => [row.id, row] as const),
    );
  },
);
export function mayViewProfile(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  access?: ProfileAccess,
): boolean {
  const viewerId = actorUserId(actor);
  if (viewerId === userId || can(ctx, actor, "profile.bypassPrivacy")) return true;
  return profileModeAllows(access ?? profileAccess(ctx, actor, userId), viewerId);
}
/** A member's profile privacy against a viewer who is neither them nor allowed to bypass it. */
export function profileModeAllows(row: ProfileAccess, viewerId: number | null): boolean {
  const mode = row.profile_view_privacy;
  return (
    mode === "everyone" ||
    (viewerId !== null && (mode === "members" || (mode === "followed" && row.follows === 1)))
  );
}
export function requireProfileView(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  access?: ProfileAccess,
): void {
  requireView(ctx, actor);
  if (!mayViewProfile(ctx, actor, userId, access)) throw new NotFoundError();
}
function wallAllows(ctx: Ctx, actor: Actor, ownerId: number, access?: ProfileAccess): boolean {
  const viewerId = actorUserId(actor);
  if (viewerId === null || !readSiteSettings(ctx).profilePostsEnabled) return false;
  return wallRule(ctx, actor, viewerId, ownerId, access ?? profileAccess(ctx, actor, ownerId), () =>
    ownerIgnores(ctx, ownerId, viewerId),
  );
}
function ownerIgnores(ctx: Ctx, ownerId: number, viewerId: number): boolean {
  return !!prepared(ctx, "profiles.ownerIgnores", () =>
    ctx.sqlite.prepare<{ id: number }, [number, number]>(
      "SELECT id FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2",
    ),
  ).get(ownerId, viewerId);
}
/**
 * Whether a signed-in viewer may use a member's wall, given the wall owner's privacy row and a
 * way to ask whether the owner ignores the viewer (called only when the answer can matter).
 * The one statement of the rule, for a single wall and for a page of walls.
 */
function wallRule(
  ctx: Ctx,
  actor: Actor,
  viewerId: number,
  ownerId: number,
  row: ProfileAccess,
  ignoresViewer: () => boolean,
): boolean {
  if (!mayViewProfile(ctx, actor, ownerId, row)) return false;
  // An ignore applies only while the author can be ignored (staff cannot).
  if (viewerId !== ownerId && can(ctx, actor, "member.ignorable") && ignoresViewer()) return false;
  if (can(ctx, actor, "profile.bypassPrivacy")) return true;
  const mode = row.profile_post_privacy;
  if (mode === "self" && viewerId !== ownerId) return false;
  if (mode === "followed" && viewerId !== ownerId && row.follows !== 1) return false;
  return true;
}
export function mayPostOnWall(
  ctx: Ctx,
  actor: Actor,
  ownerId: number,
  access?: ProfileAccess,
): boolean {
  return can(ctx, actor, "profilePost.post") && wallAllows(ctx, actor, ownerId, access);
}
export function mayCommentOnWall(
  ctx: Ctx,
  actor: Actor,
  ownerId: number,
  access?: ProfileAccess,
): boolean {
  return can(ctx, actor, "profilePost.comment") && wallAllows(ctx, actor, ownerId, access);
}
/**
 * `mayCommentOnWall` for the walls of a page, in a fixed number of queries: one for the site
 * settings, one for the owners' privacy rows and one for the owners who ignore the viewer.
 */
export function mayCommentOnWalls(
  ctx: Ctx,
  actor: Actor,
  ownerIds: Iterable<number>,
  access?: Map<number, ProfileAccess>,
): Map<number, boolean> {
  const owners = [...new Set(ownerIds)];
  const viewerId = actorUserId(actor);
  const result = new Map<number, boolean>(owners.map((id) => [id, false]));
  if (
    owners.length === 0 ||
    viewerId === null ||
    !can(ctx, actor, "profilePost.comment") ||
    !readSiteSettings(ctx).profilePostsEnabled
  )
    return result;
  const rows = access ?? profileAccessMany(ctx, actor, owners);
  const ignoring = can(ctx, actor, "member.ignorable")
    ? new Set(
        prepared(ctx, "profiles.ownersIgnore", () =>
          ctx.sqlite.prepare<{ user_id: number }, [number, string]>(
            "SELECT user_id FROM user_ignores WHERE ignored_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
          ),
        )
          .all(viewerId, JSON.stringify(owners))
          .map((row) => row.user_id),
      )
    : new Set<number>();
  for (const ownerId of owners) {
    const row = rows.get(ownerId);
    if (row)
      result.set(
        ownerId,
        wallRule(ctx, actor, viewerId, ownerId, row, () => ignoring.has(ownerId)),
      );
  }
  return result;
}

export type State = "visible" | "moderated" | "deleted";
export function touchProfile(ctx: Ctx, userId: number): void {
  prepared(ctx, "profiles.touchPublicContent", () =>
    ctx.sqlite.prepare("UPDATE users SET content_updated_at = ?1 WHERE id = ?2"),
  ).run(ctx.now(), userId);
}
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
  attachment_count: number;
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

export const WALL_SQL =
  "SELECT * FROM profile_posts WHERE profile_user_id = ?1 AND id < ?2 " +
  "AND (state = 'visible' OR (state = 'moderated' AND (?3 = 1 OR user_id = ?5)) OR (state = 'deleted' AND ?4 = 1)) ORDER BY id DESC LIMIT ?6";
export const COMMENTS_SQL =
  "SELECT * FROM profile_post_comments WHERE profile_post_id = ?1 AND id < ?2 " +
  "AND (state = 'visible' OR (state = 'moderated' AND (?3 = 1 OR user_id = ?5)) OR (state = 'deleted' AND ?4 = 1)) ORDER BY id DESC LIMIT ?6";
export const LATEST_COMMENTS_SQL =
  "SELECT c.* FROM json_each(?1) AS j CROSS JOIN profile_post_comments AS c " +
  "WHERE c.id IN (SELECT c2.id FROM profile_post_comments AS c2 " +
  "WHERE c2.profile_post_id = j.value " +
  "AND (c2.state = 'visible' OR (c2.state = 'moderated' AND (?2 = 1 OR c2.user_id = ?4)) OR (c2.state = 'deleted' AND ?3 = 1)) " +
  "ORDER BY c2.id DESC LIMIT 3)";

export function requireView(ctx: Ctx, actor: Actor) {
  requirePermission(ctx, actor, "profile.view");
}
export function maySee(ctx: Ctx, state: State, authorId: number, actor: Actor) {
  return (
    state === "visible" ||
    (state === "moderated" &&
      (authorId === actorUserId(actor) || can(ctx, actor, "profilePost.viewModerated"))) ||
    (state === "deleted" && can(ctx, actor, "profilePost.viewDeleted"))
  );
}
export function requirePost(
  ctx: Ctx,
  actor: Actor,
  id: number,
  ownCommentAuthorId?: number,
): PostRow {
  requireView(ctx, actor);
  const row = prepared(ctx, "profiles.post", () =>
    ctx.sqlite.prepare<PostRow, [number]>("SELECT * FROM profile_posts WHERE id = ?1"),
  ).get(id);
  if (!row || !maySee(ctx, row.state, row.user_id, actor)) throw new NotFoundError();
  if (actorUserId(actor) !== row.user_id && actorUserId(actor) !== ownCommentAuthorId)
    requireProfileView(ctx, actor, row.profile_user_id);
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
  const post = requirePost(
    ctx,
    actor,
    comment.profile_post_id,
    actorUserId(actor) === comment.user_id ? comment.user_id : undefined,
  );
  if (!maySee(ctx, comment.state, comment.user_id, actor)) throw new NotFoundError();
  return { comment, post };
}
export function reactableProfilePost(
  ctx: Ctx,
  actor: Actor,
  profilePostId: number,
): { authorId: number; isVisible: boolean } {
  requirePermission(ctx, actor, "profile.view", {}, { notFound: true });
  const row = requirePost(ctx, actor, profilePostId);
  return { authorId: row.user_id, isVisible: row.state === "visible" };
}
export function reactableProfileComment(
  ctx: Ctx,
  actor: Actor,
  commentId: number,
): { authorId: number; isVisible: boolean } {
  requirePermission(ctx, actor, "profile.view", {}, { notFound: true });
  const { comment, post } = requireComment(ctx, actor, commentId);
  return {
    authorId: comment.user_id,
    isVisible: comment.state === "visible" && post.state === "visible",
  };
}

export function latestComments(ctx: Ctx, actor: Actor, rows: PostRow[]): CommentRow[] {
  if (!rows.length) return [];
  const permissions = permissionsOf(ctx, actor);
  return prepared(ctx, "profiles.latestComments", () =>
    ctx.sqlite.prepare<CommentRow, [string, number, number, number]>(LATEST_COMMENTS_SQL),
  ).all(
    JSON.stringify(rows.map((row) => row.id)),
    Number(permissions.can("profilePost.viewModerated")),
    Number(permissions.can("profilePost.viewDeleted")),
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
  const permissions = permissionsOf(ctx, actor);
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
    canEdit:
      permissions.can("profilePost.editAny") ||
      permissions.can("profilePost.editOwn", { ownerId: row.user_id }),
    canDelete:
      permissions.can("profilePost.deleteAny") ||
      permissions.can("profilePost.deleteOwn", { ownerId: row.user_id }) ||
      permissions.can("profilePost.manageOwnWall", {
        ownerId:
          typeof wallOwnerId === "number" ? wallOwnerId : wallOwnerId.get(row.profile_post_id),
      }),
  }));
}
export function postValues(ctx: Ctx, actor: Actor, rows: PostRow[], latest: CommentRow[] = []) {
  const attachments = loadAttachments(
    ctx,
    "profile_post",
    rows.map((row) => row.id),
  );
  const permissions = permissionsOf(ctx, actor);
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
  const commentAccess = mayCommentOnWalls(
    ctx,
    actor,
    rows.map((row) => row.profile_user_id),
  );
  return rows.map((row) => ({
    id: row.id,
    profileUserId: row.profile_user_id,
    author: user(row.user_id),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: row.body_html,
    attachmentCount: row.attachment_count,
    attachments: attachments.get(row.id) ?? [],
    reactions: reactionSummary(row.reaction_counts, reactions.get(row.id)),
    commentCount: row.comment_count,
    latestComments: commentsByPost.get(row.id) ?? [],
    canEdit:
      permissions.can("profilePost.editAny") ||
      permissions.can("profilePost.editOwn", { ownerId: row.user_id }),
    canDelete:
      permissions.can("profilePost.deleteAny") ||
      permissions.can("profilePost.deleteOwn", { ownerId: row.user_id }) ||
      permissions.can("profilePost.manageOwnWall", { ownerId: row.profile_user_id }),
    canComment: commentAccess.get(row.profile_user_id) === true && row.state === "visible",
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
  prepared(ctx, "profiles.changeCommentCount", () =>
    ctx.sqlite.prepare<unknown, [number, number]>(
      "UPDATE profile_posts SET comment_count = comment_count + ?2, " +
        "last_comment_at = (SELECT created_at FROM profile_post_comments WHERE profile_post_id = ?1 AND state = 'visible' ORDER BY id DESC LIMIT 1) WHERE id = ?1",
    ),
  ).run(postId, delta);
}
