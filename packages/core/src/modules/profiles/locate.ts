import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { profileCommentsLocate, profilePostsLocate } from "../../contracts/profiles";
import { implement } from "../../operation";
import { encodeCursor } from "../../pagination";
import { permissionsOf } from "../../permissions";
import { requireComment, requirePost } from "./shared";

// What the viewer may see of a wall or of a post's comments, as `WALL_SQL` and `COMMENTS_SQL`
// filter it (?3 view moderated, ?4 view deleted, ?5 the viewer).
const SEEN =
  "(state = 'visible' OR (state = 'moderated' AND (?3 = 1 OR user_id = ?5)) OR (state = 'deleted' AND ?4 = 1))";

/**
 * The items above one item in a list read newest first by `id < cursor`: how many the viewer may
 * see (one range of the list's `(<owner>, id)` index), and the id of the one `?6` places above it
 * (nearest first), which closes the page before the item's page.
 */
export const locateSql = {
  wallAbove: `SELECT count(*) AS n FROM profile_posts WHERE profile_user_id = ?1 AND id > ?2 AND ${SEEN}`,
  wallNth: `SELECT id FROM profile_posts WHERE profile_user_id = ?1 AND id > ?2 AND ${SEEN} ORDER BY id LIMIT 1 OFFSET ?6`,
  commentsAbove: `SELECT count(*) AS n FROM profile_post_comments WHERE profile_post_id = ?1 AND id > ?2 AND ${SEEN}`,
  commentsNth: `SELECT id FROM profile_post_comments WHERE profile_post_id = ?1 AND id > ?2 AND ${SEEN} ORDER BY id LIMIT 1 OFFSET ?6`,
};

type Params = [number, number, number, number, number];

// The cursor of the page of `limit` items, counted from the newest, that holds the item `id` of
// the list `ownerId`: null on the first page, else the id of the item that ends the page before.
function pageCursor(
  ctx: Ctx,
  actor: Actor,
  list: "wall" | "comments",
  ownerId: number,
  id: number,
  limit: number,
): string | null {
  const permissions = permissionsOf(ctx, actor);
  const params: Params = [
    ownerId,
    id,
    Number(permissions.can("profilePost.viewModerated")),
    Number(permissions.can("profilePost.viewDeleted")),
    actorUserId(actor) ?? 0,
  ];
  const above = prepared(ctx, `profiles.${list}Above`, () =>
    ctx.sqlite.prepare<{ n: number }, Params>(locateSql[`${list}Above`]),
  ).get(...params)!.n;
  if (above < limit) return null;
  const closing = prepared(ctx, `profiles.${list}Nth`, () =>
    ctx.sqlite.prepare<{ id: number }, [...Params, number]>(locateSql[`${list}Nth`]),
  ).get(...params, above % limit);
  return closing ? encodeCursor([closing.id]) : null;
}

export const profilePostsLocateOp = implement(profilePostsLocate, (ctx, actor, input) => {
  const post = requirePost(ctx, actor, input.profilePostId);
  return {
    profilePostId: post.id,
    profileUserId: post.profile_user_id,
    cursor: pageCursor(ctx, actor, "wall", post.profile_user_id, post.id, input.limit),
  };
});

export const profileCommentsLocateOp = implement(profileCommentsLocate, (ctx, actor, input) => {
  const { comment, post } = requireComment(ctx, actor, input.commentId);
  return {
    commentId: comment.id,
    profilePostId: post.id,
    profileUserId: post.profile_user_id,
    wallCursor: pageCursor(ctx, actor, "wall", post.profile_user_id, post.id, input.limit),
    commentsCursor: pageCursor(ctx, actor, "comments", post.id, comment.id, input.limit),
  };
});
