import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { invalidate } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { inUseSql } from "../appearance/store";
import {
  forumSql,
  nodesCreateOp,
  nodesListOp,
  nodesUpdateOp,
  postsCreateOp,
  threadsCreateOp,
  threadsGetOp,
  threadsListOp,
  threadsSetLockedOp,
  threadsUpdateOp,
} from "./index";
import { PREFIX_LIMIT, prefixSql, TAB_LIMIT } from "./prefixes";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const mod = userActor(insertUser(ctx, { groupId: 3 }));
  const authorUser = insertUser(ctx);
  const author = userActor(authorUser);
  const other = userActor(insertUser(ctx));
  const category = insertNode(ctx, { type: "category" });
  const forum = insertNode(ctx, { parentId: category.id });
  invalidate(ctx, "node_tree");
  const color = (kind = "prefix", active = 1) =>
    ctx.sqlite
      .prepare<{ id: number }, [string, number]>(
        "SELECT id FROM palette_colors WHERE kind = ?1 AND is_active = ?2 ORDER BY position LIMIT 1",
      )
      .get(kind, active)!.id;
  const prefix = (label: string, extra: object = {}) =>
    run(ctx, "threadPrefixes.create", admin, { label, colorId: color(), ...extra });
  const thread = async (actor = author, extra: object = {}) =>
    (
      await execute(ctx, threadsCreateOp, actor, {
        nodeId: forum.id,
        title: "Title",
        body: "Opening *post* body",
        ...extra,
      })
    ).thread;
  return { ctx, admin, mod, author, authorUser, other, category, forum, color, prefix, thread };
}

