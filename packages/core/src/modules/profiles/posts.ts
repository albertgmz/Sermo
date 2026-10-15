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
  profilesSelf,
  profilesUpdate,
  usersSearch,
} from "../../contracts/profiles";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentActor,
  memberActor,
  memberDisplay,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  requestVersions,
  requirePermission,
} from "../../permissions";
import { storeContentReferences, storeSpoilers } from "../../render";
import { iso } from "../../time";
import { setAttachments, validateEmbeddedAttachments } from "../attachments";
import { loadMemberDetails } from "../members/cards";
import {
  appendModeratorLog,
  moderateEditedContent,
  prepareModeratedContent,
  renderModeratedContent,
  requireWriteRoom,
  withSpamCheck,
} from "../moderation";
import { noticeForOther } from "../moderation/notify";
import { logIp } from "../security/log";
import { profileSeo } from "../seo/pages";
import { readSiteSettings } from "../settings";
import { resolvedFileUrl } from "../storage/url";
import { profileFieldChanges, storeProfileChanges } from "./fields";
import {
  latestComments,
  mayDeleteWallContent,
  mayEditWallContent,
  mayPostOnWall,
  type PostRow,
  type ProfileAccess,
  postValue,
  postValues,
  profileAccess,
  requirePost,
  requireProfileView,
  requireView,
  touchProfile,
  WALL_SQL,
} from "./shared";

