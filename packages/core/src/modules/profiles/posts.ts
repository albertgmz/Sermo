import * as z from "zod";
import { actorUserId, requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
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
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { renderMarkdown } from "../../render";
import { iso } from "../../time";
import { getGlobalPermissions } from "../permissions";
import {
  latestComments,
  type PostRow,
  postValue,
  postValues,
  requirePost,
  requireView,
} from "./shared";

type ProfileRow = {
  id: number;
  username: string;
  group_title: string;
  created_at: number;
  about: string;
  post_count: number;
  reaction_score: number;
};
export const profilesGetOp = implement(profilesGet, (ctx, actor, input) => {
  const flags = requireView(ctx, actor);
  const row = prepared(ctx, "profiles.profile", () =>
    ctx.sqlite.prepare<ProfileRow, [number]>(
      "SELECT u.id, u.username, g.title AS group_title, u.created_at, u.about, u.post_count, u.reaction_score FROM users u JOIN groups g ON g.id = u.group_id WHERE u.id = ?1",
    ),
  ).get(input.userId);
  if (!row) throw new NotFoundError();
  return {
    id: row.id,
    username: row.username,
    groupTitle: row.group_title,
    createdAt: iso(row.created_at),
    about: row.about,
    postCount: row.post_count,
    reactionScore: row.reaction_score,
    canPostOnWall: actorUserId(actor) !== null && flags.canPostProfile,
  };
});
export const profilesUpdateOp = implement(profilesUpdate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireView(ctx, actor);
  writeTx(ctx, () =>
    ctx.sqlite.prepare("UPDATE users SET about = ?1 WHERE id = ?2").run(input.about, user.userId),
  );
  return profilesGetOp.run(ctx, actor, { userId: user.userId });
});
export const usersSearchOp = implement(usersSearch, (ctx, actor, input) => {
  requireView(ctx, actor);
  const prefix = input.prefix.toLowerCase();
  const items = prepared(ctx, "profiles.userSearch", () =>
    ctx.sqlite.prepare<{ id: number; username: string }, [string, string, number]>(
      "SELECT id, username FROM users WHERE username_key >= ?1 AND username_key < ?2 ORDER BY username_key LIMIT ?3",
    ),
  ).all(prefix, `${prefix}\uffff`, input.limit);
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
    ctx.sqlite.prepare<PostRow, [number, number, number, number, number]>(
      "SELECT * FROM profile_posts WHERE profile_user_id = ?1 AND id < ?2 " +
        "AND (state = 'visible' OR ?3 = 1 OR (state = 'moderated' AND user_id = ?4)) ORDER BY id DESC LIMIT ?5",
    ),
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
    if (!ctx.sqlite.prepare("SELECT id FROM users WHERE id = ?1").get(input.userId))
      throw new NotFoundError();
    return ctx.sqlite
      .prepare<PostRow, [number, number, number, string, string]>(
        "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *",
      )
      .get(input.userId, user.userId, ctx.now(), input.body, html)!;
  });
  return { ...postValue(ctx, actor, row), bodySource: row.body_source };
});
export const profilePostsUpdateOp = implement(profilePostsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (row.user_id !== actorUserId(actor) && !getGlobalPermissions(ctx, actor).isModerator)
    throw new ForbiddenError();
  const html = renderMarkdown(input.body);
  writeTx(ctx, () =>
    ctx.sqlite
      .prepare(
        "UPDATE profile_posts SET body_source = ?1, body_html = ?2, edited_at = ?3 WHERE id = ?4",
      )
      .run(input.body, html, ctx.now(), row.id),
  );
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
  writeTx(ctx, () =>
    ctx.sqlite.prepare("UPDATE profile_posts SET state = 'deleted' WHERE id = ?1").run(row.id),
  );
  return postValue(ctx, actor, { ...row, state: "deleted" });
});
export const profilePostsRestoreOp = implement(profilePostsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (!getGlobalPermissions(ctx, actor).isModerator) throw new ForbiddenError();
  writeTx(ctx, () =>
    ctx.sqlite.prepare("UPDATE profile_posts SET state = 'visible' WHERE id = ?1").run(row.id),
  );
  return postValue(ctx, actor, { ...row, state: "visible" });
});
