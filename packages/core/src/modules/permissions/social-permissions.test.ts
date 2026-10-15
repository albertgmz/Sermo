import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import {
  conversationsAddParticipantsOp,
  conversationsCreateOp,
  conversationsReplyOp,
  conversationsUpdateMessageOp,
} from "../conversations";
import { feedListOp } from "../feed/feed";
import {
  profileCommentsCreateOp,
  profileCommentsListOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsGetOp,
  profilePostsListOp,
  profilePostsUpdateOp,
  profilesGetOp,
} from "../profiles";
import { reactionsSetOp, reactionTypesCreateOp } from "../reactions";
import { usersIgnoreOp, usersRelationsOp } from "../social";
import { createStorage, localDriver } from "../storage";

type Ctx = ReturnType<typeof createTestContext>;
type AnyActor = Parameters<typeof execute>[2];

function setEntry(ctx: Ctx, groupId: number, key: string, value: number) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, ?2 FROM permission_definitions WHERE key = ?3 ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
    )
    .run(groupId, value, key);
  ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
}

/** A member of a new custom group holding exactly the given permissions. */
function customMember(ctx: Ctx, grants: string[]) {
  const groupId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Custom ' || abs(random() % 100000), 10) RETURNING id",
    )
    .get()!.id;
  for (const key of grants) setEntry(ctx, groupId, key, 1);
  setEntry(ctx, groupId, "attachment.storageQuota", 100_000_000);
  setEntry(ctx, groupId, "attachment.maxFileSize", -1);
  const row = insertUser(ctx, { groupId });
  return { groupId, row, actor: userActor(row) };
}