type ProfileRow = PrincipalRow & {
  id: number;
  username: string;
  group_id: number;
  group_title: string;
  about: string;
  avatar_file_id: number | null;
  custom_title: string | null;
  signature_source: string | null;
  location: string;
  website: string;
  birthday_md: string | null;
  birth_year: number | null;
  social_discord: string;
  social_telegram: string;
  social_x: string;
  follower_count: number;
  following_count: number;
  credits: number;
  referral_count: number;
  last_activity_at: number | null;
};
function displayGroupOf(ctx: Ctx, viewer: Actor, row: ProfileRow) {
  const display = memberDisplay(
    ctx,
    memberActor(row.id, row.group_id, row, requestVersions(ctx, viewer)),
  );
  return (
    display && {
      id: display.groupId,
      title: display.title,
      userTitle: display.userTitle,
      badge: display.badge,
    }
  );
}
export const PROFILE_SQL = `SELECT u.id, u.username, u.group_id, g.title AS group_title, u.about, u.avatar_file_id, u.custom_title, u.signature_source, u.location, u.website, u.birthday_md, u.birth_year, u.social_discord, u.social_telegram, u.social_x, u.follower_count, u.following_count, u.credits, u.referral_count, u.last_activity_at, ${PRINCIPAL_COLUMNS} FROM users u JOIN groups g ON g.id = u.group_id WHERE u.id = ?1`;
const MINUTE_MS = 60_000;
function readProfileRow(ctx: Ctx, userId: number): ProfileRow {
  const row = prepared(ctx, "profiles.profile", () =>
    ctx.sqlite.prepare<ProfileRow, [number]>(PROFILE_SQL),
  ).get(userId);
  if (!row) throw new NotFoundError();
  return row;
}
function profileValue(ctx: Ctx, actor: Actor, row: ProfileRow, access?: ProfileAccess) {
  const permissions = permissionsOf(ctx, actor);
  const viewerId = actorUserId(actor);
  const details = loadMemberDetails(ctx, actor, [row.id], { awards: false });
  const author = details.authors.get(row.id)!;
  const lookup = (key: string, sql: string) =>
    viewerId !== null &&
    viewerId !== row.id &&
    !!prepared(ctx, key, () => ctx.sqlite.prepare<{ 1: number }, [number, number]>(sql)).get(
      viewerId,
      row.id,
    );
  const seen = Math.max(row.last_activity_at ?? 0, ctx.activity.get(row.id) ?? 0);
  const [month, day] = row.birthday_md?.split("-").map(Number) ?? [];
  return {
    id: row.id,
    username: row.username,
    groupTitle: row.group_title,
    displayGroup: displayGroupOf(ctx, actor, row),
    createdAt: author.createdAt,
    about: row.about,
    avatar:
      row.avatar_file_id === null
        ? null
        : { fileId: row.avatar_file_id, url: resolvedFileUrl(ctx, row.avatar_file_id, true) },
    cover: author.cover,
    postCount: author.postCount,
    reactionScore: author.reactionScore,
    canPostOnWall: permissions.can("profile.view") && mayPostOnWall(ctx, actor, row.id, access),
    card: author.card,
    customTitle: details.mayShowTitle.get(row.id) ? row.custom_title : null,
    signatureHtml: author.signatureHtml,
    location: row.location,
    website: row.website,
    birthday: month && day ? { month, day } : null,
    socials: { discord: row.social_discord, telegram: row.social_telegram, x: row.social_x },
    followerCount: row.follower_count,
    followingCount: row.following_count,
    credits: row.credits,
    awardXp: author.awardXp,
    level: {
      level: author.card.level,
      currentLevelXp: author.currentLevelXp,
      nextLevelXp: author.nextLevelXp,
    },
    awardSlots: details.awardSlots.get(row.id)!,
    referralCount: row.referral_count,
    lastActivityAt: seen > 0 ? iso(seen - (seen % MINUTE_MS)) : null,
    viewer: {
      isFollowing: lookup(
        "profiles.viewerFollows",
        "SELECT 1 FROM user_follows WHERE user_id = ?1 AND followed_id = ?2",
      ),
      isIgnoring: lookup(
        "profiles.viewerIgnores",
        "SELECT 1 FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2",
      ),
    },
  };
}
function readProfile(ctx: Ctx, actor: Actor, userId: number, access?: ProfileAccess) {
  return profileValue(ctx, actor, readProfileRow(ctx, userId), access);
}
export const profilesGetOp = implement(profilesGet, (ctx, actor, input) => {
  const access = profileAccess(ctx, actor, input.userId);
  requireProfileView(ctx, actor, input.userId, access);
  const settings = readSiteSettings(ctx);
  const seo = profileSeo(
    ctx,
    actor,
    ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000",
    input.userId,
    "",
    {
      siteName: settings.siteName,
      nodeTitle: settings.nodeTitleTemplate,
      threadTitle: settings.threadTitleTemplate,
      profileTitle: settings.profileTitleTemplate,
    },
    access,
  );
  return {
    ...readProfile(ctx, actor, input.userId, access),
    seo,
  };
});

export const profilesUpdateOp = implement(profilesUpdate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  const { changes, settingTitle, settingSignature } = profileFieldChanges(ctx, input, {
    customTitle: () => requirePermission(ctx, actor, "profile.customTitle"),
    signature: () => requirePermission(ctx, actor, "profile.signature"),
  });
  if (Object.keys(changes).length > 0)
    writeTx(ctx, () => {
      // The actor may have lost a permission, or been banned, since the request began.
      const current = currentActor(ctx, actor);
      requirePermission(ctx, current, "profile.editOwn");
      if (settingTitle) requirePermission(ctx, current, "profile.customTitle");
      if (settingSignature) requirePermission(ctx, current, "profile.signature");
      storeProfileChanges(ctx, user.userId, changes);
    });
  return readProfile(ctx, actor, user.userId);
});

