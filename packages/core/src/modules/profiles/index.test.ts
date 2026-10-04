import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import {
  operations,
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
  profilesUpdateOp,
  reactableProfileComment,
  reactableProfilePost,
  usersSearchOp,
} from "./index";

function fixture() {
  const ctx = createTestContext();
  const wall = insertUser(ctx, { username: "Wall" });
  const author = insertUser(ctx, { username: "Author" });
  const stranger = insertUser(ctx, { username: "Stranger" });
  const moderator = insertUser(ctx, { username: "Mod", groupId: 3 });
  const admin = insertUser(ctx, { username: "Admin", groupId: 4 });
  return {
    ctx,
    wall,
    author,
    stranger,
    moderator,
    admin,
    wallActor: userActor(wall),
    authorActor: userActor(author),
    strangerActor: userActor(stranger),
    modActor: userActor(moderator),
    adminActor: userActor(admin),
  };
}
function recount(ctx: ReturnType<typeof createTestContext>, id: number) {
  const row = ctx.sqlite
    .prepare<{ comment_count: number; last_comment_at: number | null }, [number]>(
      "SELECT comment_count, last_comment_at FROM profile_posts WHERE id = ?1",
    )
    .get(id)!;
  const actual = ctx.sqlite
    .prepare<{ count: number; last_at: number | null }, [number]>(
      "SELECT count(*) AS count, max(created_at) AS last_at FROM profile_post_comments WHERE profile_post_id = ?1 AND state = 'visible'",
    )
    .get(id)!;
  expect(row.comment_count).toBe(actual.count);
  expect(row.last_comment_at).toBe(actual.last_at);
}

