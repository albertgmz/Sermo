import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { PERMISSIONS } from "../../permissions";
import { bookmarksSetOp } from "../bookmarks";
import { feedListOp } from "../feed/feed";
import {
  nodesGetOp,
  nodesListOp,
  postsCreateOp,
  postsGetOp,
  postsListOp,
  postsUpdateOp,
  threadsCreateOp,
  threadsGetOp,
  threadsListOp,
} from "../forums";
import { operations as imageOperations } from "../images";
import { usersListOp } from "../members/directory";
import { listPostRevisions } from "../moderation";
import { profilesGetOp } from "../profiles";
import { reactionsListOp } from "../reactions";
import { searchQueryOp } from "../search";
import { usersListFollowingOp } from "../social";
import { createStorage, localDriver } from "../storage";

type Ctx = ReturnType<typeof createTestContext>;

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

/** A custom group holding exactly the given permissions (and a member in it). */
function customMember(ctx: Ctx, grants: string[], storage = true) {
  const groupId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Custom ' || abs(random() % 100000), 10) RETURNING id",
    )
    .get()!.id;
  for (const key of grants) setEntry(ctx, groupId, key, 1);
  if (storage) {
    setEntry(ctx, groupId, "attachment.storageQuota", 100_000_000);
    setEntry(ctx, groupId, "attachment.maxFileSize", -1);
  }
  const row = insertUser(ctx, { groupId });
  return { groupId, row, actor: userActor(row) };
}

function world() {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const member = insertUser(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  return {
    ctx,
    node,
    member,
    admin,
    memberActor: userActor(member),
    adminActor: userActor(admin),
  };
}

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const stream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(png);
      controller.close();
    },
  });

describe("registry shapes", () => {
  test("every permission of this group has a built-in default that matches its purpose", () => {
    for (const id of [
      "site.view",
      "member.viewList",
      "reaction.viewList",
      "member.viewFollowing",
      "profilePost.view",
    ] as const)
      expect(PERMISSIONS[id].defaults).toMatchObject({ guest: "allow", registered: "allow" });
    for (const id of [
      "profile.uploadAvatar",
      "profile.uploadCover",
      "bookmark.create",
      "conversation.receive",
      "conversation.attach",
      "forum.viewOwnHistory",
    ] as const)
      expect(PERMISSIONS[id].defaults).toMatchObject({ registered: "allow", admin: "allow" });
    expect(PERMISSIONS["content.editSilently"].defaults).toEqual({ admin: "allow" });
    expect(PERMISSIONS["profile.renameNeedsApproval"].defaults).toEqual({ admin: "never" });
  });
});

describe("site.view", () => {
  test("a guest or a group without it cannot open the site; everyone else can", async () => {
    const w = world();
    const made = await execute(w.ctx, threadsCreateOp, w.memberActor, {
      nodeId: w.node.id,
      title: "T",
      body: "b",
    });
    const reads: ((actor: ReturnType<typeof userActor> | typeof GUEST) => Promise<unknown>)[] = [
      (actor) => execute(w.ctx, nodesListOp, actor, {}),
      (actor) => execute(w.ctx, nodesGetOp, actor, { nodeId: w.node.id }),
      (actor) => execute(w.ctx, threadsListOp, actor, { nodeId: w.node.id }),
      (actor) => execute(w.ctx, threadsGetOp, actor, { threadId: made.thread.id }),
      (actor) => execute(w.ctx, postsListOp, actor, { threadId: made.thread.id }),
      (actor) => execute(w.ctx, postsGetOp, actor, { postId: made.post.id }),
      (actor) => execute(w.ctx, feedListOp, actor, { scope: "latest" }),
      (actor) => execute(w.ctx, searchQueryOp, actor, { q: "word" }),
      (actor) => execute(w.ctx, profilesGetOp, actor, { userId: w.member.id }),
      (actor) => execute(w.ctx, usersListOp, actor, {}),
    ];
    for (const read of reads) {
      await read(GUEST);
      await read(w.memberActor);
    }

    setEntry(w.ctx, 1, "site.view", -1);
    for (const read of reads) await expect(read(GUEST)).rejects.toThrow(UnauthenticatedError);
    for (const read of reads) await read(w.memberActor);

    const bare = customMember(w.ctx, [
      "node.view",
      "profile.view",
      "search.use",
      "member.viewList",
    ]);
    for (const read of reads) await expect(read(bare.actor)).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, bare.groupId, "site.view", 1);
    for (const read of reads) await read(bare.actor);
    for (const read of reads) await read(w.adminActor);
  });
});