export const profilesSelfOp = implement(profilesSelf, (ctx, actor) => {
  const user = requireAuthenticated(actor);
  const row = readProfileRow(ctx, user.userId);
  const settings = readSiteSettings(ctx);
  return {
    profile: profileValue(ctx, actor, row),
    customTitle: row.custom_title,
    signatureSource: row.signature_source,
    birthYear: row.birth_year,
    may: {
      setSignature: can(ctx, actor, "profile.signature"),
      setCustomTitle: can(ctx, actor, "profile.customTitle"),
    },
    limits: {
      signatureMaxLength: settings.signatureMaxLength,
      signatureMaxLines: settings.signatureMaxLines,
      customTitleMaxLength: settings.customTitleMaxLength,
    },
  };
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
  requireProfileView(ctx, actor, input.userId);
  if (
    !prepared(ctx, "profiles.userExists", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1"),
    ).get(input.userId)
  )
    throw new NotFoundError();
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const permissions = permissionsOf(ctx, actor);
  const rows = prepared(ctx, "profiles.wall", () =>
    ctx.sqlite.prepare<PostRow, [number, number, number, number, number, number]>(WALL_SQL),
  ).all(
    input.userId,
    cursor,
    Number(permissions.can("profilePost.viewModerated")),
    Number(permissions.can("profilePost.viewDeleted")),
    actorUserId(actor) ?? 0,
    input.limit + 1,
  );
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
  requireProfileView(ctx, actor, input.userId);
  requirePermission(ctx, actor, "profilePost.post");
  if (!mayPostOnWall(ctx, actor, input.userId)) throw new ForbiddenError();
  return withSpamCheck(ctx, actor, input.body, "forum-post", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, false);
    const refs = renderModeratedContent(ctx, actor, content);
    const html = refs.html;
    const row = writeTx(ctx, () => {
      const decision = prepareModeratedContent(ctx, actor, input.body, false);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      requireWriteRoom(ctx, actor, "wall_post", decision.floodSeconds);
      if (
        !prepared(ctx, "profiles.userExists", () =>
          ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1"),
        ).get(input.userId)
      )
        throw new NotFoundError();
      requireProfileView(ctx, actor, input.userId);
      if (!mayPostOnWall(ctx, actor, input.userId)) throw new ForbiddenError();
      const post = prepared(ctx, "profiles.insertPost", () =>
        ctx.sqlite.prepare<PostRow, [number, number, string, number, string, string]>(
          "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *",
        ),
      ).get(
        input.userId,
        user.userId,
        decision.moderated || spam ? "moderated" : "visible",
        ctx.now(),
        refs.source,
        html,
      )!;
      storeContentReferences(ctx, "profile_post", post.id, refs);
      storeSpoilers(ctx, "profile_post", post.id, refs.spoilers);
      setAttachments(ctx, user.userId, "profile_post", post.id, input.attachmentIds ?? []);
      validateEmbeddedAttachments(ctx, "profile_post", post.id, html);
      post.attachment_count = input.attachmentIds?.length ?? 0;
      if (post.state === "visible") touchProfile(ctx, input.userId);
      logIp(ctx, actor, "profile_post", { type: "profile_post", id: post.id });
      publishEvent(ctx, { type: "content.created", targetType: "profile_post", targetId: post.id });
      return post;
    });
    return { ...postValues(ctx, actor, [row])[0]!, bodySource: row.body_source };
  });
});
export const profilePostsUpdateOp = implement(profilePostsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (!mayEditWallContent(ctx, actor, row.user_id)) throw new ForbiddenError();
  const content = prepareModeratedContent(ctx, actor, input.body, false);
  const refs = renderModeratedContent(ctx, actor, content, {
    edit: { contentType: "profile_post", contentId: row.id, authorId: row.user_id },
  });
  const html = refs.html;
  writeTx(ctx, () => {
    const fresh = currentActor(ctx, actor);
    const now = requirePost(ctx, fresh, row.id);
    if (!mayEditWallContent(ctx, fresh, row.user_id)) throw new ForbiddenError();
    const decision = prepareModeratedContent(ctx, actor, input.body, false);
    if (decision.source !== content.source)
      throw new ConflictError("Moderation rules changed; retry.");
    setAttachments(ctx, actorUserId(actor)!, "profile_post", row.id, input.attachmentIds);
    validateEmbeddedAttachments(ctx, "profile_post", row.id, html);
    prepared(ctx, "profiles.updatePost", () =>
      ctx.sqlite.prepare<unknown, [string, string, number, number]>(
        "UPDATE profile_posts SET body_source = ?1, body_html = ?2, edited_at = ?3 WHERE id = ?4",
      ),
    ).run(refs.source, html, ctx.now(), row.id);
    const { newlyMentioned } = storeContentReferences(ctx, "profile_post", row.id, refs);
    storeSpoilers(ctx, "profile_post", row.id, refs.spoilers);
    if (decision.moderated) moderateEditedContent(ctx, fresh, { type: "profile_post", id: row.id });
    if (now.state === "visible") touchProfile(ctx, row.profile_user_id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "profile_post",
      targetId: row.id,
      payload: { ...noticeForOther(actor, row.user_id, input), newlyMentioned },
    });
    if (can(ctx, fresh, "profilePost.editAny"))
      appendModeratorLog(ctx, actor, "profile_post.edit", "profile_post", row.id);
  });
  return profilePostsGetOp.run(ctx, actor, input);
});
export const profilePostsDeleteOp = implement(profilePostsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  if (!mayDeleteWallContent(ctx, actor, row.user_id, row.profile_user_id))
    throw new ForbiddenError();
  writeTx(ctx, () => {
    const fresh = currentActor(ctx, actor);
    const now = requirePost(ctx, fresh, row.id);
    if (!mayDeleteWallContent(ctx, fresh, row.user_id, row.profile_user_id))
      throw new ForbiddenError();
    const result = prepared(ctx, "profiles.deletePost", () =>
      ctx.sqlite.prepare<unknown, [number]>(
        "UPDATE profile_posts SET state = 'deleted' WHERE id = ?1 AND state != 'deleted'",
      ),
    ).run(row.id);
    if (result.changes)
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "profile_post",
        targetId: row.id,
        payload: {
          previousState: now.state,
          state: "deleted",
          ...noticeForOther(actor, row.user_id, input),
        },
      });
    if (result.changes && now.state === "visible") touchProfile(ctx, row.profile_user_id);
    if (can(ctx, fresh, "profilePost.deleteAny"))
      appendModeratorLog(ctx, actor, "profile_post.delete", "profile_post", row.id);
  });
  return postValue(ctx, actor, { ...row, state: "deleted" });
});
export const profilePostsRestoreOp = implement(profilePostsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const row = requirePost(ctx, actor, input.profilePostId);
  writeTx(ctx, () => {
    const fresh = currentActor(ctx, actor);
    requirePost(ctx, fresh, row.id);
    const current = prepared(ctx, "profiles.postState", () =>
      ctx.sqlite.prepare<{ state: PostRow["state"] }, [number]>(
        "SELECT state FROM profile_posts WHERE id = ?1",
      ),
    ).get(row.id);
    if (!current) throw new NotFoundError();
    if (current.state === "deleted") requirePermission(ctx, fresh, "profilePost.undelete");
    else requirePermission(ctx, fresh, "profilePost.approve");
    const result = prepared(ctx, "profiles.restorePost", () =>
      ctx.sqlite.prepare<unknown, [number, string]>(
        "UPDATE profile_posts SET state = 'visible' WHERE id = ?1 AND state = ?2",
      ),
    ).run(row.id, current.state);
    if (result.changes)
      publishEvent(ctx, {
        type: "content.state_changed",
        targetType: "profile_post",
        targetId: row.id,
        payload: {
          ...noticeForOther(actor, row.user_id, input),
          previousState: current.state,
          state: "visible",
        },
      });
    if (result.changes) touchProfile(ctx, row.profile_user_id);
    appendModeratorLog(ctx, actor, "profile_post.restore", "profile_post", row.id);
  });
  return postValue(ctx, actor, { ...row, state: "visible" });
});