describe("thread prefixes", () => {
  test("anyone lists the active ones, an administrator sees them all; writes need admin.nodes", async () => {
    const s = setup();
    const live = await s.prefix("Solved");
    const hidden = await s.prefix("Old", { isActive: false, position: 5 });
    expect(live).toMatchObject({ label: "Solved", icon: "", isActive: true, color: "#60a5fa" });
    for (const actor of [GUEST, s.author, s.mod]) {
      const listed = await run(s.ctx, "threadPrefixes.list", actor, {});
      expect(listed.items.map((p: { id: number }) => p.id)).toEqual([live.id]);
    }
    const all = await run(s.ctx, "threadPrefixes.list", s.admin, {});
    expect(all.items.map((p: { id: number }) => p.id)).toEqual([live.id, hidden.id]);
    const input = { label: "X", colorId: s.color() };
    await expect(run(s.ctx, "threadPrefixes.create", GUEST, input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [s.author, s.mod]) {
      await expect(run(s.ctx, "threadPrefixes.create", actor, input)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        run(s.ctx, "threadPrefixes.update", actor, { prefixId: live.id, label: "Y" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        run(s.ctx, "threadPrefixes.delete", actor, { prefixId: live.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const logged = s.ctx.sqlite
      .prepare<{ action: string }, []>("SELECT action FROM moderator_log ORDER BY id")
      .all()
      .map((row) => row.action);
    expect(logged).toEqual(["threadPrefix.create", "threadPrefix.create"]);
  });

  test("the colour must be an active colour of the prefix palette, on create and when it changes", async () => {
    const s = setup();
    const accent = s.color("accent");
    await expect(
      run(s.ctx, "threadPrefixes.create", s.admin, { label: "A", colorId: accent }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(s.ctx, "threadPrefixes.create", s.admin, { label: "A", colorId: 99_999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const retired = s.color("prefix");
    s.ctx.sqlite.prepare("UPDATE palette_colors SET is_active = 0 WHERE id = ?1").run(retired);
    invalidate(s.ctx, "appearance");
    await expect(
      run(s.ctx, "threadPrefixes.create", s.admin, { label: "A", colorId: retired }),
    ).rejects.toBeInstanceOf(ValidationError);
    const made = await run(s.ctx, "threadPrefixes.create", s.admin, {
      label: "A",
      colorId: s.color(),
    });
    await expect(
      run(s.ctx, "threadPrefixes.update", s.admin, { prefixId: made.id, colorId: accent }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(s.ctx, "threadPrefixes.update", s.admin, { prefixId: made.id, colorId: retired }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Sending the colour it already has is not a change, even if that colour has since retired.
    s.ctx.sqlite.prepare("UPDATE palette_colors SET is_active = 0 WHERE id = ?1").run(made.colorId);
    invalidate(s.ctx, "appearance");
    const same = await run(s.ctx, "threadPrefixes.update", s.admin, {
      prefixId: made.id,
      colorId: made.colorId,
      label: "B",
    });
    expect(same.label).toBe("B");
    await expect(
      run(s.ctx, "threadPrefixes.update", s.admin, { prefixId: 99_999, label: "B" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a site holds at most 100", async () => {
    const s = setup();
    const colorId = s.color();
    for (let i = 0; i < PREFIX_LIMIT; i++)
      s.ctx.sqlite
        .prepare(
          "INSERT INTO thread_prefixes (label, color_id, created_at, updated_at) VALUES (?1, ?2, 1, 1)",
        )
        .run(`P${i}`, colorId);
    await expect(
      run(s.ctx, "threadPrefixes.create", s.admin, { label: "One more", colorId }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("an unused prefix is deleted; one a thread carries is deactivated and stays on that thread", async () => {
    const s = setup();
    const unused = await s.prefix("Unused");
    expect(await run(s.ctx, "threadPrefixes.delete", s.admin, { prefixId: unused.id })).toEqual({
      ok: true,
      deactivated: false,
    });
    expect(
      s.ctx.sqlite.prepare("SELECT 1 FROM thread_prefixes WHERE id = ?1").get(unused.id),
    ).toBeNull();
    const carried = await s.prefix("Carried");
    const thread = await s.thread(s.author, { prefixId: carried.id });
    expect(thread.prefix).toEqual({
      id: carried.id,
      label: "Carried",
      color: "#60a5fa",
      icon: "",
    });
    expect(await run(s.ctx, "threadPrefixes.delete", s.admin, { prefixId: carried.id })).toEqual({
      ok: true,
      deactivated: true,
    });
    const shown = await execute(s.ctx, threadsGetOp, GUEST, { threadId: thread.id });
    expect(shown.thread.prefix?.label).toBe("Carried");
    await expect(s.thread(s.author, { prefixId: carried.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      run(s.ctx, "threadPrefixes.delete", s.admin, { prefixId: 99_999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expectNoTableScan(s.ctx, prefixSql.carried, [carried.id]);
    expectNoTableScan(s.ctx, inUseSql.prefix, [carried.id]);
  });

  test("a prefix colour a prefix uses cannot be deleted from the palette, only retired", async () => {
    const s = setup();
    const made = await s.prefix("Uses it");
    const result = await run(s.ctx, "paletteColors.delete", s.admin, { colorId: made.colorId });
    expect(result.deactivated).toBe(true);
    const free = s.color("prefix");
    const other = await run(s.ctx, "paletteColors.delete", s.admin, { colorId: free });
    expect(other.deactivated).toBe(made.colorId === free);
  });

  test("renaming or recolouring a prefix shows on its threads at once", async () => {
    const s = setup();
    const made = await s.prefix("Before");
    const thread = await s.thread(s.author, { prefixId: made.id });
    const orange = s.ctx.sqlite
      .prepare<{ id: number; color: string }, []>(
        "SELECT id, color FROM palette_colors WHERE kind = 'prefix' AND name = 'Orange'",
      )
      .get()!;
    await run(s.ctx, "threadPrefixes.update", s.admin, {
      prefixId: made.id,
      label: "After",
      colorId: orange.id,
    });
    const shown = await execute(s.ctx, threadsGetOp, GUEST, { threadId: thread.id });
    expect(shown.thread.prefix).toMatchObject({ label: "After", color: orange.color });
    // Retiring the palette colour changes nothing about what the thread shows.
    await run(s.ctx, "paletteColors.update", s.admin, { colorId: orange.id, color: "#112233" });
    const recoloured = await execute(s.ctx, threadsGetOp, GUEST, { threadId: thread.id });
    expect(recoloured.thread.prefix?.color).toBe("#112233");
  });
});

describe("a thread's prefix", () => {
  test("a new thread takes an active prefix only", async () => {
    const s = setup();
    const live = await s.prefix("Live");
    const off = await s.prefix("Off", { isActive: false });
    expect((await s.thread(s.author, { prefixId: live.id })).prefix?.id).toBe(live.id);
    expect((await s.thread(s.author)).prefix).toBeNull();
    await expect(s.thread(s.author, { prefixId: off.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.thread(s.author, { prefixId: 99_999 })).rejects.toBeInstanceOf(ValidationError);
  });

  test("the author changes or removes it; sending the one it carries is fine even when inactive", async () => {
    const s = setup();
    const first = await s.prefix("First");
    const second = await s.prefix("Second");
    const off = await s.prefix("Off", { isActive: false });
    const thread = await s.thread(s.author, { prefixId: first.id });
    const update = (actor: Parameters<typeof execute>[2], input: object) =>
      execute(s.ctx, threadsUpdateOp, actor, {
        threadId: thread.id,
        reason: "",
        ...input,
      } as never);
    await expect(update(s.author, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(update(GUEST, { prefixId: null })).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(update(s.other, { prefixId: second.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await update(s.author, { prefixId: second.id })).prefix?.id).toBe(second.id);
    await expect(update(s.author, { prefixId: off.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(update(s.author, { prefixId: 99_999 })).rejects.toBeInstanceOf(ValidationError);
    s.ctx.sqlite.prepare("UPDATE thread_prefixes SET is_active = 0 WHERE id = ?1").run(second.id);
    invalidate(s.ctx, "thread_prefixes");
    const same = await update(s.author, { prefixId: second.id, title: "Renamed" });
    expect(same).toMatchObject({ title: "Renamed", prefix: { id: second.id } });
    const cleared = await update(s.author, { prefixId: null });
    expect(cleared).toMatchObject({ title: "Renamed", prefix: null });
    // A title-only edit leaves the prefix alone.
    await update(s.author, { prefixId: first.id });
    expect((await update(s.author, { title: "Again" })).prefix?.id).toBe(first.id);
  });

  test("a locked thread's author cannot change its prefix; a moderator can, and it is logged and noticed", async () => {
    const s = setup();
    const made = await s.prefix("Tag");
    const thread = await s.thread(s.author);
    await execute(s.ctx, threadsSetLockedOp, s.mod, {
      threadId: thread.id,
      isLocked: true,
      reason: "x",
      notify: false,
    } as never);
    await expect(
      execute(s.ctx, threadsUpdateOp, s.author, {
        threadId: thread.id,
        prefixId: made.id,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const updated = await execute(s.ctx, threadsUpdateOp, s.mod, {
      threadId: thread.id,
      prefixId: made.id,
      reason: "Tidy up",
      notify: true,
    } as never);
    expect(updated.prefix?.id).toBe(made.id);
    const log = s.ctx.sqlite
      .prepare<{ reason: string; details: string }, []>(
        "SELECT reason, details FROM moderator_log WHERE action = 'thread.update'",
      )
      .all();
    expect(log).toHaveLength(1);
    expect(log[0]!.reason).toBe("Tidy up");
    expect(JSON.parse(log[0]!.details)).toEqual({ prefixId: made.id });
  });
});

describe("a thread's shape", () => {
  test("carries its forum, excerpt, bump, highlight and cover", async () => {
    const s = setup();
    const thread = await s.thread();
    expect(thread).toMatchObject({
      node: { id: s.forum.id },
      excerpt: expect.stringContaining("Opening"),
      cover: null,
      highlightedUntil: null,
      bumpedAt: null,
      prefix: null,
    });
    const file = s.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, attached_at) VALUES ('fake', 'k', 1, 'image/png', 'h', ?1, 'thread_cover', 'public', ?2, ?2) RETURNING id",
      )
      .get(s.authorUser.id, s.ctx.now())!;
    const picture = s.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO catalog_images (kind, name, file_id, is_active, created_at, updated_at) VALUES ('thread_cover', 'c', ?1, 0, ?2, ?2) RETURNING id",
      )
      .get(file.id, s.ctx.now())!;
    invalidate(s.ctx, "appearance");
    s.ctx.sqlite
      .prepare(
        "UPDATE threads SET cover_id = ?1, highlighted_until = ?2, bumped_at = ?3 WHERE id = ?4",
      )
      .run(picture.id, 5_000, 4_000, thread.id);
    const shown = (await execute(s.ctx, threadsGetOp, GUEST, { threadId: thread.id })).thread;
    // An inactive catalog picture still shows on the thread that carries it.
    expect(shown.cover).toEqual({ fileId: file.id, url: `/api/v1/files/${file.id}` });
    expect(shown.highlightedUntil).toBe(new Date(5_000).toISOString());
    expect(shown.bumpedAt).toBe(new Date(4_000).toISOString());
    const [inList] = (await execute(s.ctx, threadsListOp, GUEST, { nodeId: s.forum.id })).items;
    expect(inList).toEqual(shown);
  });
});

describe("threads.list order and prefix filter", () => {
  async function three() {
    const s = setup();
    const made = await s.prefix("Tag");
    const ids: number[] = [];
    for (const [title, prefixId] of [
      ["old", made.id],
      ["middle", null],
      ["new", made.id],
    ] as const) {
      s.ctx.clock.advance(60_000);
      ids.push((await s.thread(s.author, { title, prefixId })).id);
    }
    return { ...s, made, ids: ids as [number, number, number] };
  }
  const list = (s: ReturnType<typeof setup>, input: object = {}) =>
    execute(s.ctx, threadsListOp, GUEST, { nodeId: s.forum.id, ...input } as never);

  test("without bumps the order is by last post, as before", async () => {
    const s = await three();
    expect((await list(s)).items.map((t) => t.id)).toEqual([...s.ids].reverse());
    s.ctx.clock.advance(60_000);
    const reply = await execute(s.ctx, postsCreateOp, s.other, { threadId: s.ids[0]!, body: "up" });
    expect(reply.threadId).toBe(s.ids[0]);
    expect((await list(s)).items.map((t) => t.id)).toEqual([s.ids[0], s.ids[2], s.ids[1]]);
  });

  test("a bump moves a thread above newer activity; a bump older than the last post changes nothing", async () => {
    const s = await three();
    s.ctx.clock.advance(60_000);
    const bumpAt = s.ctx.now();
    s.ctx.sqlite.prepare("UPDATE threads SET bumped_at = ?1 WHERE id = ?2").run(bumpAt, s.ids[0]);
    expect((await list(s)).items.map((t) => t.id)).toEqual([s.ids[0], s.ids[2], s.ids[1]]);
    // Not a post: counters, last post and the thread's own activity time are untouched.
    const first = (await list(s)).items[0]!;
    expect(first.lastPost.postedAt).toBe(new Date(Date.UTC(2026, 0, 1, 0, 1)).toISOString());
    expect(first.replyCount).toBe(0);
    // A reply after the bump sorts by the reply again.
    s.ctx.clock.advance(60_000);
    await execute(s.ctx, postsCreateOp, s.other, { threadId: s.ids[1]!, body: "later" });
    expect((await list(s)).items.map((t) => t.id)).toEqual([s.ids[1], s.ids[0], s.ids[2]]);
    // A bump older than the last post has no effect.
    s.ctx.sqlite.prepare("UPDATE threads SET bumped_at = 1 WHERE id = ?1").run(s.ids[2]);
    expect((await list(s)).items.map((t) => t.id)).toEqual([s.ids[1], s.ids[0], s.ids[2]]);
  });

  test("pages follow the bumped order through the cursor", async () => {
    const s = await three();
    s.ctx.sqlite
      .prepare("UPDATE threads SET bumped_at = ?1 WHERE id = ?2")
      .run(s.ctx.now() + 1_000_000, s.ids[0]);
    const first = await list(s, { limit: 2 });
    expect(first.items.map((t) => t.id)).toEqual([s.ids[0], s.ids[2]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(s, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((t) => t.id)).toEqual([s.ids[1]]);
    expect(second.nextCursor).toBeNull();
  });

  test("sticky threads stay on top of the first page, ordered the same way", async () => {
    const s = await three();
    s.ctx.sqlite
      .prepare("UPDATE threads SET is_sticky = 1 WHERE id IN (?1, ?2)")
      .run(s.ids[0], s.ids[1]);
    s.ctx.sqlite
      .prepare("UPDATE threads SET bumped_at = ?1 WHERE id = ?2")
      .run(s.ctx.now() + 5, s.ids[0]);
    const page = await list(s);
    expect(page.sticky.map((t) => t.id)).toEqual([s.ids[0], s.ids[1]]);
    expect(page.items.map((t) => t.id)).toEqual([s.ids[2]]);
  });

  test("the prefix filter narrows both lists; an unused or unknown prefix is an empty page", async () => {
    const s = await three();
    expect((await list(s, { prefixId: s.made.id })).items.map((t) => t.id)).toEqual([
      s.ids[2],
      s.ids[0],
    ]);
    const unused = await s.prefix("Nobody");
    for (const prefixId of [unused.id, 99_999]) {
      const empty = await list(s, { prefixId });
      expect(empty).toEqual({ items: [], sticky: [], nextCursor: null });
    }
    s.ctx.sqlite.prepare("UPDATE threads SET is_sticky = 1 WHERE id = ?1").run(s.ids[0]);
    const filtered = await list(s, { prefixId: s.made.id });
    expect(filtered.sticky.map((t) => t.id)).toEqual([s.ids[0]]);
    expect(filtered.items.map((t) => t.id)).toEqual([s.ids[2]]);
    const paged = await list(s, { prefixId: s.made.id, limit: 1 });
    expect(paged.nextCursor).toBeNull();
  });

  test("the queries read their index in order", async () => {
    const s = setup();
    expectNoTableScan(s.ctx, forumSql.threadPage, [1, 0, 0, 100, 100, 20, 1]);
    expectNoTableScan(s.ctx, forumSql.sticky, [1, 0, 0, 1]);
    expectNoTableScan(s.ctx, forumSql.threadPageByPrefix, [1, 0, 0, 100, 100, 20, 1, 3]);
    expectNoTableScan(s.ctx, forumSql.stickyByPrefix, [1, 0, 0, 1, 3]);
    const plan = (sql: string, params: unknown[]) =>
      s.ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[]))
        .map((row) => row.detail)
        .join("\n");
    expect(plan(forumSql.threadPage, [1, 0, 0, 100, 100, 20, 1])).toContain("threads_node_sort");
    expect(plan(forumSql.threadPageByPrefix, [1, 0, 0, 100, 100, 20, 1, 3])).toContain(
      "threads_prefix",
    );
  });
});

describe("forum tabs", () => {
  test("anyone lists them in order; writes need admin.nodes and are logged; at most 20", async () => {
    const s = setup();
    const b = await run(s.ctx, "forumTabs.create", s.admin, { title: "B", position: 2 });
    const a = await run(s.ctx, "forumTabs.create", s.admin, { title: "A", position: 1 });
    for (const actor of [GUEST, s.author, s.admin])
      expect(
        (await run(s.ctx, "forumTabs.list", actor, {})).items.map((t: { id: number }) => t.id),
      ).toEqual([a.id, b.id]);
    await expect(run(s.ctx, "forumTabs.create", GUEST, { title: "X" })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [s.author, s.mod]) {
      await expect(run(s.ctx, "forumTabs.create", actor, { title: "X" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        run(s.ctx, "forumTabs.update", actor, { tabId: a.id, title: "X" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(s.ctx, "forumTabs.delete", actor, { tabId: a.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    const renamed = await run(s.ctx, "forumTabs.update", s.admin, {
      tabId: a.id,
      title: "Z",
      position: 9,
    });
    expect(renamed).toMatchObject({ title: "Z", position: 9 });
    await expect(
      run(s.ctx, "forumTabs.update", s.admin, { tabId: 99_999, title: "Q" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(run(s.ctx, "forumTabs.delete", s.admin, { tabId: 99_999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(
      s.ctx.sqlite
        .prepare<{ action: string }, []>("SELECT action FROM moderator_log ORDER BY id")
        .all()
        .map((row) => row.action),
    ).toEqual(["forumTab.create", "forumTab.create", "forumTab.update"]);
    for (let i = 2; i < TAB_LIMIT; i++)
      await run(s.ctx, "forumTabs.create", s.admin, { title: `T${i}` });
    await expect(run(s.ctx, "forumTabs.create", s.admin, { title: "21st" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("only a root category takes a tab, and every node reports its root's tab", async () => {
    const s = setup();
    const tab = await run(s.ctx, "forumTabs.create", s.admin, { title: "Main" });
    const make = (input: object) => execute(s.ctx, nodesCreateOp, s.admin, input as never);
    const root = await make({ parentId: null, type: "category", title: "Root", tabId: tab.id });
    expect(root.tabId).toBe(tab.id);
    const child = await make({ parentId: root.id, type: "forum", title: "Child" });
    const sub = await make({ parentId: root.id, type: "category", title: "Sub" });
    const leaf = await make({ parentId: sub.id, type: "forum", title: "Leaf" });
    const listed = await execute(s.ctx, nodesListOp, GUEST, {});
    const tabOf = (id: number) => listed.items.find((n) => n.id === id)?.tabId;
    expect([root.id, child.id, sub.id, leaf.id].map(tabOf)).toEqual([
      tab.id,
      tab.id,
      tab.id,
      tab.id,
    ]);
    expect(tabOf(s.category.id)).toBeNull();
    // Refused on forums, on nested categories, for a missing tab; null is always fine.
    await expect(
      make({ parentId: null, type: "forum", title: "F", tabId: tab.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      make({ parentId: root.id, type: "category", title: "C", tabId: tab.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      make({ parentId: null, type: "category", title: "C", tabId: 99_999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await make({ parentId: null, type: "category", title: "C", tabId: null })).tabId,
    ).toBeNull();
    const update = (input: object) => execute(s.ctx, nodesUpdateOp, s.admin, input as never);
    await expect(update({ nodeId: child.id, tabId: tab.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(update({ nodeId: sub.id, tabId: tab.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(update({ nodeId: s.category.id, tabId: 99_999 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await update({ nodeId: s.category.id, tabId: tab.id })).tabId).toBe(tab.id);
    expect(
      (await execute(s.ctx, nodesListOp, GUEST, {})).items.find((n) => n.id === s.forum.id)?.tabId,
    ).toBe(tab.id);
    expect((await update({ nodeId: s.category.id, tabId: null })).tabId).toBeNull();
    // A title edit keeps the tab; moving the category under another node clears it.
    expect((await update({ nodeId: root.id, title: "Renamed" })).tabId).toBe(tab.id);
    expect((await update({ nodeId: root.id, parentId: s.category.id })).tabId).toBeNull();
    expect(
      s.ctx.sqlite
        .prepare<{ tab_id: number | null }, [number]>("SELECT tab_id FROM nodes WHERE id = ?1")
        .get(root.id)?.tab_id,
    ).toBeNull();
    // Moving it back to the top does not bring the tab back.
    expect((await update({ nodeId: root.id, parentId: null })).tabId).toBeNull();
  });

  test("deleting a tab frees its categories in the same step", async () => {
    const s = setup();
    const tab = await run(s.ctx, "forumTabs.create", s.admin, { title: "Gone" });
    const root = await execute(s.ctx, nodesCreateOp, s.admin, {
      parentId: null,
      type: "category",
      title: "Root",
      tabId: tab.id,
    } as never);
    const leaf = await execute(s.ctx, nodesCreateOp, s.admin, {
      parentId: root.id,
      type: "forum",
      title: "Leaf",
    } as never);
    const tabOf = async (id: number) =>
      (await execute(s.ctx, nodesListOp, GUEST, {})).items.find((n) => n.id === id)?.tabId;
    expect(await tabOf(leaf.id)).toBe(tab.id);
    expect(await run(s.ctx, "forumTabs.delete", s.admin, { tabId: tab.id })).toEqual({ ok: true });
    expect(await tabOf(root.id)).toBeNull();
    expect(await tabOf(leaf.id)).toBeNull();
    expect((await run(s.ctx, "forumTabs.list", GUEST, {})).items).toEqual([]);
  });
});
