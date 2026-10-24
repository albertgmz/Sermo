import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { execute } from "../../operation";
import { traceStatements } from "../statement-trace";
import {
  profileCommentsCreateOp,
  profileCommentsDeleteOp,
  profileCommentsListOp,
  profilePostsCreateOp,
  profilePostsDeleteOp,
  profilePostsGetOp,
  profilePostsListOp,
} from "./index";

// On Wall's wall, Author writes two posts and comments on a live one; a moderator deletes one post
// and the comment.
async function fixture() {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const wall = insertUser(ctx, { username: "Wall" });
  const author = insertUser(ctx, { username: "Author" });
  const stranger = insertUser(ctx, { username: "Stranger" });
  const moderator = insertUser(ctx, { username: "Mod", groupId: 3 });
  const [authorActor, strangerActor, modActor] = [author, stranger, moderator].map((user) =>
    userActor(user),
  );
  const write = (body: string) =>
    execute(ctx, profilePostsCreateOp, authorActor!, { userId: wall.id, body, attachmentIds: [] });
  const gone = await write("gone");
  const live = await write("live");
  const comment = await execute(ctx, profileCommentsCreateOp, authorActor!, {
    profilePostId: live.id,
    body: "a comment",
    attachmentIds: [],
  });
  await execute(ctx, profilePostsDeleteOp, modActor!, {
    profilePostId: gone.id,
    reason: "Spam",
    notify: false,
  });
  await execute(ctx, profileCommentsDeleteOp, modActor!, {
    commentId: comment.id,
    reason: "Rude",
    notify: false,
  });
  return {
    ctx,
    trace,
    wall,
    moderator,
    authorActor: authorActor!,
    strangerActor: strangerActor!,
    modActor: modActor!,
    gone,
    live,
    comment,
  };
}

describe("profiles: who hid a deleted wall post or comment, and why", () => {
  test("a moderator sees who deleted a wall post and a comment, why and when, in the wall and in each list", async () => {
    const f = await fixture();
    try {
      const page = await execute(f.ctx, profilePostsListOp, f.modActor, { userId: f.wall.id });
      const post = page.items.find((item) => item.id === f.gone.id)!;
      expect(post.deletion?.by).toEqual({
        kind: "member",
        id: f.moderator.id,
        username: "Mod",
      });
      expect(post.deletion?.reason).toBe("Spam");
      expect(Number.isNaN(Date.parse(post.deletion?.at ?? ""))).toBe(false);
      const live = page.items.find((item) => item.id === f.live.id)!;
      expect(live.deletion).toBeNull();
      // The newest comments shown with the post, and the comment list itself.
      expect(live.latestComments[0]?.deletion?.reason).toBe("Rude");
      expect(live.latestComments[0]?.deletion?.by).toMatchObject({ username: "Mod" });
      const comments = await execute(f.ctx, profileCommentsListOp, f.modActor, {
        profilePostId: f.live.id,
      });
      expect(comments.items[0]?.deletion?.by).toMatchObject({ username: "Mod" });
      const single = await execute(f.ctx, profilePostsGetOp, f.modActor, {
        profilePostId: f.gone.id,
      });
      expect(single.deletion).toEqual(post.deletion);
    } finally {
      closeContext(f.ctx);
    }
  });

  test("members who may not see deleted wall content get neither the items nor who deleted them", async () => {
    const f = await fixture();
    try {
      for (const actor of [f.strangerActor, f.authorActor]) {
        const page = await execute(f.ctx, profilePostsListOp, actor, { userId: f.wall.id });
        expect(page.items.some((item) => item.id === f.gone.id)).toBe(false);
        expect(page.items.every((item) => item.deletion === null)).toBe(true);
        const live = page.items.find((item) => item.id === f.live.id)!;
        expect(live.latestComments).toEqual([]);
      }
    } finally {
      closeContext(f.ctx);
    }
  });

  test("a wall page costs one lookup per kind of deleted item, and none for a member", async () => {
    const f = await fixture();
    try {
      const posts = /FROM domain_events WHERE target_type = 'profile_post'/;
      const comments = /FROM domain_events WHERE target_type = 'profile_post_comment'/;
      const users = /FROM users WHERE id IN/;
      f.trace.sql.length = 0;
      await execute(f.ctx, profilePostsListOp, f.modActor, { userId: f.wall.id });
      expect(f.trace.count(posts)).toBe(1);
      expect(f.trace.count(comments)).toBe(1);
      // The authors with the post deleters, then the comment deleters: no read per item.
      expect(f.trace.count(users)).toBeLessThanOrEqual(2);
      f.trace.sql.length = 0;
      await execute(f.ctx, profilePostsListOp, f.strangerActor, { userId: f.wall.id });
      expect(f.trace.count(posts) + f.trace.count(comments)).toBe(0);
    } finally {
      closeContext(f.ctx);
    }
  });
});