describe("member.viewList", () => {
  test("the member list needs the permission", async () => {
    const w = world();
    const viewer = customMember(w.ctx, ["site.view", "profile.view"]);
    await expect(execute(w.ctx, usersListOp, viewer.actor, {})).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, viewer.groupId, "member.viewList", 1);
    expect((await execute(w.ctx, usersListOp, viewer.actor, {})).items.length).toBeGreaterThan(0);
    await expect(execute(w.ctx, usersListOp, GUEST, {})).resolves.toBeTruthy();
    setEntry(w.ctx, 1, "member.viewList", -1);
    await expect(execute(w.ctx, usersListOp, GUEST, {})).rejects.toThrow(ForbiddenError);
  });
});

describe("avatar and cover", () => {
  test("setting and uploading a picture needs its permission; taking it off does not", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-picture-perms-"));
    const w = world();
    try {
      const storage = createStorage(w.ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
      });
      const setAvatar = imageOperations.find((op) => op.name === "images.setAvatar")!;
      const holder = customMember(w.ctx, ["profile.uploadAvatar"]);
      const avatar = await storage.upload(holder.actor, stream(), "image/png", "avatar");
      await expect(storage.upload(holder.actor, stream(), "image/png", "cover")).rejects.toThrow(
        ForbiddenError,
      );
      await execute(w.ctx, setAvatar, holder.actor, { fileId: avatar.id });

      const without = customMember(w.ctx, []);
      await expect(storage.upload(without.actor, stream(), "image/png", "avatar")).rejects.toThrow(
        ForbiddenError,
      );
      // A picture set before the permission went can still be taken off.
      w.ctx.sqlite
        .prepare("UPDATE permission_entries SET value = 0 WHERE group_id = ?1")
        .run(holder.groupId);
      w.ctx.sqlite
        .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
        .run();
      await expect(execute(w.ctx, setAvatar, holder.actor, { fileId: avatar.id })).rejects.toThrow(
        ForbiddenError,
      );
      await execute(w.ctx, setAvatar, holder.actor, { fileId: null });
      expect(
        w.ctx.sqlite
          .prepare<{ avatar_file_id: number | null }, [number]>(
            "SELECT avatar_file_id FROM users WHERE id = ?1",
          )
          .get(holder.row.id)!.avatar_file_id,
      ).toBeNull();
      // Guests cannot upload at all.
      await expect(storage.upload(GUEST, stream(), "image/png", "avatar")).rejects.toThrow(
        UnauthenticatedError,
      );
    } finally {
      w.ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("a member whose group has no cover permission is refused when setting one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-cover-perms-"));
    const w = world();
    try {
      const storage = createStorage(w.ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
      });
      const setCover = imageOperations.find((op) => op.name === "images.setCover")!;
      const uploaded = await storage.upload(w.memberActor, stream(), "image/png", "cover");
      setEntry(w.ctx, 2, "profile.uploadCover", 0);
      await expect(
        execute(w.ctx, setCover, w.memberActor, { fileId: uploaded.id }),
      ).rejects.toThrow(ForbiddenError);
      setEntry(w.ctx, 2, "profile.uploadCover", 1);
      await execute(w.ctx, setCover, w.memberActor, { fileId: uploaded.id });
    } finally {
      w.ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe("attachment.maxFileSize", () => {
  test("a member's own limit can only lower the site's; -1 leaves the site's and 0 allows no file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-file-size-"));
    const w = world();
    try {
      const storage = createStorage(w.ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
        maxBytes: 1_000_000,
      });
      const text = (bytes: number) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("a".repeat(bytes)));
            controller.close();
          },
        });
      const limited = customMember(w.ctx, []);
      setEntry(w.ctx, limited.groupId, "attachment.storageQuota", 10_000_000);
      setEntry(w.ctx, limited.groupId, "attachment.maxFileSize", 1000);
      await storage.upload(limited.actor, text(1000), "text/plain");
      await expect(storage.upload(limited.actor, text(1001), "text/plain")).rejects.toThrow(
        "File exceeds your upload limit of 1000 bytes.",
      );
      // A limit above the site's changes nothing: the site's message and limit apply.
      setEntry(w.ctx, limited.groupId, "attachment.maxFileSize", 5_000_000);
      await expect(storage.upload(limited.actor, text(1_000_001), "text/plain")).rejects.toThrow(
        "File exceeds upload limit.",
      );
      setEntry(w.ctx, limited.groupId, "attachment.maxFileSize", -1);
      await storage.upload(limited.actor, text(2000), "text/plain");
      setEntry(w.ctx, limited.groupId, "attachment.maxFileSize", 0);
      await expect(storage.upload(limited.actor, text(1), "text/plain")).rejects.toThrow(
        "File exceeds your upload limit of 0 bytes.",
      );
      // A banned member resolves to 0 too.
      w.ctx.sqlite
        .prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1")
        .run(limited.row.id);
      setEntry(w.ctx, limited.groupId, "attachment.maxFileSize", -1);
      await expect(storage.upload(limited.actor, text(1), "text/plain")).rejects.toThrow();
    } finally {
      w.ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe("integer permissions across groups", () => {
  test("the most permissive group wins: -1 beats any number, a larger number beats a smaller, 0 is least", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-file-merge-"));
    const w = world();
    try {
      const storage = createStorage(w.ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
        maxBytes: 1_000_000,
      });
      const text = (bytes: number) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("a".repeat(bytes)));
            controller.close();
          },
        });
      const first = customMember(w.ctx, []);
      const second = customMember(w.ctx, []);
      setEntry(w.ctx, first.groupId, "attachment.maxFileSize", 1000);
      setEntry(w.ctx, second.groupId, "attachment.maxFileSize", 0);
      const join_ = (groupId: number) =>
        w.ctx.sqlite
          .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
          .run(first.row.id, groupId);
      join_(second.groupId);
      await storage.upload(first.actor, text(1000), "text/plain");
      await expect(storage.upload(first.actor, text(1001), "text/plain")).rejects.toThrow(
        "File exceeds your upload limit of 1000 bytes.",
      );
      setEntry(w.ctx, second.groupId, "attachment.maxFileSize", 2000);
      await storage.upload(first.actor, text(2000), "text/plain");
      setEntry(w.ctx, second.groupId, "attachment.maxFileSize", -1);
      await storage.upload(first.actor, text(5000), "text/plain");
    } finally {
      w.ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe("bookmark.create", () => {
  test("adding needs the permission, removing does not", async () => {
    const w = world();
    const author = userActor(insertUser(w.ctx));
    const made = await execute(w.ctx, threadsCreateOp, author, {
      nodeId: w.node.id,
      title: "T",
      body: "b",
    });
    const input = { contentType: "thread" as const, contentId: made.thread.id };
    await execute(w.ctx, bookmarksSetOp, w.memberActor, { ...input, bookmarked: true });
    setEntry(w.ctx, 2, "bookmark.create", 0);
    await expect(
      execute(w.ctx, bookmarksSetOp, w.memberActor, { ...input, bookmarked: true }),
    ).rejects.toThrow(ForbiddenError);
    await execute(w.ctx, bookmarksSetOp, w.memberActor, { ...input, bookmarked: false });
    await expect(
      execute(w.ctx, bookmarksSetOp, GUEST, { ...input, bookmarked: true }),
    ).rejects.toThrow(UnauthenticatedError);
    const holder = customMember(w.ctx, ["bookmark.create", "node.view", "site.view"]);
    await execute(w.ctx, bookmarksSetOp, holder.actor, { ...input, bookmarked: true });
  });
});

describe("reaction.viewList", () => {
  test("who reacted needs the permission for guests, members and custom groups", async () => {
    const w = world();
    const author = userActor(insertUser(w.ctx));
    const made = await execute(w.ctx, threadsCreateOp, author, {
      nodeId: w.node.id,
      title: "T",
      body: "b",
    });
    const list = (actor: Parameters<typeof execute>[2]) =>
      execute(w.ctx, reactionsListOp, actor, {
        contentType: "post",
        contentId: made.post.id,
        limit: 20,
      });
    await list(GUEST);
    await list(w.memberActor);
    setEntry(w.ctx, 1, "reaction.viewList", -1);
    await expect(list(GUEST)).rejects.toThrow(ForbiddenError);
    const bare = customMember(w.ctx, ["node.view", "site.view"]);
    await expect(list(bare.actor)).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, bare.groupId, "reaction.viewList", 1);
    await list(bare.actor);
    await list(w.memberActor);
  });
});