describe("profiles", () => {
  test("all contracts are registered", () => {
    expect(operations.map((op) => op.name).sort()).toEqual(
      [
        "profiles.get",
        "profiles.update",
        "users.search",
        "profilePosts.list",
        "profilePosts.get",
        "profilePosts.create",
        "profilePosts.update",
        "profilePosts.delete",
        "profilePosts.restore",
        "profileComments.list",
        "profileComments.get",
        "profileComments.create",
        "profileComments.update",
        "profileComments.delete",
        "profileComments.restore",
      ].sort(),
    );
  });
  test("profile get, update, visibility, and prefix search", async () => {
    const f = fixture();
    expect((await execute(f.ctx, profilesGetOp, GUEST, { userId: f.wall.id })).canPostOnWall).toBe(
      false,
    );
    expect(
      (await execute(f.ctx, profilesGetOp, f.authorActor, { userId: f.wall.id })).canPostOnWall,
    ).toBe(true);
    const updated = await execute(f.ctx, profilesUpdateOp, tokenActor(f.author), {
      about: "<plain>",
    });
    expect(updated.about).toBe("<plain>");
    expect(
      (await execute(f.ctx, profilesGetOp, f.authorActor, { userId: f.author.id })).about,
    ).toBe("<plain>");
    await expect(execute(f.ctx, profilesUpdateOp, GUEST, { about: "x" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(execute(f.ctx, profilesGetOp, GUEST, { userId: 999999 })).rejects.toThrow(
      NotFoundError,
    );
    insertUser(f.ctx, { username: "Éclair" });
    insertUser(f.ctx, { username: "école" });
    insertUser(f.ctx, { username: "Eagle" });
    expect(
      (await execute(f.ctx, usersSearchOp, GUEST, { prefix: "É" })).items.map((u) => u.username),
    ).toEqual(["Éclair", "école"]);
    expect(
      (await execute(f.ctx, usersSearchOp, GUEST, { prefix: "a" })).items.map((u) => u.username),
    ).toEqual(["Admin", "Author"]);
    expect(
      (await execute(f.ctx, usersSearchOp, GUEST, { prefix: "a", limit: 1 })).items,
    ).toHaveLength(1);
    f.ctx.sqlite.run("UPDATE groups SET can_view_profiles = 0 WHERE id = 2");
    invalidate(f.ctx, "permissions");
    await expect(
      execute(f.ctx, profilesUpdateOp, f.authorActor, { about: "blocked" }),
    ).rejects.toThrow(ForbiddenError);
    expect((await execute(f.ctx, profilesGetOp, f.adminActor, { userId: f.author.id })).about).toBe(
      "<plain>",
    );
    await expect(
      execute(f.ctx, profilePostsListOp, f.authorActor, { userId: f.wall.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(execute(f.ctx, usersSearchOp, f.authorActor, { prefix: "a" })).rejects.toThrow(
      ForbiddenError,
    );
    f.ctx.sqlite.run("UPDATE groups SET can_view_profiles = 0 WHERE id = 1");
    invalidate(f.ctx, "permissions");
    await expect(execute(f.ctx, profilesGetOp, GUEST, { userId: f.wall.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(execute(f.ctx, usersSearchOp, GUEST, { prefix: "a" })).rejects.toThrow(
      ForbiddenError,
    );
  });
  test("post ownership, moderation, hidden states, and wall paging", async () => {
    const f = fixture();
    await expect(
      execute(f.ctx, profilePostsCreateOp, GUEST, { userId: f.wall.id, body: "x" }),
    ).rejects.toThrow(UnauthenticatedError);
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const post = await execute(f.ctx, profilePostsCreateOp, f.authorActor, {
        userId: f.wall.id,
        body: `**post ${i}**`,
      });
      ids.push(post.id);
      expect(post.canEdit).toBe(true);
      expect(post.canDelete).toBe(true);
      expect(post.bodyHtml).toContain("<strong>");
    }
    const first = await execute(f.ctx, profilePostsListOp, GUEST, { userId: f.wall.id, limit: 2 });
    const second = await execute(f.ctx, profilePostsListOp, GUEST, {
      userId: f.wall.id,
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await execute(f.ctx, profilePostsListOp, GUEST, {
      userId: f.wall.id,
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect([...first.items, ...second.items, ...third.items].map((p) => p.id)).toEqual(
      ids.toReversed(),
    );
    expect(third.nextCursor).toBeNull();
    const id = ids[0]!;
    await expect(
      execute(f.ctx, profilePostsUpdateOp, f.wallActor, { profilePostId: id, body: "no" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, profilePostsDeleteOp, f.strangerActor, { profilePostId: id }),
    ).rejects.toThrow(ForbiddenError);
    expect(
      (
        await execute(f.ctx, profilePostsUpdateOp, f.modActor, {
          profilePostId: id,
          body: "edited",
        })
      ).bodySource,
    ).toBe("edited");
    expect(
      (await execute(f.ctx, profilePostsDeleteOp, f.wallActor, { profilePostId: id })).state,
    ).toBe("deleted");
    await expect(
      execute(f.ctx, profilePostsGetOp, f.authorActor, { profilePostId: id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, profilePostsRestoreOp, f.authorActor, { profilePostId: id }),
    ).rejects.toThrow(NotFoundError);
    expect((await execute(f.ctx, profilePostsGetOp, f.modActor, { profilePostId: id })).state).toBe(
      "deleted",
    );
    expect(
      (await execute(f.ctx, profilePostsRestoreOp, f.adminActor, { profilePostId: id })).state,
    ).toBe("visible");
    f.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'moderated' WHERE id = ?1").run(id);
    expect(
      (await execute(f.ctx, profilePostsGetOp, f.authorActor, { profilePostId: id })).state,
    ).toBe("moderated");
    await expect(
      execute(f.ctx, profilePostsGetOp, f.wallActor, { profilePostId: id }),
    ).rejects.toThrow(NotFoundError);
    expect(reactableProfilePost(f.ctx, f.authorActor, id)).toEqual({
      authorId: f.author.id,
      isVisible: false,
    });
    expect(
      (await execute(f.ctx, profilePostsRestoreOp, f.modActor, { profilePostId: id })).state,
    ).toBe("visible");
    expect(
      (await execute(f.ctx, profilePostsGetOp, f.wallActor, { profilePostId: id })).canDelete,
    ).toBe(true);
    expect(
      (await execute(f.ctx, profilePostsGetOp, f.strangerActor, { profilePostId: id })).canDelete,
    ).toBe(false);
    await expect(execute(f.ctx, profilePostsListOp, GUEST, { userId: 999999 })).rejects.toThrow(
      NotFoundError,
    );
    f.ctx.sqlite.run("UPDATE groups SET can_post_profile = 0 WHERE id = 2");
    invalidate(f.ctx, "permissions");
    await expect(
      execute(f.ctx, profilePostsCreateOp, f.authorActor, { userId: f.wall.id, body: "no" }),
    ).rejects.toThrow(ForbiddenError);
  });
  test("comments enforce visibility and ownership; counters survive all writes", async () => {
    const f = fixture();
    const post = await execute(f.ctx, profilePostsCreateOp, f.authorActor, {
      userId: f.wall.id,
      body: "post",
    });
    await expect(
      execute(f.ctx, profileCommentsCreateOp, GUEST, { profilePostId: post.id, body: "x" }),
    ).rejects.toThrow(UnauthenticatedError);
    const comments = [];
    for (let i = 0; i < 5; i++) {
      f.ctx.clock.advance(1000);
      comments.push(
        await execute(f.ctx, profileCommentsCreateOp, f.strangerActor, {
          profilePostId: post.id,
          body: `c${i}`,
        }),
      );
      recount(f.ctx, post.id);
    }
    const page = await execute(f.ctx, profileCommentsListOp, GUEST, {
      profilePostId: post.id,
      limit: 2,
    });
    const next = await execute(f.ctx, profileCommentsListOp, GUEST, {
      profilePostId: post.id,
      limit: 2,
      cursor: page.nextCursor!,
    });
    const last = await execute(f.ctx, profileCommentsListOp, GUEST, {
      profilePostId: post.id,
      limit: 2,
      cursor: next.nextCursor!,
    });
    expect([...page.items, ...next.items, ...last.items].map((c) => c.id)).toEqual(
      comments.map((c) => c.id).toReversed(),
    );
    expect(
      (
        await execute(f.ctx, profilePostsGetOp, GUEST, { profilePostId: post.id })
      ).latestComments.map((c) => c.id),
    ).toEqual(comments.slice(2).map((c) => c.id));
    expect(
      (await execute(f.ctx, profileCommentsGetOp, f.wallActor, { commentId: comments[1]!.id }))
        .canDelete,
    ).toBe(true);
    expect(
      (await execute(f.ctx, profileCommentsGetOp, GUEST, { commentId: comments[1]!.id })).canDelete,
    ).toBe(false);
    const id = comments[0]!.id;
    await expect(
      execute(f.ctx, profileCommentsUpdateOp, f.wallActor, { commentId: id, body: "no" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, profileCommentsDeleteOp, f.authorActor, { commentId: id }),
    ).rejects.toThrow(ForbiddenError);
    expect(
      (await execute(f.ctx, profileCommentsUpdateOp, f.modActor, { commentId: id, body: "yes" }))
        .bodySource,
    ).toBe("yes");
    expect(
      (await execute(f.ctx, profileCommentsDeleteOp, f.wallActor, { commentId: id })).state,
    ).toBe("deleted");
    recount(f.ctx, post.id);
    await expect(
      execute(f.ctx, profileCommentsGetOp, f.strangerActor, { commentId: id }),
    ).rejects.toThrow(NotFoundError);
    expect(reactableProfileComment(f.ctx, f.modActor, id)).toEqual({
      authorId: f.stranger.id,
      isVisible: false,
    });
    expect(
      (await execute(f.ctx, profileCommentsRestoreOp, f.modActor, { commentId: id })).state,
    ).toBe("visible");
    recount(f.ctx, post.id);
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id = ?1")
      .run(id);
    f.ctx.sqlite
      .prepare("UPDATE profile_posts SET comment_count = comment_count - 1 WHERE id = ?1")
      .run(post.id);
    expect(
      (await execute(f.ctx, profileCommentsGetOp, f.strangerActor, { commentId: id })).state,
    ).toBe("moderated");
    await expect(
      execute(f.ctx, profileCommentsGetOp, f.wallActor, { commentId: id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, profileCommentsCreateOp, f.strangerActor, {
        profilePostId: 999999,
        body: "x",
      }),
    ).rejects.toThrow(NotFoundError);
    expect(
      (await execute(f.ctx, profileCommentsRestoreOp, f.adminActor, { commentId: id })).state,
    ).toBe("visible");
    recount(f.ctx, post.id);
    const newestId = comments.at(-1)!.id;
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id = ?1")
      .run(newestId);
    f.ctx.sqlite
      .prepare("UPDATE profile_posts SET comment_count = comment_count - 1 WHERE id = ?1")
      .run(post.id);
    expect(
      (
        await execute(f.ctx, profilePostsGetOp, GUEST, { profilePostId: post.id })
      ).latestComments.map((c) => c.id),
    ).not.toContain(newestId);
    expect(
      (
        await execute(f.ctx, profilePostsGetOp, f.modActor, { profilePostId: post.id })
      ).latestComments.map((c) => c.id),
    ).toContain(newestId);
    await execute(f.ctx, profileCommentsRestoreOp, f.modActor, { commentId: newestId });
    recount(f.ctx, post.id);
    await execute(f.ctx, profilePostsDeleteOp, f.authorActor, { profilePostId: post.id });
    await expect(
      execute(f.ctx, profileCommentsListOp, f.strangerActor, { profilePostId: post.id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, profileCommentsGetOp, f.strangerActor, { commentId: id }),
    ).rejects.toThrow(NotFoundError);
    expect(reactableProfileComment(f.ctx, f.modActor, id).isVisible).toBe(false);
  });
  test("write permissions, hidden parents, and posting flags", async () => {
    const f = fixture();
    const post = await execute(f.ctx, profilePostsCreateOp, f.wallActor, {
      userId: f.wall.id,
      body: "own wall",
    });
    const comment = await execute(f.ctx, profileCommentsCreateOp, f.authorActor, {
      profilePostId: post.id,
      body: "reply",
    });
    for (const op of [
      () => execute(f.ctx, profilePostsUpdateOp, GUEST, { profilePostId: post.id, body: "x" }),
      () => execute(f.ctx, profilePostsDeleteOp, GUEST, { profilePostId: post.id }),
      () => execute(f.ctx, profilePostsRestoreOp, GUEST, { profilePostId: post.id }),
      () => execute(f.ctx, profileCommentsUpdateOp, GUEST, { commentId: comment.id, body: "x" }),
      () => execute(f.ctx, profileCommentsDeleteOp, GUEST, { commentId: comment.id }),
      () => execute(f.ctx, profileCommentsRestoreOp, GUEST, { commentId: comment.id }),
    ])
      await expect(op()).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(f.ctx, profilePostsRestoreOp, f.strangerActor, { profilePostId: post.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, profileCommentsRestoreOp, f.authorActor, { commentId: comment.id }),
    ).rejects.toThrow(ForbiddenError);
    expect(
      (await execute(f.ctx, profileCommentsGetOp, f.authorActor, { commentId: comment.id }))
        .canEdit,
    ).toBe(true);
    expect(
      (await execute(f.ctx, profileCommentsGetOp, f.strangerActor, { commentId: comment.id }))
        .canEdit,
    ).toBe(false);
    f.ctx.sqlite.run("UPDATE groups SET can_post_profile = 0 WHERE id = 2");
    invalidate(f.ctx, "permissions");
    expect(
      (await execute(f.ctx, profilesGetOp, f.wallActor, { userId: f.wall.id })).canPostOnWall,
    ).toBe(false);
    expect(
      (await execute(f.ctx, profilePostsGetOp, f.authorActor, { profilePostId: post.id }))
        .canComment,
    ).toBe(false);
    await expect(
      execute(f.ctx, profileCommentsCreateOp, f.authorActor, { profilePostId: post.id, body: "x" }),
    ).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite.run("UPDATE groups SET can_post_profile = 1 WHERE id = 2");
    invalidate(f.ctx, "permissions");
    f.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'moderated' WHERE id = ?1").run(post.id);
    await expect(
      execute(f.ctx, profileCommentsCreateOp, f.wallActor, { profilePostId: post.id, body: "x" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, profileCommentsCreateOp, f.authorActor, { profilePostId: post.id, body: "x" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, profileCommentsGetOp, f.authorActor, { commentId: comment.id }),
    ).rejects.toThrow(NotFoundError);
    expect(reactableProfileComment(f.ctx, f.modActor, comment.id).isVisible).toBe(false);
    f.ctx.sqlite.run("UPDATE groups SET can_view_profiles = 0 WHERE id = 2");
    invalidate(f.ctx, "permissions");
    await expect(
      execute(f.ctx, profilePostsGetOp, f.wallActor, { profilePostId: post.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, profileCommentsListOp, f.wallActor, { profilePostId: post.id }),
    ).rejects.toThrow(ForbiddenError);
  });
  test("hot query plans use indexes", () => {
    const f = fixture();
    expectNoTableScan(
      f.ctx,
      "SELECT * FROM profile_posts WHERE profile_user_id = ?1 AND id < ?2 " +
        "AND (state = 'visible' OR ?3 = 1 OR (state = 'moderated' AND user_id = ?4)) ORDER BY id DESC LIMIT ?5",
      [f.wall.id, 1000, 0, f.author.id, 20],
    );
    expectNoTableScan(
      f.ctx,
      "SELECT * FROM profile_post_comments WHERE profile_post_id = ?1 AND id < ?2 " +
        "AND (state = 'visible' OR ?3 = 1 OR (state = 'moderated' AND user_id = ?4)) ORDER BY id DESC LIMIT ?5",
      [1, 1000, 0, f.author.id, 20],
    );
    expectNoTableScan(
      f.ctx,
      "SELECT id, username FROM users WHERE username_key >= ?1 AND username_key < ?2 ORDER BY username_key LIMIT ?3",
      ["a", "b", 10],
    );
    expectNoTableScan(
      f.ctx,
      "SELECT id, profile_post_id, user_id, state, created_at, edited_at, body_source, body_html, reaction_counts FROM (" +
        "SELECT c.*, row_number() OVER (PARTITION BY profile_post_id ORDER BY id DESC) AS rn " +
        "FROM profile_post_comments c WHERE profile_post_id IN (SELECT value FROM json_each(?1)) " +
        "AND (state = 'visible' OR ?2 = 1 OR (state = 'moderated' AND user_id = ?3))) WHERE rn <= 3",
      ["[1,2]", 0, f.author.id],
      { allowTempBTree: true },
    );
  });
});
