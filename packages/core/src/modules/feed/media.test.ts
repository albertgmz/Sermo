import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { UnauthenticatedError, ValidationError } from "../../errors";
import { encodeCursor } from "../../pagination";
import { setEntry } from "../permissions/group-fixture";
import { type World, world } from "./fixtures.test";
import { mediaSql } from "./media";

// biome-ignore lint/suspicious/noExplicitAny: media items are checked field by field below
type Item = Record<string, any>;

/** Attaches a new file to a post, a wall post or a message; returns the attachment id. */
function attach(
  w: World,
  type: "post" | "profile_post" | "conversation_message",
  contentId: number,
  mime = "image/png",
): number {
  w.ctx.clock.advance(1000);
  const file = Number(
    w.ctx.sqlite
      .prepare(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('fake', ?1, 4, ?2, 'hash', ?3, 'attachment', 'public', ?4)",
      )
      .run(crypto.randomUUID(), mime, w.aliceUser.id, w.ctx.now()).lastInsertRowid,
  );
  return Number(
    w.ctx.sqlite
      .prepare(
        "INSERT INTO attachments (file_id, content_type, content_id, position, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
      )
      .run(file, type, contentId, w.ctx.now()).lastInsertRowid,
  );
}

const ids = (page: { items: Item[] }) => page.items.map((item) => item.id);

async function all(w: World, actor: Parameters<World["call"]>[1], limit = 20) {
  const found: Item[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await w.call("media.list", actor, { limit, ...(cursor ? { cursor } : {}) });
    found.push(...page.items);
    if (page.nextCursor === null) return found;
    cursor = page.nextCursor;
  }
  throw new Error("the listing never ended");
}

