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
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
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
import { prefixSuccessor, USER_SEARCH_SQL, USER_SEARCH_TAIL_SQL } from "./posts";
import { COMMENTS_SQL, LATEST_COMMENTS_SQL, WALL_SQL } from "./shared";

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
    f.ctx.sqlite
      .prepare("UPDATE users SET post_count = 7, reaction_score = 9 WHERE id = ?1")
      .run(f.wall.id);
    const profile = await execute(f.ctx, profilesGetOp, GUEST, { userId: f.wall.id });
    expect(profile.groupTitle).toBe("Member");
    expect(profile.postCount).toBe(7);
    expect(profile.reactionScore).toBe(9);
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
    expect(
      (await execute(f.ctx, profilesUpdateOp, f.authorActor, { about: "allowed" })).about,
    ).toBe("allowed");
    expect((await execute(f.ctx, profilesGetOp, f.adminActor, { userId: f.author.id })).about).toBe(
      "allowed",
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
  test("search successor includes astral and U+FFFF characters", async () => {
    const f = fixture();
    const names = ["abA", "ab\uffffx", "ab😀x", "across", "\u{10ffff}", "\u{10ffff}x"];
    for (const username of names) insertUser(f.ctx, { username });
    expect(prefixSuccessor("ab")).toBe("ac");
    expect(prefixSuccessor("ab\uffff")).toBe("ab\u{10000}");
    expect(prefixSuccessor("\u{10ffff}")).toBeNull();
    expect(
      (await execute(f.ctx, usersSearchOp, GUEST, { prefix: "AB" })).items.map((u) => u.username),
    ).toEqual(names.slice(0, 3));
    expect(
      (await execute(f.ctx, usersSearchOp, GUEST, { prefix: "ab\uffff" })).items.map(
        (u) => u.username,
      ),
    ).toEqual(["ab\uffffx"]);
    expect(
      (await execute(f.ctx, usersSearchOp, GUEST, { prefix: "\u{10ffff}" })).items.map(
        (u) => u.username,
      ),
    ).toEqual(["\u{10ffff}", "\u{10ffff}x"]);
  });
  test("wall pages batch and group the latest comments by visibility", async () => {
    const f = fixture();
    const expectedGuest = new Map<number, number[]>();
    const expectedAuthor = new Map<number, number[]>();
    const expectedMod = new Map<number, number[]>();
    for (let p = 0; p < 3; p++) {
      const post = await execute(f.ctx, profilePostsCreateOp, f.wallActor, {
        userId: f.wall.id,
        body: `post ${p}`,
      });
      const ids: number[] = [];
      for (let c = 0; c < 6; c++) {
        const creator = c === 3 ? f.authorActor : f.strangerActor;
        ids.push(
          (
            await execute(f.ctx, profileCommentsCreateOp, creator, {
              profilePostId: post.id,
              body: `comment ${p}-${c}`,
            })
          ).id,
        );
      }
      f.ctx.sqlite
        .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id IN (?1, ?2)")
        .run(ids[3]!, ids[4]!);
      f.ctx.sqlite
        .prepare("UPDATE profile_post_comments SET state = 'deleted' WHERE id = ?1")
        .run(ids[5]!);
      f.ctx.sqlite
        .prepare(
          "UPDATE profile_posts SET comment_count = 3, last_comment_at = (SELECT created_at FROM profile_post_comments WHERE id = ?2) WHERE id = ?1",
        )
        .run(post.id, ids[2]!);
      expectedGuest.set(post.id, ids.slice(0, 3));
      expectedAuthor.set(post.id, [ids[1]!, ids[2]!, ids[3]!]);
      expectedMod.set(post.id, ids.slice(3));
    }
    for (const [actor, expected] of [
      [GUEST, expectedGuest],
      [f.authorActor, expectedAuthor],
      [f.modActor, expectedMod],
    ] as const) {
      const page = await execute(f.ctx, profilePostsListOp, actor, {
        userId: f.wall.id,
        limit: 10,
      });
      expect(page.items).toHaveLength(3);
      for (const post of page.items)
        expect(post.latestComments.map((comment) => comment.id)).toEqual(expected.get(post.id)!);
    }
  });
  test("keyset pages skip hidden rows for ordinary viewers", async () => {
    const f = fixture();
    const postIds: number[] = [];
    for (let i = 0; i < 6; i++) {
      const actor = i === 2 ? f.strangerActor : f.authorActor;
      postIds.push(
        (
          await execute(f.ctx, profilePostsCreateOp, actor, {
            userId: f.wall.id,
            body: `post ${i}`,
          })
        ).id,
      );
    }
    f.ctx.sqlite
      .prepare("UPDATE profile_posts SET state = 'moderated' WHERE id IN (?1, ?2)")
      .run(postIds[1]!, postIds[2]!);
    f.ctx.sqlite
      .prepare("UPDATE profile_posts SET state = 'deleted' WHERE id = ?1")
      .run(postIds[3]!);
    async function collectPosts(actor: typeof GUEST) {
      const ids: number[] = [];
      let cursor: string | undefined;
      do {
        const page = await execute(f.ctx, profilePostsListOp, actor, {
          userId: f.wall.id,
          limit: 2,
          cursor,
        });
        ids.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return ids;
    }
    expect(await collectPosts(GUEST)).toEqual([postIds[5]!, postIds[4]!, postIds[0]!]);
    expect(await collectPosts(f.authorActor)).toEqual([
      postIds[5]!,
      postIds[4]!,
      postIds[1]!,
      postIds[0]!,
    ]);
    expect(await collectPosts(f.modActor)).toEqual(postIds.toReversed());

    const commentIds: number[] = [];
    for (let i = 0; i < 6; i++) {
      const actor = i === 2 ? f.strangerActor : f.authorActor;
      commentIds.push(
        (
          await execute(f.ctx, profileCommentsCreateOp, actor, {
            profilePostId: postIds[0]!,
            body: `comment ${i}`,
          })
        ).id,
      );
    }
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id IN (?1, ?2)")
      .run(commentIds[1]!, commentIds[2]!);
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'deleted' WHERE id = ?1")
      .run(commentIds[3]!);
    async function collectComments(actor: typeof GUEST) {
      const ids: number[] = [];
      let cursor: string | undefined;
      do {
        const page = await execute(f.ctx, profileCommentsListOp, actor, {
          profilePostId: postIds[0]!,
          limit: 2,
          cursor,
        });
        ids.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return ids;
    }
    expect(await collectComments(GUEST)).toEqual([commentIds[5]!, commentIds[4]!, commentIds[0]!]);
    expect(await collectComments(f.authorActor)).toEqual([
      commentIds[5]!,
      commentIds[4]!,
      commentIds[1]!,
      commentIds[0]!,
    ]);
    expect(await collectComments(f.adminActor)).toEqual(commentIds.toReversed());
  });
  test("state changes keep comment counters through hidden and repeated transitions", async () => {
    const f = fixture();
    const post = await execute(f.ctx, profilePostsCreateOp, f.authorActor, {
      userId: f.wall.id,
      body: "post",
    });
    const first = await execute(f.ctx, profileCommentsCreateOp, f.strangerActor, {
      profilePostId: post.id,
      body: "first",
    });
    f.ctx.clock.advance(1000);
    const second = await execute(f.ctx, profileCommentsCreateOp, f.strangerActor, {
      profilePostId: post.id,
      body: "second",
    });
    recount(f.ctx, post.id);
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id = ?1")
      .run(first.id);
    f.ctx.sqlite
      .prepare("UPDATE profile_posts SET comment_count = comment_count - 1 WHERE id = ?1")
      .run(post.id);
    recount(f.ctx, post.id);
    await execute(f.ctx, profileCommentsDeleteOp, f.modActor, { commentId: first.id });
    recount(f.ctx, post.id);
    await execute(f.ctx, profileCommentsDeleteOp, f.modActor, { commentId: first.id });
    recount(f.ctx, post.id);
    await execute(f.ctx, profileCommentsDeleteOp, f.modActor, { commentId: second.id });
    recount(f.ctx, post.id);
    await execute(f.ctx, profilePostsDeleteOp, f.authorActor, { profilePostId: post.id });
    recount(f.ctx, post.id);
    await execute(f.ctx, profileCommentsRestoreOp, f.modActor, { commentId: first.id });
    recount(f.ctx, post.id);
    await execute(f.ctx, profilePostsRestoreOp, f.modActor, { profilePostId: post.id });
    recount(f.ctx, post.id);
    await execute(f.ctx, profileCommentsRestoreOp, f.modActor, { commentId: first.id });
    recount(f.ctx, post.id);
  });
  test("hidden visibility and flags for guests, moderators, and admins", async () => {
    const f = fixture();
    const post = await execute(f.ctx, profilePostsCreateOp, f.authorActor, {
      userId: f.wall.id,
      body: "post",
    });
    for (const actor of [f.modActor, f.adminActor]) {
      const value = await execute(f.ctx, profilePostsGetOp, actor, { profilePostId: post.id });
      expect(value.canEdit).toBe(true);
      expect(value.canDelete).toBe(true);
      expect(value.canComment).toBe(true);
    }
    const comment = await execute(f.ctx, profileCommentsCreateOp, f.authorActor, {
      profilePostId: post.id,
      body: "comment",
    });
    f.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'moderated' WHERE id = ?1").run(post.id);
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id = ?1")
      .run(comment.id);
    for (const actor of [GUEST, f.wallActor]) {
      await expect(
        execute(f.ctx, profilePostsGetOp, actor, { profilePostId: post.id }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(f.ctx, profileCommentsGetOp, actor, { commentId: comment.id }),
      ).rejects.toThrow(NotFoundError);
    }
    for (const actor of [f.modActor, f.adminActor]) {
      const value = await execute(f.ctx, profilePostsGetOp, actor, { profilePostId: post.id });
      expect(value.state).toBe("moderated");
      expect(value.canEdit).toBe(true);
      expect(value.canDelete).toBe(true);
      expect(value.canComment).toBe(false);
      const child = await execute(f.ctx, profileCommentsGetOp, actor, { commentId: comment.id });
      expect(child.canEdit).toBe(true);
      expect(child.canDelete).toBe(true);
    }
    f.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'deleted' WHERE id = ?1").run(post.id);
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'deleted' WHERE id = ?1")
      .run(comment.id);
    for (const actor of [GUEST, f.authorActor]) {
      await expect(
        execute(f.ctx, profilePostsGetOp, actor, { profilePostId: post.id }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(f.ctx, profileCommentsGetOp, actor, { commentId: comment.id }),
      ).rejects.toThrow(NotFoundError);
    }
    expect(
      (await execute(f.ctx, profilePostsGetOp, f.adminActor, { profilePostId: post.id })).state,
    ).toBe("deleted");
  });
  test("unknown walls, invalid cursors, and hidden reaction targets", async () => {
    const f = fixture();
    await expect(
      execute(f.ctx, profilePostsCreateOp, f.authorActor, { userId: 999999, body: "post" }),
    ).rejects.toThrow(NotFoundError);
    const post = await execute(f.ctx, profilePostsCreateOp, f.authorActor, {
      userId: f.wall.id,
      body: "post",
    });
    expect(f.ctx.statements.has("profiles.latestComments")).toBe(false);
    const comment = await execute(f.ctx, profileCommentsCreateOp, f.authorActor, {
      profilePostId: post.id,
      body: "comment",
    });
    await expect(
      execute(f.ctx, profilePostsListOp, GUEST, { userId: f.wall.id, cursor: "garbage" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(f.ctx, profileCommentsListOp, GUEST, { profilePostId: post.id, cursor: "garbage" }),
    ).rejects.toThrow(ValidationError);
    f.ctx.sqlite.run("UPDATE groups SET can_view_profiles = 0 WHERE id = 2");
    invalidate(f.ctx, "permissions");
    expect(() => reactableProfilePost(f.ctx, f.authorActor, post.id)).toThrow(NotFoundError);
    expect(() => reactableProfileComment(f.ctx, f.authorActor, comment.id)).toThrow(NotFoundError);
  });
  test("hot query plans use indexes", () => {
    const f = fixture();
    expectNoTableScan(f.ctx, WALL_SQL, [f.wall.id, 1000, 0, f.author.id, 20]);
    expectNoTableScan(f.ctx, COMMENTS_SQL, [1, 1000, 0, f.author.id, 20]);
    expectNoTableScan(f.ctx, USER_SEARCH_SQL, ["a", "b", 10]);
    expectNoTableScan(f.ctx, USER_SEARCH_TAIL_SQL, ["a", 10]);
    expectNoTableScan(f.ctx, LATEST_COMMENTS_SQL, ["[1,2]", 0, f.author.id]);
  });
});