function world() {
  const ctx = createTestContext();
  const a = insertUser(ctx);
  const b = insertUser(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  return {
    ctx,
    a,
    b,
    admin,
    aActor: userActor(a),
    bActor: userActor(b),
    adminActor: userActor(admin),
  };
}

const BASE = ["site.view", "profile.view"];
const WALL = [...BASE, "profilePost.view"];

describe("profile posts", () => {
  test("posting on one's own profile and on others' are separate permissions", async () => {
    const w = world();
    const wallPost = (actor: AnyActor, userId: number) =>
      execute(w.ctx, profilePostsCreateOp, actor, { userId, body: "hello" });
    const canPost = async (actor: AnyActor, userId: number) =>
      (await execute(w.ctx, profilesGetOp, actor, { userId })).canPostOnWall;

    const ownOnly = customMember(w.ctx, [...WALL, "profilePost.postOwn"]);
    await wallPost(ownOnly.actor, ownOnly.row.id);
    await expect(wallPost(ownOnly.actor, w.a.id)).rejects.toThrow(ForbiddenError);
    expect(await canPost(ownOnly.actor, ownOnly.row.id)).toBe(true);
    expect(await canPost(ownOnly.actor, w.a.id)).toBe(false);

    const othersOnly = customMember(w.ctx, [...WALL, "profilePost.post"]);
    await wallPost(othersOnly.actor, w.a.id);
    await expect(wallPost(othersOnly.actor, othersOnly.row.id)).rejects.toThrow(ForbiddenError);
    expect(await canPost(othersOnly.actor, w.a.id)).toBe(true);
    expect(await canPost(othersOnly.actor, othersOnly.row.id)).toBe(false);

    // Members have both; a guest has neither.
    await wallPost(w.aActor, w.a.id);
    await wallPost(w.aActor, w.b.id);
    await expect(wallPost(GUEST, w.a.id)).rejects.toThrow();
    const none = customMember(w.ctx, WALL);
    await expect(wallPost(none.actor, none.row.id)).rejects.toThrow(ForbiddenError);
  });

  test("reading wall posts needs profilePost.view, on the wall, the comments and the feed", async () => {
    const w = world();
    const post = await execute(w.ctx, profilePostsCreateOp, w.aActor, {
      userId: w.a.id,
      body: "wall",
    });
    await execute(w.ctx, profileCommentsCreateOp, w.bActor, {
      profilePostId: post.id,
      body: "comment",
    });
    const reads = (actor: AnyActor) => [
      () => execute(w.ctx, profilePostsListOp, actor, { userId: w.a.id, limit: 20 }),
      () => execute(w.ctx, profilePostsGetOp, actor, { profilePostId: post.id }),
      () => execute(w.ctx, profileCommentsListOp, actor, { profilePostId: post.id, limit: 20 }),
    ];
    for (const read of reads(GUEST)) await read();
    const feedKinds = async (actor: AnyActor) =>
      (await execute(w.ctx, feedListOp, actor, { scope: "latest", limit: 20 })).items.map(
        (item) => item.type,
      );
    expect(await feedKinds(w.bActor)).toHaveLength(1);

    setEntry(w.ctx, 1, "profilePost.view", -1);
    for (const read of reads(GUEST)) await expect(read()).rejects.toThrow(ForbiddenError);
    const bare = customMember(w.ctx, BASE);
    for (const read of reads(bare.actor)) await expect(read()).rejects.toThrow(ForbiddenError);
    expect(await feedKinds(bare.actor)).toHaveLength(0);
    expect(
      (await execute(w.ctx, profilesGetOp, bare.actor, { userId: w.a.id })).canPostOnWall,
    ).toBe(false);
    setEntry(w.ctx, bare.groupId, "profilePost.view", 1);
    for (const read of reads(bare.actor)) await read();
    expect(await feedKinds(bare.actor)).toHaveLength(1);
    for (const read of reads(w.bActor)) await read();
  });

  test("reacting to wall posts and comments needs profilePost.react", async () => {
    const w = world();
    const type = await execute(w.ctx, reactionTypesCreateOp, w.adminActor, {
      title: "Like",
      emoji: "+",
      score: 1,
      position: 0,
    });
    const post = await execute(w.ctx, profilePostsCreateOp, w.aActor, {
      userId: w.a.id,
      body: "wall",
    });
    const comment = await execute(w.ctx, profileCommentsCreateOp, w.aActor, {
      profilePostId: post.id,
      body: "comment",
    });
    const react = (actor: AnyActor, contentType: string, contentId: number) =>
      execute(w.ctx, reactionsSetOp, actor, {
        contentType: contentType as "profile_post",
        contentId,
        reactionTypeId: type.id,
      });
    const reactor = customMember(w.ctx, [...WALL, "reaction.react"]);
    await expect(react(reactor.actor, "profile_post", post.id)).rejects.toThrow(ForbiddenError);
    await expect(react(reactor.actor, "profile_post_comment", comment.id)).rejects.toThrow(
      ForbiddenError,
    );
    setEntry(w.ctx, reactor.groupId, "profilePost.react", 1);
    await react(reactor.actor, "profile_post", post.id);
    await react(reactor.actor, "profile_post_comment", comment.id);
    await react(w.bActor, "profile_post", post.id);
    setEntry(w.ctx, 2, "profilePost.react", 0);
    await expect(react(w.bActor, "profile_post_comment", comment.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  test("an edit leaves no note for a holder of content.editSilently, wall posts and comments alike", async () => {
    const w = world();
    const post = await execute(w.ctx, profilePostsCreateOp, w.aActor, {
      userId: w.a.id,
      body: "wall",
    });
    const comment = await execute(w.ctx, profileCommentsCreateOp, w.aActor, {
      profilePostId: post.id,
      body: "comment",
    });
    const stamps = () => ({
      post: w.ctx.sqlite
        .prepare<{ edited_at: number | null }, [number]>(
          "SELECT edited_at FROM profile_posts WHERE id = ?1",
        )
        .get(post.id)!.edited_at,
      comment: w.ctx.sqlite
        .prepare<{ edited_at: number | null }, [number]>(
          "SELECT edited_at FROM profile_post_comments WHERE id = ?1",
        )
        .get(comment.id)!.edited_at,
    });
    w.ctx.clock.advance(1000);
    await execute(w.ctx, profilePostsUpdateOp, w.aActor, { profilePostId: post.id, body: "x" });
    await execute(w.ctx, profileCommentsUpdateOp, w.aActor, { commentId: comment.id, body: "x" });
    expect(stamps()).toEqual({ post: w.ctx.now(), comment: w.ctx.now() });
    const before = stamps();
    setEntry(w.ctx, 2, "content.editSilently", 1);
    w.ctx.clock.advance(1000);
    await execute(w.ctx, profilePostsUpdateOp, w.aActor, { profilePostId: post.id, body: "y" });
    await execute(w.ctx, profileCommentsUpdateOp, w.aActor, { commentId: comment.id, body: "y" });
    expect(stamps()).toEqual(before);
  });
});

describe("conversations", () => {
  const start = (w: ReturnType<typeof world>, actor: AnyActor, recipients: number[], more = {}) =>
    execute(w.ctx, conversationsCreateOp, actor, {
      title: "Hello",
      recipientIds: recipients,
      body: "first",
      ...more,
    });

  test("conversation.receive: a member without it cannot be added, and the Message flag follows", async () => {
    const w = world();
    const closed = customMember(w.ctx, BASE);
    await expect(start(w, w.aActor, [closed.row.id])).rejects.toThrow(ForbiddenError);
    const talk = await start(w, w.aActor, [w.b.id]);
    await expect(
      execute(w.ctx, conversationsAddParticipantsOp, w.aActor, {
        conversationId: talk.conversation.id,
        userIds: [closed.row.id],
      }),
    ).rejects.toThrow(ForbiddenError);
    const relation = async () =>
      (
        await execute(w.ctx, usersRelationsOp, w.aActor, { userIds: [closed.row.id, w.b.id] })
      ).items.find((item: { userId: number }) => item.userId === closed.row.id)!.canMessage;
    expect(await relation()).toBe(false);
    setEntry(w.ctx, closed.groupId, "conversation.receive", 1);
    expect(await relation()).toBe(true);
    await start(w, w.aActor, [closed.row.id]);
    await execute(w.ctx, conversationsAddParticipantsOp, w.aActor, {
      conversationId: talk.conversation.id,
      userIds: [closed.row.id],
    });
  });

  test("conversation.alwaysInvite: the holder reaches members who ignore them", async () => {
    const w = world();
    await execute(w.ctx, usersIgnoreOp, w.bActor, { userId: w.a.id });
    await expect(start(w, w.aActor, [w.b.id])).rejects.toThrow(ForbiddenError);
    const canMessage = async (actor: AnyActor) =>
      (await execute(w.ctx, usersRelationsOp, actor, { userIds: [w.b.id] })).items[0]!.canMessage;
    expect(await canMessage(w.aActor)).toBe(false);
    setEntry(w.ctx, 2, "conversation.alwaysInvite", 1);
    expect(await canMessage(w.aActor)).toBe(true);
    await start(w, w.aActor, [w.b.id]);
  });

  test("conversation.editOwnTimeLimit: edits close after the minutes, moderators are not held to it", async () => {
    const w = world();
    const talk = await start(w, w.aActor, [w.b.id]);
    const messageId = talk.message.id;
    const edit = (actor: AnyActor, body: string) =>
      execute(w.ctx, conversationsUpdateMessageOp, actor, { messageId, body });
    // The default is unlimited.
    w.ctx.clock.advance(100 * 86_400_000);
    await edit(w.aActor, "months later");
    setEntry(w.ctx, 2, "conversation.editOwnTimeLimit", 10);
    await expect(edit(w.aActor, "too late")).rejects.toThrow(ForbiddenError);
    const fresh = await execute(w.ctx, conversationsReplyOp, w.aActor, {
      conversationId: talk.conversation.id,
      body: "fresh",
    });
    w.ctx.clock.advance(9 * 60_000);
    await execute(w.ctx, conversationsUpdateMessageOp, w.aActor, {
      messageId: fresh.id,
      body: "in time",
    });
    w.ctx.clock.advance(2 * 60_000);
    await expect(
      execute(w.ctx, conversationsUpdateMessageOp, w.aActor, { messageId: fresh.id, body: "late" }),
    ).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, 2, "conversation.editOwnTimeLimit", -1);
    await execute(w.ctx, conversationsUpdateMessageOp, w.aActor, {
      messageId: fresh.id,
      body: "again",
    });
    setEntry(w.ctx, 2, "conversation.editOwnTimeLimit", 0);
    await expect(edit(w.aActor, "none")).rejects.toThrow(ForbiddenError);
    // A moderator of conversations, taking part, edits whenever.
    const mod = userActor(insertUser(w.ctx, { groupId: 4 }));
    await execute(w.ctx, conversationsAddParticipantsOp, w.aActor, {
      conversationId: talk.conversation.id,
      userIds: [(mod as { userId: number }).userId],
    });
    await edit(mod, "moderated");
  });

  test("conversation.attach: files can be added to messages only with it, kept ones stay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-conversation-attach-"));
    const w = world();
    try {
      const storage = createStorage(w.ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
      });
      const text = () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.close();
          },
        });
      const sender = customMember(w.ctx, [
        ...BASE,
        "conversation.start",
        "conversation.reply",
        "conversation.editOwn",
      ]);
      setEntry(w.ctx, sender.groupId, "conversation.maxRecipients", -1);
      const file = await storage.upload(sender.actor, text(), "text/plain");
      await expect(start(w, sender.actor, [w.b.id], { attachmentIds: [file.id] })).rejects.toThrow(
        ForbiddenError,
      );
      const plain = await start(w, sender.actor, [w.b.id]);
      await expect(
        execute(w.ctx, conversationsReplyOp, sender.actor, {
          conversationId: plain.conversation.id,
          body: "with file",
          attachmentIds: [file.id],
        }),
      ).rejects.toThrow(ForbiddenError);
      setEntry(w.ctx, sender.groupId, "conversation.attach", 1);
      const sent = await execute(w.ctx, conversationsReplyOp, sender.actor, {
        conversationId: plain.conversation.id,
        body: "with file",
        attachmentIds: [file.id],
      });
      expect(sent.attachmentCount).toBe(1);
      setEntry(w.ctx, sender.groupId, "conversation.attach", 0);
      // Editing the text while keeping the file, or taking it off, needs nothing.
      await execute(w.ctx, conversationsUpdateMessageOp, sender.actor, {
        messageId: sent.id,
        body: "kept",
        attachmentIds: [file.id],
      });
      const removed = await execute(w.ctx, conversationsUpdateMessageOp, sender.actor, {
        messageId: sent.id,
        body: "removed",
        attachmentIds: [],
      });
      expect(removed.attachmentCount).toBe(0);
    } finally {
      w.ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("conversation.react: reacting to a message needs it as well as reaction.react", async () => {
    const w = world();
    const type = await execute(w.ctx, reactionTypesCreateOp, w.adminActor, {
      title: "Like",
      emoji: "+",
      score: 1,
      position: 0,
    });
    const talk = await start(w, w.aActor, [w.b.id]);
    const react = () =>
      execute(w.ctx, reactionsSetOp, w.bActor, {
        contentType: "conversation_message",
        contentId: talk.message.id,
        reactionTypeId: type.id,
      });
    await react();
    setEntry(w.ctx, 2, "conversation.react", 0);
    const other = await start(w, w.aActor, [w.b.id]);
    await expect(
      execute(w.ctx, reactionsSetOp, w.bActor, {
        contentType: "conversation_message",
        contentId: other.message.id,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("content.editSilently: a conversation edit leaves no note for a holder", async () => {
    const w = world();
    const talk = await start(w, w.aActor, [w.b.id]);
    const editedAt = () =>
      w.ctx.sqlite
        .prepare<{ edited_at: number | null }, [number]>(
          "SELECT edited_at FROM conversation_messages WHERE id = ?1",
        )
        .get(talk.message.id)!.edited_at;
    w.ctx.clock.advance(1000);
    await execute(w.ctx, conversationsUpdateMessageOp, w.aActor, {
      messageId: talk.message.id,
      body: "one",
    });
    const stamped = editedAt();
    expect(stamped).toBe(w.ctx.now());
    setEntry(w.ctx, 2, "content.editSilently", 1);
    w.ctx.clock.advance(1000);
    await execute(w.ctx, conversationsUpdateMessageOp, w.aActor, {
      messageId: talk.message.id,
      body: "two",
    });
    expect(editedAt()).toBe(stamped);
  });
});