describe("media.list", () => {
  test("lists the newest pictures of posts and wall posts, with where they are", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Photos");
    const reply = await w.reply(w.bob, t.thread.id, "more");
    const wall = await w.wall(w.carol, w.aliceUser.id, "a wall post");
    const a = attach(w, "post", t.post.id);
    const b = attach(w, "post", reply.id);
    const c = attach(w, "profile_post", wall.id);
    const page = await w.call("media.list", w.alice, {});
    expect(page.nextCursor).toBeNull();
    expect(ids(page)).toEqual([c, b, a]);
    expect(page.items[0]).toMatchObject({
      type: "profilePost",
      profilePostId: wall.id,
      profileUserId: w.aliceUser.id,
    });
    expect(page.items[1]).toMatchObject({
      type: "post",
      postId: reply.id,
      threadId: t.thread.id,
      threadTitle: "Photos",
      position: 1,
    });
    expect(page.items[2]).toMatchObject({ type: "post", postId: t.post.id, position: 0 });
    expect(page.items[2].file).toMatchObject({ contentType: "image/png" });
    expect(page.items[2].file.url).toBe(`/api/v1/files/${page.items[2].file.fileId}`);
  });

  test("lists only images, and never what is attached to a conversation message", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Files");
    const image = attach(w, "post", t.post.id, "image/webp");
    attach(w, "post", t.post.id, "application/pdf");
    attach(w, "post", t.post.id, "text/plain");
    attach(w, "conversation_message", 1);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([image]);
  });

  test("shows a guest the pictures of the forums a guest can open, and nothing else", async () => {
    const w = world();
    const open = await w.thread(w.alice, w.open.id, "Open");
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    const shown = attach(w, "post", open.post.id);
    const hidden = attach(w, "post", secret.post.id);
    expect(ids(await w.call("media.list", GUEST, {}))).toEqual([shown]);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([shown]);
    expect(ids(await w.call("media.list", w.admin, {}))).toEqual([hidden, shown]);
  });

  test("leaves out deleted posts, deleted threads and posts awaiting approval", async () => {
    const w = world();
    const kept = await w.thread(w.alice, w.open.id, "Kept");
    const gone = await w.thread(w.alice, w.open.id, "Gone");
    const removed = await w.reply(w.bob, kept.thread.id, "removed reply");
    const keptImage = attach(w, "post", kept.post.id);
    attach(w, "post", gone.post.id);
    attach(w, "post", removed.id);
    await w.call("threads.delete", w.mod, { threadId: gone.thread.id, reason: "x", notify: false });
    await w.call("posts.delete", w.mod, { postId: removed.id, reason: "x", notify: false });
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const waiting = await w.reply(w.carol, kept.thread.id, "waiting");
    expect(waiting.state).toBe("moderated");
    attach(w, "post", waiting.id);
    for (const viewer of [GUEST, w.carol, w.alice])
      expect(ids(await w.call("media.list", viewer, {}))).toEqual([keptImage]);
  });

  test("leaves out the pictures of members the viewer ignores", async () => {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Alice");
    const theirs = await w.thread(w.bob, w.open.id, "Bob");
    const a = attach(w, "post", mine.post.id);
    const b = attach(w, "post", theirs.post.id);
    await w.call("users.block", w.carol, { userId: w.bobUser.id });
    expect(ids(await w.call("media.list", w.carol, {}))).toEqual([a]);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([b, a]);
  });

  test("wall pictures follow the profile rules: a private profile hides them", async () => {
    const w = world();
    const wall = await w.wall(w.bob, w.carolUser.id, "for carol");
    const image = attach(w, "profile_post", wall.id);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([image]);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.carolUser.id);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([]);
    expect(ids(await w.call("media.list", w.carol, {}))).toEqual([image]);
  });

  test("a forum where the viewer may not see attachments lists none of its pictures", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Photos");
    const image = attach(w, "post", t.post.id);
    const definition = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM permission_definitions WHERE key = 'forum.viewAttachments'",
      )
      .get()!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, 1, 0, -1)",
      )
      .run(definition, w.open.id);
    invalidate(w.ctx, "permissions");
    // Guests are refused the file, so they are not shown it; members still are.
    expect(ids(await w.call("media.list", GUEST, {}))).toEqual([]);
    expect(ids(await w.call("media.list", w.bob, {}))).toEqual([image]);
  });

  test("a forum whose threads others may not open lists only the viewer's own pictures", async () => {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs");
    const own = attach(w, "post", mine.post.id);
    const other = attach(w, "post", theirs.post.id);
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewOthers", -1, w.open.id);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([own]);
    expect(ids(await w.call("media.list", GUEST, {}))).toEqual([]);
    expect(ids(await w.call("media.list", w.mod, {}))).toEqual([other, own]);
  });

  test("a forum whose posts others may not read lists only the pictures the viewer wrote", async () => {
    const w = world();
    const t = await w.thread(w.bob, w.open.id, "Theirs");
    const reply = await w.reply(w.alice, t.thread.id, "Alice reply");
    const other = attach(w, "post", t.post.id);
    const own = attach(w, "post", reply.id);
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewContent", -1, w.open.id);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([own]);
    expect(ids(await w.call("media.list", GUEST, {}))).toEqual([]);
    expect(ids(await w.call("media.list", w.mod, {}))).toEqual([own, other]);
  });

  test("a guest the site is closed to is asked to sign in, and sees no pictures", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Photos");
    attach(w, "post", t.post.id);
    setEntry(w.ctx, 1, "site.view", -1);
    await expect(w.call("media.list", GUEST, {})).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("leaves out the pictures of a thread merged away, moved to a hidden forum, or whose file is deleted", async () => {
    const w = world();
    const kept = await w.thread(w.alice, w.open.id, "Kept");
    const merged = await w.thread(w.alice, w.open.id, "Merged");
    const moved = await w.thread(w.alice, w.open.id, "Moved");
    const keptImage = attach(w, "post", kept.post.id);
    attach(w, "post", merged.post.id);
    attach(w, "post", moved.post.id);
    const lost = attach(w, "post", kept.post.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET merged_into_id = ?1 WHERE id = ?2")
      .run(kept.thread.id, merged.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2")
      .run(w.secret.id, moved.thread.id);
    w.ctx.sqlite
      .prepare(
        "UPDATE files SET deleted_at = 1 WHERE id = (SELECT file_id FROM attachments WHERE id = ?1)",
      )
      .run(lost);
    expect(ids(await w.call("media.list", GUEST, {}))).toEqual([keptImage]);
  });

  test("a deleted wall post, or one by an ignored member, is not listed", async () => {
    const w = world();
    const gone = await w.wall(w.bob, w.carolUser.id, "removed");
    const ignored = await w.wall(w.bob, w.carolUser.id, "by bob");
    const fine = await w.wall(w.alice, w.carolUser.id, "by alice");
    attach(w, "profile_post", gone.id);
    const byBob = attach(w, "profile_post", ignored.id);
    const byAlice = attach(w, "profile_post", fine.id);
    w.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'deleted' WHERE id = ?1").run(gone.id);
    for (const viewer of [w.carol, w.admin])
      expect(ids(await w.call("media.list", viewer, {}))).toEqual([byAlice, byBob]);
    await w.call("users.block", w.carol, { userId: w.bobUser.id });
    expect(ids(await w.call("media.list", w.carol, {}))).toEqual([byAlice]);
  });

  test("a viewer without profile.view sees no wall pictures, and keeps the forum ones", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Photos");
    const wall = await w.wall(w.bob, w.carolUser.id, "for carol");
    const post = attach(w, "post", t.post.id);
    const onWall = attach(w, "profile_post", wall.id);
    expect(ids(await w.call("media.list", w.alice, {}))).toEqual([onWall, post]);
    const definition = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM permission_definitions WHERE key = 'profile.view'",
      )
      .get()!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 1, 0, -1), (?1, 0, 2, 0, -1) ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = -1",
      )
      .run(definition);
    invalidate(w.ctx, "permissions");
    for (const viewer of [GUEST, w.alice])
      expect(ids(await w.call("media.list", viewer, {}))).toEqual([post]);
  });

  test("a post awaiting approval is not listed, for its author either", async () => {
    const w = world();
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const t = await w.thread(w.alice, w.open.id, "Held");
    const reply = await w.reply(w.carol, t.thread.id, "waiting");
    expect(reply.state).toBe("moderated");
    attach(w, "post", reply.id);
    for (const viewer of [w.carol, w.alice, GUEST])
      expect(ids(await w.call("media.list", viewer, {}))).toEqual([]);
  });

  test("pages by attachment, newest first, with no repeats and no gaps", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Many");
    const made = Array.from({ length: 7 }, () => attach(w, "post", t.post.id));
    const first = await w.call("media.list", GUEST, { limit: 3 });
    expect(ids(first)).toEqual(made.slice(-3).reverse());
    expect(first.nextCursor).not.toBeNull();
    expect((await all(w, GUEST, 3)).map((item) => item.id)).toEqual([...made].reverse());
  });

  test("a stretch of attachments that are not shown makes a short page with a cursor to go on", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Old picture");
    const old = attach(w, "post", t.post.id);
    // 450 newer attachments that are not pictures: more than one request examines.
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO attachments (file_id, content_type, content_id, position, created_at) VALUES (?1, 'post', ?2, 0, ?3)",
    );
    const file = w.ctx.sqlite.prepare(
      "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('fake', ?1, 4, 'application/pdf', 'hash', ?2, 'attachment', 'public', ?3) RETURNING id",
    );
    for (let i = 0; i < 450; i++) {
      const id = (file.get(crypto.randomUUID(), w.aliceUser.id, w.ctx.now()) as { id: number }).id;
      insert.run(id, t.post.id, w.ctx.now());
    }
    const first = await w.call("media.list", GUEST, { limit: 5 });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await w.call("media.list", GUEST, { limit: 5, cursor: first.nextCursor });
    expect(ids(second)).toEqual([old]);
    expect(second.nextCursor).toBeNull();
  });

  test("refuses a cursor that is not its own", async () => {
    const w = world();
    await expect(
      w.call("media.list", GUEST, { cursor: encodeCursor(["x"]) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("the newest read seeks its index even when the statistics say one kind holds every row", () => {
    const w = world();
    // The shape of a site whose attachments are all one kind: left to itself the planner then
    // walks the primary key and filters by kind, reading every row when the other kind has none.
    w.ctx.sqlite.run("ANALYZE");
    w.ctx.sqlite.run(
      "INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES ('attachments', 'attachments_type_id', '300000 300000 1')",
    );
    // Reads the statistics again, as a new connection does.
    w.ctx.sqlite.run("ANALYZE sqlite_schema");
    for (const type of ["post", "profile_post"])
      expect(
        w.ctx.sqlite
          .prepare<{ detail: string }, [string, number, number]>(
            `EXPLAIN QUERY PLAN ${mediaSql.newest}`,
          )
          .all(type, Number.MAX_SAFE_INTEGER, 40)
          .map((step) => step.detail),
      ).toEqual([
        expect.stringContaining("USING INDEX attachments_type_id (content_type=? AND id<?)"),
      ]);
  });

  test("the file read builds no Bloom filter when the statistics say no file has a parent", () => {
    const w = world();
    // As on a site whose files are all originals: see the attachments page read's test.
    w.ctx.sqlite.run("ANALYZE");
    w.ctx.sqlite.run(
      "DELETE FROM sqlite_stat1 WHERE tbl IN ('files', 'attachments'); INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES ('files', 'files_variant', '300000 300000 300000'), ('attachments', 'attachments_content', '300000 300000 1 1')",
    );
    w.ctx.sqlite.run("ANALYZE sqlite_schema");
    expect(
      w.ctx.sqlite
        .prepare<{ detail: string }, [string, string]>(`EXPLAIN QUERY PLAN ${mediaSql.files}`)
        .all("[1]", '["image/png"]')
        .map((step) => step.detail)
        .filter((detail) => detail.includes("BLOOM FILTER ON")),
    ).toEqual([]);
  });

  test("each read is one index seek", () => {
    const w = world();
    for (const type of ["post", "profile_post"])
      expectNoTableScan(w.ctx, mediaSql.newest, [type, Number.MAX_SAFE_INTEGER, 40]);
    expectNoTableScan(w.ctx, mediaSql.files, ["[1]", '["image/png"]']);
    expectNoTableScan(w.ctx, mediaSql.posts, ["[1]"]);
    expectNoTableScan(w.ctx, mediaSql.walls, ["[1]"]);
  });
});
