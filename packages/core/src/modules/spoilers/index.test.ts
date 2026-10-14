import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import {
  conversationsCreateOp,
  conversationsLeaveOp,
  conversationsReplyOp,
} from "../conversations";
import { nodesCreateOp, postsCreateOp, postsUpdateOp, threadsCreateOp } from "../forums";
import {
  profileCommentsCreateOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsUpdateOp,
} from "../profiles";
import { spoilersGetOp } from "./index";

const BODY =
  "before [SPOILER=Title]secret **block**[/SPOILER] and [ISPOILER]secret inline[/ISPOILER]";

async function world() {
  const ctx = createTestContext();
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const modUser = insertUser(ctx, { groupId: 3 });
  const mod = userActor(modUser);
  const authorUser = insertUser(ctx);
  const author = userActor(authorUser);
  const otherUser = insertUser(ctx);
  const other = userActor(otherUser);
  const forum = await execute(ctx, nodesCreateOp, admin, {
    parentId: null,
    type: "forum",
    title: "Forum",
  });
  const get = (
    actor: Parameters<typeof userActor>[0] | typeof GUEST,
    type: string,
    id: number,
    position = 0,
  ) =>
    execute(ctx, spoilersGetOp, "kind" in actor ? actor : userActor(actor), {
      contentType: type as "post",
      contentId: id,
      position,
    });
  const rows = (type: string, id: number) =>
    ctx.sqlite
      .prepare<{ position: number; html: string }, [string, number]>(
        "SELECT position, html FROM content_spoilers WHERE content_type = ?1 AND content_id = ?2 ORDER BY position",
      )
      .all(type, id);
  return { ctx, admin, mod, author, authorUser, other, otherUser, forum, get, rows };
}