describe("member.viewFollowing", () => {
  test("others need the permission to read whom a member follows; a member reads their own", async () => {
    const w = world();
    const other = insertUser(w.ctx);
    const followers = customMember(w.ctx, ["profile.view", "site.view"]);
    const list = (actor: Parameters<typeof execute>[2], userId: number) =>
      execute(w.ctx, usersListFollowingOp, actor, { userId, limit: 20 });
    await expect(list(followers.actor, other.id)).rejects.toThrow(ForbiddenError);
    await list(followers.actor, followers.row.id);
    setEntry(w.ctx, followers.groupId, "member.viewFollowing", 1);
    await list(followers.actor, other.id);
    await list(w.memberActor, other.id);
    setEntry(w.ctx, 1, "member.viewFollowing", -1);
    await expect(list(GUEST, other.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("content.editSilently and forum.viewOwnHistory", () => {
  const editedAt = (ctx: Ctx, postId: number) =>
    ctx.sqlite
      .prepare<{ edited_at: number | null }, [number]>("SELECT edited_at FROM posts WHERE id = ?1")
      .get(postId)!.edited_at;

  test("an edit leaves the edited note unless the editor holds the permission", async () => {
    const w = world();
    const made = await execute(w.ctx, threadsCreateOp, w.memberActor, {
      nodeId: w.node.id,
      title: "T",
      body: "first",
    });
    w.ctx.clock.advance(1000);
    await execute(w.ctx, postsUpdateOp, w.memberActor, { postId: made.post.id, body: "second" });
    expect(editedAt(w.ctx, made.post.id)).toBe(w.ctx.now());
    const stamped = editedAt(w.ctx, made.post.id);

    setEntry(w.ctx, 2, "content.editSilently", 1);
    w.ctx.clock.advance(1000);
    await execute(w.ctx, postsUpdateOp, w.memberActor, { postId: made.post.id, body: "third" });
    expect(editedAt(w.ctx, made.post.id)).toBe(stamped);
    // The earlier text is still kept.
    const revisions = w.ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM post_revisions WHERE post_id = ?1",
      )
      .get(made.post.id)!;
    expect(revisions.n).toBe(2);

    // A first edit by a silent editor leaves no note at all.
    const fresh = await execute(w.ctx, postsCreateOp, w.memberActor, {
      threadId: made.thread.id,
      body: "reply",
    });
    await execute(w.ctx, postsUpdateOp, w.memberActor, { postId: fresh.id, body: "reply 2" });
    expect(editedAt(w.ctx, fresh.id)).toBeNull();
  });

  test("an author reads the history of their own posts only with the permission", async () => {
    const w = world();
    const made = await execute(w.ctx, threadsCreateOp, w.memberActor, {
      nodeId: w.node.id,
      title: "T",
      body: "first",
    });
    await execute(w.ctx, postsUpdateOp, w.memberActor, { postId: made.post.id, body: "second" });
    const other = userActor(insertUser(w.ctx));
    const history = (actor: Parameters<typeof listPostRevisions>[1]) =>
      listPostRevisions(w.ctx, actor, made.post.id);
    expect(history(w.memberActor).items).toHaveLength(1);
    expect(() => history(other)).toThrow(NotFoundError);
    expect(history(w.adminActor).items).toHaveLength(1);
    setEntry(w.ctx, 2, "forum.viewOwnHistory", 0);
    expect(() => history(w.memberActor)).toThrow(NotFoundError);
    expect(() => history(GUEST)).toThrow();
    const holderGroupMember = customMember(w.ctx, ["node.view", "site.view"]);
    expect(() => history(holderGroupMember.actor)).toThrow(NotFoundError);
  });

  test("the author sees only their own edits, and only while the post is visible to them", async () => {
    const w = world();
    const made = await execute(w.ctx, threadsCreateOp, w.memberActor, {
      nodeId: w.node.id,
      title: "T",
      body: "first",
    });
    await execute(w.ctx, postsUpdateOp, w.memberActor, { postId: made.post.id, body: "second" });
    // An administrator edits it silently: that revision is staff's to see.
    await execute(w.ctx, postsUpdateOp, w.adminActor, { postId: made.post.id, body: "moderated" });
    const editors = (actor: Parameters<typeof listPostRevisions>[1]) =>
      listPostRevisions(w.ctx, actor, made.post.id).items.map(
        (item) => (item as unknown as { editor_id: number }).editor_id,
      );
    expect(editors(w.memberActor)).toEqual([w.member.id]);
    expect(editors(w.adminActor)).toHaveLength(2);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(made.post.id);
    expect(() => listPostRevisions(w.ctx, w.memberActor, made.post.id)).toThrow(NotFoundError);
    expect(editors(w.adminActor)).toHaveLength(2);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'visible' WHERE id = ?1").run(made.post.id);
    // Moved to a forum the author cannot open.
    const hidden = insertNode(w.ctx, {});
    invalidate(w.ctx, "node_tree");
    setEntry(w.ctx, 2, "node.view", -1);
    w.ctx.sqlite
      .prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2")
      .run(hidden.id, made.thread.id);
    expect(() => listPostRevisions(w.ctx, w.memberActor, made.post.id)).toThrow(NotFoundError);
  });
});
