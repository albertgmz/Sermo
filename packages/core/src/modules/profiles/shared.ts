import type { Actor } from "../../actor";
import { actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { AdultContentError, type AdultRefusal, NotFoundError } from "../../errors";
import { markPublic } from "../../operation";
import {
  AWAITING_SQL,
  adultRefusalFor,
  can,
  permissionsOf,
  requirePermission,
} from "../../permissions";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { loadAttachments } from "../attachments";
import { contentAuthor } from "../forums/guest-author";
import { requireSiteView } from "../members/site-access";
import {
  type DeletionRow,
  deleterIds,
  deletionValue,
  loadDeletions,
} from "../moderation/deletions";
import { readSiteSettings } from "../settings";
import { blockedAmong, seesPastBlocks, withoutBlocked } from "../social/blocks";
import { bodiesWithoutBlockedQuotes } from "../social/quotes";

export type ProfileAccess = {
  profile_view_privacy: "everyone" | "members" | "followed" | "self";
  profile_post_privacy: "members" | "followed" | "self";
  follows: number;
  /** The profile is marked +18. */
  profile_adult: number;
  /** The member blocks the viewer. */
  blocks_viewer: number;
  /** The viewer blocks the member. */
  blocked_by_viewer: number;
};
/**
 * The privacy settings of one member, their +18 mark, whether that member follows the viewer and
 * the block between them either way, as `profileAccessMany` reads them for a page.
 */
export const PROFILE_ACCESS_SQL = `SELECT u.id, CASE WHEN ${AWAITING_SQL} THEN 'self' ELSE u.profile_view_privacy END AS profile_view_privacy, u.profile_post_privacy, u.profile_adult, EXISTS(SELECT 1 FROM user_follows WHERE user_id = u.id AND followed_id = ?1) AS follows, EXISTS(SELECT 1 FROM user_blocks WHERE user_id = u.id AND blocked_id = ?1) AS blocks_viewer, EXISTS(SELECT 1 FROM user_blocks WHERE user_id = ?1 AND blocked_id = u.id) AS blocked_by_viewer FROM users u WHERE u.id IN (SELECT value FROM json_each(?2))`;
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
/**
 * Whether the viewer may see a member's profile: true, false (privacy, or the member blocks the
 * viewer), or why its +18 mark keeps it from them (it would be visible otherwise). A member always
 * sees their own; staff see past a block, and the member who blocked still opens the profile of
 * the member they block (to undo it there).
 */
function profileVerdict(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  access?: ProfileAccess,
): boolean | AdultRefusal {
  const viewerId = actorUserId(actor);
  if (viewerId === userId) return true;
  let row = access;
  if (can(ctx, actor, "profile.bypassPrivacy"))
    row ??= profileAccessMany(ctx, actor, [userId]).get(userId);
  else {
    row ??= profileAccess(ctx, actor, userId);
    if (!profileModeAllows(row, viewerId)) return false;
  }
  if (row?.blocks_viewer === 1 && !seesPastBlocks(ctx, actor)) return false;
  return (row?.profile_adult === 1 && adultRefusalFor(ctx, actor)) || true;
}
export function mayViewProfile(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  access?: ProfileAccess,
): boolean {
  return profileVerdict(ctx, actor, userId, access) === true;
}
/** A member's profile privacy against a viewer who is neither them nor allowed to bypass it. */
export function profileModeAllows(
  row: Pick<ProfileAccess, "profile_view_privacy" | "follows">,
  viewerId: number | null,
): boolean {
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
  const verdict = profileVerdict(ctx, actor, userId, access);
  if (verdict === false) throw new NotFoundError();
  if (verdict !== true) throw new AdultContentError(verdict);
}
function wallAllows(ctx: Ctx, actor: Actor, ownerId: number, access?: ProfileAccess): boolean {
  const viewerId = actorUserId(actor);
  if (viewerId === null || !readSiteSettings(ctx).profilePostsEnabled) return false;
  return wallRule(ctx, actor, viewerId, ownerId, access ?? profileAccess(ctx, actor, ownerId));
}
/**
 * Whether a signed-in viewer may use a member's wall, given the wall owner's privacy row. The one
 * statement of the rule, for a single wall and for a page of walls.
 */
function wallRule(
  ctx: Ctx,
  actor: Actor,
  viewerId: number,
  ownerId: number,
  row: ProfileAccess,
): boolean {
  if (!can(ctx, actor, "profilePost.view")) return false;
  if (!mayViewProfile(ctx, actor, ownerId, row)) return false;
  // Neither member of a block posts on the other's wall, staff included.
  if (viewerId !== ownerId && (row.blocks_viewer === 1 || row.blocked_by_viewer === 1))
    return false;
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
  // One's own wall and other members' walls are separate permissions.
  const may =
    actorUserId(actor) === ownerId
      ? can(ctx, actor, "profilePost.postOwn")
      : can(ctx, actor, "profilePost.post");
  return may && wallAllows(ctx, actor, ownerId, access);
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
 * settings and one for the owners' privacy rows (blocks included).
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
    !can(ctx, actor, "profilePost.view") ||
    !readSiteSettings(ctx).profilePostsEnabled
  )
    return result;
  const rows = access ?? profileAccessMany(ctx, actor, owners);
  for (const ownerId of owners) {
    const row = rows.get(ownerId);
    if (row) result.set(ownerId, wallRule(ctx, actor, viewerId, ownerId, row));
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
  attachment_count: number;
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
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view");
}
/** Refuses a viewer who cannot read wall posts (`profilePost.view`). */
export function requireWallView(ctx: Ctx, actor: Actor) {
  requirePermission(ctx, actor, "profilePost.view");
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
  requireWallView(ctx, actor);
  const row = prepared(ctx, "profiles.post", () =>
    ctx.sqlite.prepare<PostRow, [number]>("SELECT * FROM profile_posts WHERE id = ?1"),
  ).get(id);
  if (!row || !maySee(ctx, row.state, row.user_id, actor)) throw new NotFoundError();
  if (blockedAmong(ctx, actor, [row.user_id]).size > 0) throw new NotFoundError();
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
  if (blockedAmong(ctx, actor, [comment.user_id]).size > 0) throw new NotFoundError();
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

/**
 * The newest comments of each wall post, without those by members in a block with the viewer
 * (a post may then show fewer).
 */
export function latestComments(ctx: Ctx, actor: Actor, rows: PostRow[]): CommentRow[] {
  if (!rows.length) return [];
  const permissions = permissionsOf(ctx, actor);
  const comments = prepared(ctx, "profiles.latestComments", () =>
    ctx.sqlite.prepare<CommentRow, [string, number, number, number]>(LATEST_COMMENTS_SQL),
  ).all(
    JSON.stringify(rows.map((row) => row.id)),
    Number(permissions.can("profilePost.viewModerated")),
    Number(permissions.can("profilePost.viewDeleted")),
    actorUserId(actor) ?? 0,
  );
  return withoutBlocked(ctx, actor, comments);
}
/** Who hid the deleted ones among `rows`, for a viewer who may see deleted wall content. */
function wallDeletions(
  ctx: Ctx,
  permissions: ReturnType<typeof permissionsOf>,
  targetType: "profile_post" | "profile_post_comment",
  rows: { id: number; state: State }[],
) {
  if (!permissions.can("profilePost.viewDeleted")) return new Map<number, DeletionRow>();
  return loadDeletions(
    ctx,
    targetType,
    rows.filter((row) => row.state === "deleted").map((row) => row.id),
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
  // The deleters' names in one read, only where a page holds deleted comments for the staff.
  const deletions = wallDeletions(ctx, permissions, "profile_post_comment", rows);
  const deleters = deleterIds(deletions);
  const by = deleters.length ? loadUserSummaries(ctx, deleters) : user;
  const reactions = loadViewerReactions(
    ctx,
    actor,
    "profile_post_comment",
    rows.map((row) => row.id),
  );
  // Most comments carry no file: only those that do are looked up.
  const attachments = loadAttachments(
    ctx,
    "profile_post_comment",
    rows.filter((row) => row.attachment_count > 0).map((row) => row.id),
  );
  const bodies = bodiesWithoutBlockedQuotes(ctx, actor, "profile_post_comment", rows);
  return rows.map((row) => ({
    id: row.id,
    profilePostId: row.profile_post_id,
    author: contentAuthor(user, row.user_id, null),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: bodies.get(row.id) ?? row.body_html,
    attachmentCount: row.attachment_count,
    attachments: attachments.get(row.id) ?? [],
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
    canHardDelete: permissions.can("profilePost.hardDelete"),
    canReport: permissions.can("report.create"),
    deletion: deletionValue(
      deletions.get(row.id),
      (id) => (id === row.user_id ? user(id) : by(id)),
      row.user_id,
    ),
  }));
}
export function postValues(ctx: Ctx, actor: Actor, rows: PostRow[], latest: CommentRow[] = []) {
  const attachments = loadAttachments(
    ctx,
    "profile_post",
    rows.map((row) => row.id),
  );
  const permissions = permissionsOf(ctx, actor);
  const deletions = wallDeletions(ctx, permissions, "profile_post", rows);
  const user = loadUserSummaries(ctx, [
    ...rows.map((row) => row.user_id),
    ...latest.map((row) => row.user_id),
    ...deleterIds(deletions),
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
  const bodies = bodiesWithoutBlockedQuotes(ctx, actor, "profile_post", rows);
  return rows.map((row) => ({
    id: row.id,
    profileUserId: row.profile_user_id,
    author: contentAuthor(user, row.user_id, null),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: bodies.get(row.id) ?? row.body_html,
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
    canReport: permissions.can("report.create"),
    canComment: commentAccess.get(row.profile_user_id) === true && row.state === "visible",
    deletion: deletionValue(deletions.get(row.id), user, row.user_id),
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

/** Whether the actor may edit a wall post or comment its author wrote. */
export function mayEditWallContent(ctx: Ctx, actor: Actor, authorId: number): boolean {
  return (
    can(ctx, actor, "profilePost.editAny") ||
    can(ctx, actor, "profilePost.editOwn", { ownerId: authorId })
  );
}
/** Whether the actor may delete a wall post or comment its author wrote on a member's wall. */
export function mayDeleteWallContent(
  ctx: Ctx,
  actor: Actor,
  authorId: number,
  wallOwnerId: number,
): boolean {
  return (
    can(ctx, actor, "profilePost.deleteAny") ||
    can(ctx, actor, "profilePost.deleteOwn", { ownerId: authorId }) ||
    can(ctx, actor, "profilePost.manageOwnWall", { ownerId: wallOwnerId })
  );
}