describe("spoilers.get: forum posts", () => {
  test("stores the spoilers of a thread, a reply and every edit, and returns them", async () => {
    const w = await world();
    const thread = await execute(w.ctx, threadsCreateOp, w.author, {
      nodeId: w.forum.id,
      title: "Topic",
      body: BODY,
    });
    expect(w.rows("post", thread.post.id).map((row) => row.html)).toEqual([
      "secret <strong>block</strong>",
      "secret inline",
    ]);
    // The body itself carries only the placeholders.
    const stored = w.ctx.sqlite
      .prepare<{ body_html: string }, [number]>(
        "SELECT body_html FROM post_bodies WHERE post_id = ?1",
      )
      .get(thread.post.id)!;
    expect(stored.body_html).not.toContain("secret");
    expect(stored.body_html).toContain('data-spoiler="0" data-spoiler-title="Title"');

    expect(await w.get(w.other, "post", thread.post.id, 0)).toEqual({
      html: "secret <strong>block</strong>",
    });
    expect(await w.get(GUEST, "post", thread.post.id, 1)).toEqual({ html: "secret inline" });

    const reply = await execute(w.ctx, postsCreateOp, w.other, {
      threadId: thread.thread.id,
      body: ">!reply secret!<",
    });
    expect(w.rows("post", reply.id).map((row) => row.html)).toEqual(["reply secret"]);
    await execute(w.ctx, postsUpdateOp, w.other, {
      postId: reply.id,
      body: "[SPOILER]one[/SPOILER] [ISPOILER]two[/ISPOILER] :::quote x",
    });
    expect(w.rows("post", reply.id).map((row) => row.html)).toEqual(["one", "two"]);
    await execute(w.ctx, postsUpdateOp, w.other, { postId: reply.id, body: "none left" });
    expect(w.rows("post", reply.id)).toEqual([]);
    await expect(w.get(w.other, "post", reply.id, 0)).rejects.toBeInstanceOf(NotFoundError);
    // Another post's rows are untouched.
    expect(w.rows("post", thread.post.id)).toHaveLength(2);
  });

  test("a missing position or item is not found", async () => {
    const w = await world();
    const thread = await execute(w.ctx, threadsCreateOp, w.author, {
      nodeId: w.forum.id,
      title: "Topic",
      body: BODY,
    });
    await expect(w.get(w.author, "post", thread.post.id, 2)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.get(w.author, "post", 999_999, 0)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("follows the post's and the thread's state and the forum's visibility", async () => {
    const w = await world();
    const thread = await execute(w.ctx, threadsCreateOp, w.author, {
      nodeId: w.forum.id,
      title: "Topic",
      body: "first",
    });
    const reply = await execute(w.ctx, postsCreateOp, w.author, {
      threadId: thread.thread.id,
      body: BODY,
    });
    const setPost = (state: string) =>
      w.ctx.sqlite.prepare("UPDATE posts SET state = ?1 WHERE id = ?2").run(state, reply.id);

    setPost("moderated");
    expect((await w.get(w.author, "post", reply.id)).html).toContain("secret");
    expect((await w.get(w.mod, "post", reply.id)).html).toContain("secret");
    await expect(w.get(w.other, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.get(GUEST, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);

    setPost("deleted");
    await expect(w.get(w.author, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.get(w.other, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await w.get(w.mod, "post", reply.id)).html).toContain("secret");
    expect((await w.get(w.admin, "post", reply.id)).html).toContain("secret");

    setPost("visible");
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1")
      .run(thread.thread.id);
    await expect(w.get(w.author, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await w.get(w.mod, "post", reply.id)).html).toContain("secret");
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'visible' WHERE id = ?1")
      .run(thread.thread.id);

    expect((await w.get(w.other, "post", reply.id)).html).toContain("secret");
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, ?2, id, -1 FROM permission_definitions WHERE key = 'node.view'",
      )
      .run(w.otherUser.id, w.forum.id);
    invalidate(w.ctx, "permissions");
    await expect(w.get(w.other, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await w.get(w.author, "post", reply.id)).html).toContain("secret");
  });
});

describe("spoilers.get: conversation messages", () => {
  async function chat() {
    const w = await world();
    const third = insertUser(w.ctx);
    const made = await execute(w.ctx, conversationsCreateOp, w.author, {
      title: "Private",
      recipientIds: [w.otherUser.id],
      body: BODY,
    });
    const reply = await execute(w.ctx, conversationsReplyOp, w.other, {
      conversationId: made.conversation.id,
      body: ">!reply secret!<",
    });
    return { ...w, third, made, reply };
  }

  test("stored on create and reply; returned to active participants only", async () => {
    const w = await chat();
    expect(w.rows("conversation_message", w.made.message.id)).toHaveLength(2);
    expect(w.rows("conversation_message", w.reply.id).map((row) => row.html)).toEqual([
      "reply secret",
    ]);
    expect((await w.get(w.author, "conversation_message", w.made.message.id, 1)).html).toBe(
      "secret inline",
    );
    expect((await w.get(w.other, "conversation_message", w.made.message.id, 0)).html).toContain(
      "<strong>block</strong>",
    );
    for (const outsider of [w.third, w.mod, w.admin])
      await expect(
        w.get(outsider as never, "conversation_message", w.made.message.id, 0),
      ).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.get(GUEST, "conversation_message", w.made.message.id, 0)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.get(w.author, "conversation_message", 999_999, 0)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a participant who left no longer reads them", async () => {
    const w = await chat();
    await execute(w.ctx, conversationsLeaveOp, w.other, { conversationId: w.made.conversation.id });
    await expect(
      w.get(w.other, "conversation_message", w.made.message.id, 0),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await w.get(w.author, "conversation_message", w.made.message.id, 0)).html).toContain(
      "secret",
    );
  });

  test("follows the message state", async () => {
    const w = await chat();
    const set = (state: string) =>
      w.ctx.sqlite
        .prepare("UPDATE conversation_messages SET state = ?1 WHERE id = ?2")
        .run(state, w.reply.id);
    set("moderated");
    expect((await w.get(w.other, "conversation_message", w.reply.id)).html).toBe("reply secret");
    await expect(w.get(w.author, "conversation_message", w.reply.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    set("deleted");
    await expect(w.get(w.other, "conversation_message", w.reply.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.get(w.author, "conversation_message", w.reply.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'conversation.viewHidden'), 0, 2, 0, 1)",
      )
      .run();
    invalidate(w.ctx, "permissions");
    expect((await w.get(w.author, "conversation_message", w.reply.id)).html).toBe("reply secret");
  });
});

describe("spoilers.get: profile posts and comments", () => {
  async function wall() {
    const w = await world();
    const owner = insertUser(w.ctx);
    const post = await execute(w.ctx, profilePostsCreateOp, w.author, {
      userId: owner.id,
      body: BODY,
    });
    const comment = await execute(w.ctx, profileCommentsCreateOp, w.other, {
      profilePostId: post.id,
      body: ">!comment secret!<",
    });
    return { ...w, owner, post, comment };
  }

  test("stored on create and update; returned to whoever can read the item", async () => {
    const w = await wall();
    expect(w.rows("profile_post", w.post.id)).toHaveLength(2);
    expect(w.rows("profile_post_comment", w.comment.id).map((row) => row.html)).toEqual([
      "comment secret",
    ]);
    expect((await w.get(w.other, "profile_post", w.post.id, 0)).html).toContain("secret");
    expect((await w.get(w.author, "profile_post_comment", w.comment.id, 0)).html).toBe(
      "comment secret",
    );
    await execute(w.ctx, profilePostsUpdateOp, w.author, {
      profilePostId: w.post.id,
      body: "[SPOILER]edited[/SPOILER]",
    });
    expect(w.rows("profile_post", w.post.id).map((row) => row.html)).toEqual(["edited"]);
    await execute(w.ctx, profileCommentsUpdateOp, w.other, {
      commentId: w.comment.id,
      body: "no spoiler",
    });
    expect(w.rows("profile_post_comment", w.comment.id)).toEqual([]);
    await expect(w.get(w.other, "profile_post", w.post.id, 1)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.get(w.other, "profile_post", 999_999, 0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.get(w.other, "profile_post_comment", 999_999, 0)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("follows the item's state and the profile's privacy", async () => {
    const w = await wall();
    const setPost = (state: string) =>
      w.ctx.sqlite
        .prepare("UPDATE profile_posts SET state = ?1 WHERE id = ?2")
        .run(state, w.post.id);
    setPost("moderated");
    expect((await w.get(w.author, "profile_post", w.post.id)).html).toContain("secret");
    expect((await w.get(w.mod, "profile_post", w.post.id)).html).toContain("secret");
    await expect(w.get(w.other, "profile_post", w.post.id)).rejects.toBeInstanceOf(NotFoundError);
    setPost("deleted");
    await expect(w.get(w.author, "profile_post", w.post.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await w.get(w.admin, "profile_post", w.post.id)).html).toContain("secret");
    setPost("visible");

    w.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'deleted' WHERE id = ?1")
      .run(w.comment.id);
    await expect(w.get(w.author, "profile_post_comment", w.comment.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await w.get(w.admin, "profile_post_comment", w.comment.id)).html).toBe(
      "comment secret",
    );
    w.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'visible' WHERE id = ?1")
      .run(w.comment.id);

    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.owner.id);
    await expect(w.get(w.other, "profile_post", w.post.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      w.get(userActor(insertUser(w.ctx)), "profile_post_comment", w.comment.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The comment's own author still reads it, like profileComments.get.
    expect((await w.get(w.other, "profile_post_comment", w.comment.id)).html).toBe(
      "comment secret",
    );
    expect(
      (await w.get(userActor({ id: w.owner.id, groupId: 2 }), "profile_post", w.post.id)).html,
    ).toContain("secret");
  });

  test("guests get the same refusal as the item's own read", async () => {
    const w = await wall();
    const refusal = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        return error;
      }
      return undefined;
    };
    const spoiler = await refusal(() => w.get(GUEST, "profile_post", w.post.id));
    expect(
      spoiler instanceof NotFoundError ||
        spoiler instanceof ForbiddenError ||
        spoiler instanceof UnauthenticatedError ||
        spoiler === undefined,
    ).toBe(true);
    if (spoiler === undefined) {
      expect((await w.get(GUEST, "profile_post", w.post.id)).html).toContain("secret");
    }
  });
});
