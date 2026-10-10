import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { reactionsListOp } from "../reactions";
import { seoForProfile, sitemapEntries } from "../seo";
import { updateSiteSettings } from "../settings";
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
  profilePostsGetOp,
  profilePostsListOp,
  profilePostsRestoreOp,
  profilePostsUpdateOp,
  profilesGetOp,
  reactableProfileComment,
  reactableProfilePost,
} from "./index";

describe("profile privacy", () => {
  test("view modes cover guests, members, followed members, self and moderator bypass", async () => {
    const ctx = createTestContext();
    const wall = insertUser(ctx);
    const followed = insertUser(ctx);
    const stranger = insertUser(ctx);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const post = await execute(ctx, profilePostsCreateOp, userActor(wall), {
      userId: wall.id,
      body: "Hello",
    });
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)")
      .run(wall.id, followed.id, ctx.now());
    const profile = (actor: typeof GUEST | ReturnType<typeof userActor>) =>
      execute(ctx, profilesGetOp, actor, { userId: wall.id });
    expect((await profile(GUEST)).id).toBe(wall.id);
    for (const mode of ["members", "followed", "self"] as const) {
      ctx.sqlite
        .prepare("UPDATE users SET profile_view_privacy = ?1 WHERE id = ?2")
        .run(mode, wall.id);
      await expect(profile(GUEST)).rejects.toBeInstanceOf(NotFoundError);
      expect((await profile(userActor(wall))).id).toBe(wall.id);
      expect((await profile(moderator)).id).toBe(wall.id);
      if (mode === "members") expect((await profile(userActor(stranger))).id).toBe(wall.id);
      else await expect(profile(userActor(stranger))).rejects.toBeInstanceOf(NotFoundError);
      if (mode !== "self") expect((await profile(userActor(followed))).id).toBe(wall.id);
      else await expect(profile(userActor(followed))).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        execute(ctx, profilePostsListOp, GUEST, { userId: wall.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        execute(ctx, profilePostsGetOp, GUEST, { profilePostId: post.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(() => seoForProfile(ctx, GUEST, wall.id)).toThrow(NotFoundError);
      expect(
        [...sitemapEntries(ctx, "https://example.test", "profile")].map((entry) => entry.id),
      ).not.toContain(wall.id);
    }
    expectNoTableScan(
      ctx,
      "SELECT profile_view_privacy, profile_post_privacy, EXISTS(SELECT 1 FROM user_follows WHERE user_id = ?1 AND followed_id = ?2) AS follows FROM users WHERE id = ?1",
      [wall.id, followed.id],
    );
    expectNoTableScan(ctx, "SELECT id FROM user_follows WHERE user_id = ?1 AND followed_id = ?2", [
      wall.id,
      followed.id,
    ]);
  });

  test("post modes, owner ignores and the site toggle control writes and response flags", async () => {
    const ctx = createTestContext();
    const wall = insertUser(ctx);
    const followed = insertUser(ctx);
    const stranger = insertUser(ctx);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)")
      .run(wall.id, followed.id, ctx.now());
    const create = (user: typeof wall) =>
      execute(ctx, profilePostsCreateOp, userActor(user), { userId: wall.id, body: "Hello" });
    expect((await create(stranger)).id).toBeGreaterThan(0);
    ctx.sqlite
      .prepare("UPDATE users SET profile_post_privacy = 'followed' WHERE id = ?1")
      .run(wall.id);
    await expect(create(stranger)).rejects.toBeInstanceOf(ForbiddenError);
    const post = await create(followed);
    await expect(
      execute(ctx, profileCommentsCreateOp, userActor(stranger), {
        profilePostId: post.id,
        body: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    ctx.sqlite.prepare("UPDATE users SET profile_post_privacy = 'self' WHERE id = ?1").run(wall.id);
    await expect(create(followed)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await create(wall)).id).toBeGreaterThan(0);
    expect(
      (await execute(ctx, profilePostsCreateOp, admin, { userId: wall.id, body: "Bypass" })).id,
    ).toBeGreaterThan(0);
    ctx.sqlite
      .prepare("UPDATE users SET profile_post_privacy = 'members' WHERE id = ?1")
      .run(wall.id);
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)")
      .run(wall.id, stranger.id, ctx.now());
    await expect(create(stranger)).rejects.toBeInstanceOf(ForbiddenError);
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)")
      .run(wall.id, admin.kind === "guest" ? 0 : admin.userId, ctx.now());
    // Staff cannot be ignored (member.ignorable is never for them), so the ignore does not apply.
    expect(
      (await execute(ctx, profilePostsCreateOp, admin, { userId: wall.id, body: "Ignored" })).id,
    ).toBeGreaterThan(0);
    expect((await create(followed)).id).toBeGreaterThan(0);
    updateSiteSettings(ctx, admin, { profilePostsEnabled: false });
    expect(
      (await execute(ctx, profilesGetOp, userActor(followed), { userId: wall.id })).canPostOnWall,
    ).toBe(false);
    expect(
      (await execute(ctx, profilePostsGetOp, userActor(followed), { profilePostId: post.id }))
        .canComment,
    ).toBe(false);
    await expect(create(wall)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, profileCommentsCreateOp, userActor(followed), {
        profilePostId: post.id,
        body: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, profilePostsGetOp, GUEST, { profilePostId: 999999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expectNoTableScan(ctx, "SELECT id FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2", [
      wall.id,
      stranger.id,
    ]);
  });

  test("private walls hide content and new writes while authors retain access to their own content", async () => {
    const ctx = createTestContext();
    const wall = insertUser(ctx);
    const author = insertUser(ctx);
    const outsider = insertUser(ctx);
    const wallPost = await execute(ctx, profilePostsCreateOp, userActor(wall), {
      userId: wall.id,
      body: "Wall post",
    });
    const ownPost = await execute(ctx, profilePostsCreateOp, userActor(author), {
      userId: wall.id,
      body: "My post",
    });
    const ownComment = await execute(ctx, profileCommentsCreateOp, userActor(author), {
      profilePostId: wallPost.id,
      body: "My comment",
    });
    ctx.sqlite.prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1").run(wall.id);
    await expect(
      execute(ctx, profilePostsCreateOp, userActor(author), { userId: wall.id, body: "New" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const actor of [userActor(author), userActor(outsider)]) {
      await expect(
        execute(ctx, profilePostsGetOp, actor, { profilePostId: wallPost.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        execute(ctx, profileCommentsListOp, actor, { profilePostId: wallPost.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(
      execute(ctx, profilePostsGetOp, userActor(outsider), { profilePostId: ownPost.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      execute(ctx, profileCommentsGetOp, userActor(outsider), { commentId: ownComment.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await execute(ctx, profilePostsGetOp, userActor(author), { profilePostId: ownPost.id })).id,
    ).toBe(ownPost.id);
    expect(
      (await execute(ctx, profileCommentsGetOp, userActor(author), { commentId: ownComment.id }))
        .id,
    ).toBe(ownComment.id);
    expect(() => reactableProfilePost(ctx, userActor(outsider), ownPost.id)).toThrow(NotFoundError);
    expect(() => reactableProfileComment(ctx, userActor(outsider), ownComment.id)).toThrow(
      NotFoundError,
    );
    await expect(
      execute(ctx, reactionsListOp, userActor(outsider), {
        contentType: "profile_post",
        contentId: ownPost.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      execute(ctx, reactionsListOp, userActor(outsider), {
        contentType: "profile_post_comment",
        contentId: ownComment.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (
        await execute(ctx, reactionsListOp, userActor(author), {
          contentType: "profile_post",
          contentId: ownPost.id,
        })
      ).items,
    ).toEqual([]);
    const fileId = Number(
      ctx.sqlite
        .prepare<{ id: number }, [number, number]>(
          "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('test', 'private-wall', 1, 'image/png', 'hash', ?1, 'attachment', 'public', ?2) RETURNING id",
        )
        .get(author.id, ctx.now())!.id,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO attachments (file_id, content_type, content_id, position, created_at) VALUES (?1, 'profile_post', ?2, 0, ?3)",
      )
      .run(fileId, ownPost.id, ctx.now());
    expect(() => getFileRecord(ctx, userActor(outsider), fileId)).toThrow(NotFoundError);
    expect(getFileRecord(ctx, userActor(author), fileId).id).toBe(fileId);
    await execute(ctx, profilePostsUpdateOp, userActor(author), {
      profilePostId: ownPost.id,
      body: "Edited",
    });
    await execute(ctx, profileCommentsUpdateOp, userActor(author), {
      commentId: ownComment.id,
      body: "Edited",
    });
    await execute(ctx, profileCommentsDeleteOp, userActor(author), { commentId: ownComment.id });
    await execute(ctx, profilePostsDeleteOp, userActor(author), { profilePostId: ownPost.id });
  });
});

test("profile moderation uses content events with notice details and own deletes add no moderation event", async () => {
  const ctx = createTestContext();
  const author = insertUser(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const post = await execute(ctx, profilePostsCreateOp, userActor(author), {
    userId: author.id,
    body: "Before",
  });
  const comment = await execute(ctx, profileCommentsCreateOp, userActor(author), {
    profilePostId: post.id,
    body: "Before",
  });
  const notice = { notify: false, message: "Moderated", reason: "Rule" };
  const latest = (type: string) =>
    JSON.parse(
      ctx.sqlite
        .prepare<{ payload: string }, [string]>(
          "SELECT payload FROM domain_events WHERE type = ?1 ORDER BY id DESC LIMIT 1",
        )
        .get(type)!.payload,
    );
  await execute(ctx, profilePostsUpdateOp, admin, {
    profilePostId: post.id,
    body: "Changed",
    ...notice,
  });
  expect(latest("content.edited")).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, profileCommentsUpdateOp, admin, {
    commentId: comment.id,
    body: "Changed",
    ...notice,
  });
  expect(latest("content.edited")).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, profileCommentsDeleteOp, admin, { commentId: comment.id, ...notice });
  expect(latest("content.deleted")).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, profileCommentsRestoreOp, admin, { commentId: comment.id, ...notice });
  expect(latest("content.state_changed")).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, profilePostsDeleteOp, admin, { profilePostId: post.id, ...notice });
  expect(latest("content.deleted")).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  await execute(ctx, profilePostsRestoreOp, admin, { profilePostId: post.id, ...notice });
  expect(latest("content.state_changed")).toMatchObject({
    notify: false,
    message: notice.message,
    reason: notice.reason,
  });
  const own = await execute(ctx, profilePostsCreateOp, userActor(author), {
    userId: author.id,
    body: "Own",
  });
  const before = ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM domain_events WHERE type = 'moderation.action'",
    )
    .get()!.n;
  await execute(ctx, profilePostsDeleteOp, userActor(author), { profilePostId: own.id });
  expect(
    ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM domain_events WHERE type = 'moderation.action'",
      )
      .get()!.n,
  ).toBe(before);
  expect(latest("content.deleted")).not.toHaveProperty("notify");
});
