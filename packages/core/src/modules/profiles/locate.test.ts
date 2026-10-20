import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError } from "../../errors";
import { execute } from "../../operation";
import {
  profileCommentsCreateOp,
  profileCommentsListOp,
  profileCommentsLocateOp,
  profilePostsCreateOp,
  profilePostsDeleteOp,
  profilePostsListOp,
  profilePostsLocateOp,
} from "./index";
import { locateSql } from "./locate";

function fixture() {
  const ctx = createTestContext();
  const wall = insertUser(ctx, { username: "Wall" });
  const author = insertUser(ctx, { username: "Author" });
  const moderator = insertUser(ctx, { username: "Mod", groupId: 3 });
  return {
    ctx,
    wall,
    wallActor: userActor(wall),
    authorActor: userActor(author),
    modActor: userActor(moderator),
  };
}

type Fixture = ReturnType<typeof fixture>;

async function postMany(f: Fixture, count: number) {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const post = await execute(f.ctx, profilePostsCreateOp, f.authorActor, {
      userId: f.wall.id,
      body: `post ${i}`,
    });
    ids.push(post.id);
  }
  return ids;
}

// The page of `limit` that a list read from the cursor opens, as the wall reads it.
async function wallPage(
  f: Fixture,
  actor: Fixture["authorActor"],
  cursor: string | null,
  limit: number,
) {
  const page = await execute(f.ctx, profilePostsListOp, actor, {
    userId: f.wall.id,
    cursor: cursor ?? undefined,
    limit,
  });
  return page.items.map((post) => post.id);
}

describe("profilePosts.locate", () => {
  test("gives the cursor of the page, counted from the newest post, that holds the post", async () => {
    const f = fixture();
    const ids = await postMany(f, 12);
    const newestFirst = ids.toReversed();
    // Each post's located page is exactly the page the wall reads by walking from the top.
    const pages: number[][] = [];
    let cursor: string | undefined;
    do {
      const page = await execute(f.ctx, profilePostsListOp, GUEST, {
        userId: f.wall.id,
        cursor,
        limit: 5,
      });
      pages.push(page.items.map((post) => post.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pages.flat()).toEqual(newestFirst);
    for (const id of ids) {
      const located = await execute(f.ctx, profilePostsLocateOp, GUEST, {
        profilePostId: id,
        limit: 5,
      });
      expect(located.profileUserId).toBe(f.wall.id);
      expect(located.profilePostId).toBe(id);
      const page = await wallPage(f, f.authorActor, located.cursor, 5);
      expect(pages).toContainEqual(page);
      expect(page).toContain(id);
    }
    const newest = await execute(f.ctx, profilePostsLocateOp, GUEST, {
      profilePostId: newestFirst[4]!,
      limit: 5,
    });
    expect(newest.cursor).toBeNull();
  });

  test("counts only the posts the viewer may see", async () => {
    const f = fixture();
    const ids = await postMany(f, 6);
    // The two newest are deleted: a guest sees four, a moderator six.
    for (const id of ids.slice(4))
      await execute(f.ctx, profilePostsDeleteOp, f.modActor, { profilePostId: id });
    const oldest = ids[0]!;
    const guest = await execute(f.ctx, profilePostsLocateOp, GUEST, {
      profilePostId: oldest,
      limit: 4,
    });
    expect(guest.cursor).toBeNull();
    const moderator = await execute(f.ctx, profilePostsLocateOp, f.modActor, {
      profilePostId: oldest,
      limit: 4,
    });
    expect(await wallPage(f, f.modActor, moderator.cursor, 4)).toEqual([ids[1]!, ids[0]!]);
  });

  test("a post the viewer may not see, or one that does not exist, is not found", async () => {
    const f = fixture();
    const [id] = await postMany(f, 1);
    await execute(f.ctx, profilePostsDeleteOp, f.modActor, { profilePostId: id! });
    await expect(
      execute(f.ctx, profilePostsLocateOp, GUEST, { profilePostId: id!, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      execute(f.ctx, profilePostsLocateOp, GUEST, { profilePostId: 999, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("profileComments.locate", () => {
  test("gives the wall's page of the post and the comments' page of the comment", async () => {
    const f = fixture();
    const ids = await postMany(f, 7);
    const target = ids[1]!;
    const comments: number[] = [];
    for (let i = 0; i < 9; i++) {
      const comment = await execute(f.ctx, profileCommentsCreateOp, f.wallActor, {
        profilePostId: target,
        body: `comment ${i}`,
      });
      comments.push(comment.id);
    }
    for (const commentId of comments) {
      const located = await execute(f.ctx, profileCommentsLocateOp, GUEST, {
        commentId,
        limit: 4,
      });
      expect(located).toMatchObject({
        commentId,
        profilePostId: target,
        profileUserId: f.wall.id,
      });
      expect(await wallPage(f, f.authorActor, located.wallCursor, 4)).toContain(target);
      const page = await execute(f.ctx, profileCommentsListOp, GUEST, {
        profilePostId: target,
        cursor: located.commentsCursor ?? undefined,
        limit: 4,
      });
      expect(page.items.map((comment) => comment.id)).toContain(commentId);
    }
    const newest = await execute(f.ctx, profileCommentsLocateOp, GUEST, {
      commentId: comments.at(-1)!,
      limit: 4,
    });
    expect(newest.commentsCursor).toBeNull();
  });

  test("a comment on a post the viewer may not see is not found", async () => {
    const f = fixture();
    const [id] = await postMany(f, 1);
    const comment = await execute(f.ctx, profileCommentsCreateOp, f.wallActor, {
      profilePostId: id!,
      body: "hello",
    });
    await execute(f.ctx, profilePostsDeleteOp, f.modActor, { profilePostId: id! });
    await expect(
      execute(f.ctx, profileCommentsLocateOp, GUEST, { commentId: comment.id, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("its queries seek the list's index", () => {
    const f = fixture();
    expectNoTableScan(f.ctx, locateSql.wallAbove, [f.wall.id, 1, 0, 0, 1]);
    expectNoTableScan(f.ctx, locateSql.wallNth, [f.wall.id, 1, 0, 0, 1, 3]);
    expectNoTableScan(f.ctx, locateSql.commentsAbove, [1, 1, 0, 0, 1]);
    expectNoTableScan(f.ctx, locateSql.commentsNth, [1, 1, 0, 0, 1, 3]);
  });
});

test("a locate is refused, like the wall, to a viewer who may not open the wall's profile, its author too", async () => {
  const f = fixture();
  const [postId] = await postMany(f, 1);
  const comment = await execute(f.ctx, profileCommentsCreateOp, f.authorActor, {
    profilePostId: postId!,
    body: "My comment",
  });
  f.ctx.sqlite
    .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
    .run(f.wall.id);
  await expect(
    execute(f.ctx, profilePostsLocateOp, f.authorActor, { profilePostId: postId! }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(
    execute(f.ctx, profileCommentsLocateOp, f.authorActor, { commentId: comment.id }),
  ).rejects.toBeInstanceOf(NotFoundError);
  // The wall's owner still finds both.
  expect(
    (await execute(f.ctx, profileCommentsLocateOp, f.wallActor, { commentId: comment.id }))
      .commentId,
  ).toBe(comment.id);
});
