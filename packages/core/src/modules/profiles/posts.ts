import * as z from "zod";
import { type Actor, actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  profilePostsCreate,
  profilePostsDelete,
  profilePostsGet,
  profilePostsList,
  profilePostsRestore,
  profilePostsUpdate,
  profilesGet,
  profilesUpdate,
  usersSearch,
} from "../../contracts/profiles";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { renderMarkdown } from "../../render";
import { iso } from "../../time";
import { getGlobalPermissions } from "../permissions";
import { resolvedFileUrl } from "../storage/url";
import {
  latestComments,
  type PostRow,
  postValue,
  postValues,
  requirePost,
  requireView,
  WALL_SQL,
} from "./shared";

type ProfileRow = {
  id: number;
  username: string;
  group_title: string;
  created_at: number;
  about: string;
  post_count: number;
  reaction_score: number;
  avatar_file_id: number | null;
  cover_file_id: number | null;
};
function readProfile(ctx: Ctx, actor: Actor, userId: number) {
  const flags = getGlobalPermissions(ctx, actor);
  const row = prepared(ctx, "profiles.profile", () =>
    ctx.sqlite.prepare<ProfileRow, [number]>(
      "SELECT u.id, u.username, g.title AS group_title, u.created_at, u.about, u.post_count, u.reaction_score, u.avatar_file_id, u.cover_file_id FROM users u JOIN groups g ON g.id = u.group_id WHERE u.id = ?1",
    ),
  ).get(userId);
  if (!row) throw new NotFoundError();
  return {
    id: row.id,
    username: row.username,
    groupTitle: row.group_title,
    createdAt: iso(row.created_at),
    about: row.about,
    avatar:
      row.avatar_file_id === null
        ? null
        : { fileId: row.avatar_file_id, url: resolvedFileUrl(ctx, row.avatar_file_id, true) },
    cover:
      row.cover_file_id === null
        ? null
        : { fileId: row.cover_file_id, url: resolvedFileUrl(ctx, row.cover_file_id, true) },
    postCount: row.post_count,
    reactionScore: row.reaction_score,
    canPostOnWall: actorUserId(actor) !== null && flags.canViewProfiles && flags.canPostProfile,
  };
}
export const profilesGetOp = implement(profilesGet, (ctx, actor, input) => {
  requireView(ctx, actor);
  return readProfile(ctx, actor, input.userId);
});
export const profilesUpdateOp = implement(profilesUpdate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  writeTx(ctx, () => {
    prepared(ctx, "profiles.updateAbout", () =>
      ctx.sqlite.prepare<unknown, [string, number]>("UPDATE users SET about = ?1 WHERE id = ?2"),
    ).run(input.about, user.userId);
    publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: user.userId });
  });
  return readProfile(ctx, actor, user.userId);
});
export const USER_SEARCH_SQL =
  "SELECT id, username FROM users WHERE username_key >= ?1 AND username_key < ?2 ORDER BY username_key LIMIT ?3";
export const USER_SEARCH_TAIL_SQL =
  "SELECT id, username FROM users WHERE username_key >= ?1 ORDER BY username_key LIMIT ?2";
export function prefixSuccessor(prefix: string): string | null {
  const points = Array.from(prefix);
  while (points.length) {
    const point = points.pop()!.codePointAt(0)!;
    if (point < 0x10ffff)
      return points.join("") + String.fromCodePoint(point === 0xd7ff ? 0xe000 : point + 1);
  }
  return null;
}
export const usersSearchOp = implement(usersSearch, (ctx, actor, input) => {
  requireView(ctx, actor);
  const prefix = input.prefix.toLowerCase();
  const end = prefixSuccessor(prefix);
  if (end === null) {
    const items = prepared(ctx, "profiles.userSearchTail", () =>
      ctx.sqlite.prepare<{ id: number; username: string }, [string, number]>(USER_SEARCH_TAIL_SQL),
    ).all(prefix, input.limit);
    return { items };
  }
  const items = prepared(ctx, "profiles.userSearch", () =>
    ctx.sqlite.prepare<{ id: number; username: string }, [string, string, number]>(USER_SEARCH_SQL),
  ).all(prefix, end, input.limit);
  return { items };
});
export const profilePostsListOp = implement(profilePostsList, (ctx, actor, input) => {
  requireView(ctx, actor);
  if (
    !prepared(ctx, "profiles.userExists", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1"),
    ).get(input.userId)
  )
    throw new NotFoundError();
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const flags = getGlobalPermissions(ctx, actor);
  const rows = prepared(ctx, "profiles.wall", () =>
    ctx.sqlite.prepare<PostRow, [number, number, number, number, number]>(WALL_SQL),
  ).all(input.userId, cursor, Number(flags.isModerator), actorUserId(actor) ?? 0, input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    items: postValues(ctx, actor, page, latestComments(ctx, actor, page)),
    nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.id]) : null,
  };
});
export const profilePostsGetOp = implement(profilePostsGet, (ctx, actor, input) => {
  const row = requirePost(ctx, actor, input.profilePostId);
  return { ...postValue(ctx, actor, row), bodySource: row.body_source };
});
export const profilePostsCreateOp = implement(profilePostsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  if (!requireView(ctx, actor).canPostProfile) throw new ForbiddenError();
  const html = renderMarkdown(input.body);
  const row = writeTx(ctx, () => {
    if (
      !prepared(ctx, "profiles.userExists", () =>
        ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1"),
      ).get(input.userId)
    )
      throw new NotFoundError();
    const post = prepared(ctx, "profiles.insertPost", () =>
      ctx.sqlite.prepare<PostRow, [number, number, number, string, string]>(
        "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *",
      ),
    ).get(input.userId, user.userId, ctx.now(), input.body, html)!;
    publishEvent(ctx, { type: "content.created", targetType: "profile_post", targetId: post.id });
    return post;
  });
  return { ...postValues(ctx, actor, [row])[0]!, bodySource: row.body_source };
});
export const profilePostsUpdateOp = implement(profilePostsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (row.user_id !== actorUserId(actor) && !getGlobalPermissions(ctx, actor).isModerator)
    throw new ForbiddenError();
  const html = renderMarkdown(input.body);
  writeTx(ctx, () => {
    prepared(ctx, "profiles.updatePost", () =>
      ctx.sqlite.prepare<unknown, [string, string, number, number]>(
        "UPDATE profile_posts SET body_source = ?1, body_html = ?2, edited_at = ?3 WHERE id = ?4",
      ),
    ).run(input.body, html, ctx.now(), row.id);
    publishEvent(ctx, { type: "content.edited", targetType: "profile_post", targetId: row.id });
  });
  return profilePostsGetOp.run(ctx, actor, input);
});
export const profilePostsDeleteOp = implement(profilePostsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (
    row.user_id !== actorUserId(actor) &&
    row.profile_user_id !== actorUserId(actor) &&
    !getGlobalPermissions(ctx, actor).isModerator
  )
    throw new ForbiddenError();
  writeTx(ctx, () => {
    const result = prepared(ctx, "profiles.deletePost", () =>
      ctx.sqlite.prepare<unknown, [number]>(
        "UPDATE profile_posts SET state = 'deleted' WHERE id = ?1 AND state != 'deleted'",
      ),
    ).run(row.id);
    if (result.changes)
      publishEvent(ctx, { type: "content.deleted", targetType: "profile_post", targetId: row.id });
  });
  return postValue(ctx, actor, { ...row, state: "deleted" });
});
export const profilePostsRestoreOp = implement(profilePostsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (!getGlobalPermissions(ctx, actor).isModerator) throw new ForbiddenError();
  writeTx(ctx, () => {
    const result = prepared(ctx, "profiles.restorePost", () =>
      ctx.sqlite.prepare<unknown, [number]>(
        "UPDATE profile_posts SET state = 'visible' WHERE id = ?1 AND state != 'visible'",
      ),
    ).run(row.id);
    if (result.changes)
      publishEvent(ctx, {
        type: "content.state_changed",
        targetType: "profile_post",
        targetId: row.id,
      });
  });
  return postValue(ctx, actor, { ...row, state: "visible" });
});
