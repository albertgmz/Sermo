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
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { bulkModerate } from "../moderation";
import { threadsCreateOp, threadsGetOp, threadsUpdateOp } from "./index";
import { prefixSql } from "./prefixes";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

/** Two forums under one category, an administrator, a moderator, an author and three prefixes. */
async function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const mod = userActor(insertUser(ctx, { groupId: 3 }));
  const author = userActor(insertUser(ctx));
  const other = userActor(insertUser(ctx));
  const category = insertNode(ctx, { type: "category" });
  const news = insertNode(ctx, { parentId: category.id, title: "News" });
  const chat = insertNode(ctx, { parentId: category.id, title: "Chat" });
  invalidate(ctx, "node_tree");
  const colorId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM palette_colors WHERE kind = 'prefix' AND is_active = 1 ORDER BY position LIMIT 1",
    )
    .get()!.id;
  // Offered nowhere until a test says so.
  const prefix = (label: string, extra: object = {}) =>
    run(ctx, "threadPrefixes.create", admin, {
      label,
      colorId,
      offerInAllForums: false,
      ...extra,
    });
  const [alert, solved, retired] = [
    await prefix("Alert"),
    await prefix("Solved"),
    await prefix("Retired", { isActive: false }),
  ];
  const offer = (nodeId: number, prefixIds: number[]) =>
    run(ctx, "nodes.update", admin, { nodeId, prefixIds });
  const thread = async (nodeId: number, extra: object = {}, actor = author) =>
    (
      await execute(ctx, threadsCreateOp, actor, {
        nodeId,
        title: "A title",
        body: "An opening post",
        ...extra,
      })
    ).thread;
  const stored = (id: number) =>
    ctx.sqlite
      .prepare<{ prefix_id: number | null; node_id: number }, [number]>(
        "SELECT prefix_id, node_id FROM threads WHERE id = ?1",
      )
      .get(id)!;
  const update = (threadId: number, actor: Parameters<typeof execute>[2], input: object) =>
    execute(ctx, threadsUpdateOp, actor, { threadId, reason: "", ...input } as never);
  return {
    ctx,
    admin,
    mod,
    author,
    other,
    category,
    news,
    chat,
    alert,
    solved,
    retired,
    offer,
    thread,
    stored,
    update,
  };
}

describe("the prefixes a forum offers", () => {
  test("a forum offers none until an administrator picks them", async () => {
    const s = await setup();
    await expect(s.thread(s.news.id, { prefixId: s.alert.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await s.thread(s.news.id)).prefix).toBeNull();
    const none = await run(s.ctx, "threadPrefixes.list", s.author, { nodeId: s.news.id });
    expect(none.items).toEqual([]);
  });

  test("a thread takes a prefix its forum offers and no other", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id]);
    await s.offer(s.chat.id, [s.solved.id]);
    expect((await s.thread(s.news.id, { prefixId: s.alert.id })).prefix?.id).toBe(s.alert.id);
    await expect(s.thread(s.news.id, { prefixId: s.solved.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(s.thread(s.chat.id, { prefixId: s.alert.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // An inactive prefix is refused even where it is offered.
    await s.offer(s.news.id, [s.alert.id, s.retired.id]);
    await expect(s.thread(s.news.id, { prefixId: s.retired.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("editing a thread takes the same rule; the prefix it already has stays when the forum stops offering it", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id]);
    const made = await s.thread(s.news.id, { prefixId: s.alert.id });
    await expect(s.update(made.id, s.author, { prefixId: s.solved.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(s.stored(made.id).prefix_id).toBe(s.alert.id);
    await s.offer(s.news.id, [s.solved.id]);
    expect(s.stored(made.id).prefix_id).toBe(s.alert.id);
    expect((await s.update(made.id, s.author, { title: "Renamed" })).prefix?.id).toBe(s.alert.id);
    expect((await s.update(made.id, s.author, { prefixId: s.solved.id })).prefix?.id).toBe(
      s.solved.id,
    );
    await expect(s.update(made.id, s.author, { prefixId: s.alert.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("a moderator's batch setPrefix is refused, for that thread only, where the forum does not offer the prefix", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id]);
    const inNews = await s.thread(s.news.id);
    const inChat = await s.thread(s.chat.id);
    const out = await run(s.ctx, "threads.batchUpdate", s.mod, {
      threadIds: [inNews.id, inChat.id],
      update: { action: "setPrefix", prefixId: s.alert.id },
    });
    expect(out.results.map((r: { changed: boolean }) => r.changed)).toEqual([true, false]);
    expect(out.results[1].error).toMatchObject({ code: "validation" });
    expect(s.stored(inNews.id).prefix_id).toBe(s.alert.id);
    expect(s.stored(inChat.id).prefix_id).toBeNull();
  });

  test("moving a thread to a forum that does not offer its prefix drops the prefix, as XenForo does", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.solved.id]);
    await s.offer(s.chat.id, [s.solved.id]);
    const dropped = await s.thread(s.news.id, { prefixId: s.alert.id });
    const kept = await s.thread(s.news.id, { prefixId: s.solved.id });
    const out = await run(s.ctx, "threads.batchUpdate", s.admin, {
      threadIds: [dropped.id, kept.id],
      update: { action: "move", nodeId: s.chat.id },
    });
    expect(out.results.map((r: { changed: boolean }) => r.changed)).toEqual([true, true]);
    expect(s.stored(dropped.id)).toEqual({ prefix_id: null, node_id: s.chat.id });
    expect(s.stored(kept.id)).toEqual({ prefix_id: s.solved.id, node_id: s.chat.id });
  });

  test("the moderation tools' bulk move does the same", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.solved.id]);
    await s.offer(s.chat.id, [s.solved.id]);
    const dropped = await s.thread(s.news.id, { prefixId: s.alert.id });
    const kept = await s.thread(s.news.id, { prefixId: s.solved.id });
    const targets = [dropped, kept].map((thread) => ({ type: "thread" as const, id: thread.id }));
    expect(bulkModerate(s.ctx, s.admin, targets, "move", "", s.chat.id).changed).toBe(2);
    expect(s.stored(dropped.id)).toEqual({ prefix_id: null, node_id: s.chat.id });
    expect(s.stored(kept.id)).toEqual({ prefix_id: s.solved.id, node_id: s.chat.id });
  });

  test("a prefix deleted from the site is no longer offered by any forum", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.solved.id]);
    await run(s.ctx, "threadPrefixes.delete", s.admin, { prefixId: s.alert.id });
    const left = await run(s.ctx, "threadPrefixes.list", s.author, { nodeId: s.news.id });
    expect(left.items.map((p: { id: number }) => p.id)).toEqual([s.solved.id]);
    expect(
      s.ctx.sqlite.prepare("SELECT 1 FROM forum_prefixes WHERE prefix_id = ?1").get(s.alert.id),
    ).toBeNull();
  });
});

describe("a forum that requires a prefix", () => {
  async function required() {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.retired.id]);
    await run(s.ctx, "nodes.update", s.admin, {
      nodeId: s.news.id,
      settings: { requirePrefix: true },
    });
    return s;
  }

  test("a new thread must carry one", async () => {
    const s = await required();
    await expect(s.thread(s.news.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.thread(s.news.id, { prefixId: null })).rejects.toBeInstanceOf(ValidationError);
    expect((await s.thread(s.news.id, { prefixId: s.alert.id })).prefix?.id).toBe(s.alert.id);
    // The forum next door requires nothing.
    expect((await s.thread(s.chat.id)).prefix).toBeNull();
  });

  test("an author cannot take the prefix off; a moderator can; a thread without one can still be retitled", async () => {
    const s = await required();
    const made = await s.thread(s.news.id, { prefixId: s.alert.id });
    await expect(s.update(made.id, s.author, { prefixId: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(s.stored(made.id).prefix_id).toBe(s.alert.id);
    expect((await s.update(made.id, s.mod, { prefixId: null })).prefix).toBeNull();
    // Now it has none: its author may change the title, the form sending the empty prefix again
    // included, but not before the forum asked for one and the thread had it.
    expect((await s.update(made.id, s.author, { title: "New" })).title).toBe("New");
    expect((await s.update(made.id, s.author, { title: "Newer", prefixId: null })).title).toBe(
      "Newer",
    );
    expect(
      (await s.update(made.id, s.author, { title: "New", prefixId: s.alert.id })).prefix?.id,
    ).toBe(s.alert.id);
  });

  test("it binds only while the forum offers an active prefix", async () => {
    const s = await required();
    await s.offer(s.news.id, [s.retired.id]);
    expect((await s.thread(s.news.id)).prefix).toBeNull();
    await s.offer(s.news.id, []);
    expect((await s.thread(s.news.id)).prefix).toBeNull();
  });

  test("the setting is part of the forum's settings", async () => {
    const s = await required();
    const shown = await run(s.ctx, "nodes.get", s.author, { nodeId: s.news.id });
    expect(shown.node.settings.requirePrefix).toBe(true);
    const cleared = await run(s.ctx, "nodes.update", s.admin, {
      nodeId: s.news.id,
      settings: { requirePrefix: false },
    });
    expect(cleared.settings.requirePrefix).toBe(false);
  });
});

describe("choosing the prefixes of a forum", () => {
  test("an administrator replaces the whole set, and clears it with an empty list", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.solved.id, s.alert.id]);
    const listed = async (actor = s.admin) =>
      (await run(s.ctx, "threadPrefixes.list", actor, { nodeId: s.news.id })).items.map(
        (p: { id: number }) => p.id,
      );
    expect(await listed()).toEqual([s.alert.id, s.solved.id]);
    await s.offer(s.news.id, [s.solved.id, s.retired.id]);
    expect(await listed()).toEqual([s.solved.id, s.retired.id]);
    // Leaving prefixIds out changes nothing; an empty list clears.
    await run(s.ctx, "nodes.update", s.admin, { nodeId: s.news.id, title: "Renamed" });
    expect(await listed()).toEqual([s.solved.id, s.retired.id]);
    await s.offer(s.news.id, []);
    expect(await listed()).toEqual([]);
    const logged = s.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM moderator_log WHERE action = 'node.update'",
      )
      .get()!.n;
    expect(logged).toBeGreaterThan(0);
  });

  test("an unknown prefix, or a category, is refused and changes nothing", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id]);
    await expect(s.offer(s.news.id, [s.solved.id, 99_999])).rejects.toBeInstanceOf(ValidationError);
    await expect(s.offer(s.category.id, [s.solved.id])).rejects.toBeInstanceOf(ValidationError);
    const listed = await run(s.ctx, "threadPrefixes.list", s.admin, { nodeId: s.news.id });
    expect(listed.items.map((p: { id: number }) => p.id)).toEqual([s.alert.id]);
  });

  test("nodes.create takes the set and the setting too", async () => {
    const s = await setup();
    const made = await run(s.ctx, "nodes.create", s.admin, {
      parentId: s.category.id,
      type: "forum",
      title: "Fresh",
      prefixIds: [s.solved.id],
      settings: { requirePrefix: true },
    });
    expect(made.settings.requirePrefix).toBe(true);
    const listed = await run(s.ctx, "threadPrefixes.list", s.author, { nodeId: made.id });
    expect(listed.items.map((p: { id: number }) => p.id)).toEqual([s.solved.id]);
  });

  test("a guest is refused as a guest, a member and a moderator as forbidden, before the input is read", async () => {
    const s = await setup();
    const bad = { nodeId: s.news.id, prefixIds: ["x"] };
    await expect(run(s.ctx, "nodes.update", GUEST, bad)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [s.author, s.mod])
      await expect(run(s.ctx, "nodes.update", actor, bad)).rejects.toBeInstanceOf(ForbiddenError);
    for (const actor of [GUEST, s.author, s.mod])
      await expect(
        run(s.ctx, "nodes.update", actor, { nodeId: s.news.id, prefixIds: [s.alert.id] }),
      ).rejects.toThrow();
    const listed = await run(s.ctx, "threadPrefixes.list", s.admin, { nodeId: s.news.id });
    expect(listed.items).toEqual([]);
  });

  test("the list for a forum shows everyone the active ones; the inactive ones are for administrators", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.retired.id]);
    const ids = async (actor: Parameters<typeof execute>[2]) =>
      (await run(s.ctx, "threadPrefixes.list", actor, { nodeId: s.news.id })).items.map(
        (p: { id: number }) => p.id,
      );
    expect(await ids(GUEST)).toEqual([s.alert.id]);
    expect(await ids(s.author)).toEqual([s.alert.id]);
    expect(await ids(s.admin)).toEqual([s.alert.id, s.retired.id]);
    await expect(
      run(s.ctx, "threadPrefixes.list", s.author, { nodeId: 99_999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Without a forum it is still the whole catalog.
    expect((await run(s.ctx, "threadPrefixes.list", GUEST, {})).items).toHaveLength(2);
  });

  test("a forum nobody may view does not tell what it offers", async () => {
    const s = await setup();
    const secret = insertNode(s.ctx, { parentId: s.category.id });
    for (const group of [1, 2])
      s.ctx.sqlite
        .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, ?2, 0)")
        .run(secret.id, group);
    invalidate(s.ctx, "node_tree");
    invalidate(s.ctx, "permissions");
    await s.offer(secret.id, [s.alert.id]);
    await expect(
      run(s.ctx, "threadPrefixes.list", s.author, { nodeId: secret.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await run(s.ctx, "threadPrefixes.list", s.admin, { nodeId: secret.id })).items,
    ).toHaveLength(1);
  });

  test("a new prefix is offered in every forum unless the form says otherwise", async () => {
    const s = await setup();
    const everywhere = await run(s.ctx, "threadPrefixes.create", s.admin, {
      label: "Question",
      colorId: s.alert.colorId,
    });
    const nowhere = await run(s.ctx, "threadPrefixes.create", s.admin, {
      label: "Poll",
      colorId: s.alert.colorId,
      offerInAllForums: false,
    });
    for (const forum of [s.news, s.chat]) {
      const listed = await run(s.ctx, "threadPrefixes.list", s.author, { nodeId: forum.id });
      expect(listed.items.map((p: { id: number }) => p.id)).toEqual([everywhere.id]);
    }
    expect((await s.thread(s.chat.id, { prefixId: everywhere.id })).prefix?.id).toBe(everywhere.id);
    await expect(s.thread(s.chat.id, { prefixId: nowhere.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // A category offers nothing.
    expect(
      s.ctx.sqlite.prepare("SELECT 1 FROM forum_prefixes WHERE node_id = ?1").get(s.category.id),
    ).toBeNull();
  });

  test("a new forum offers every active prefix unless it is given a set", async () => {
    const s = await setup();
    const input = { parentId: s.category.id, type: "forum" };
    const plain = await run(s.ctx, "nodes.create", s.admin, { ...input, title: "Plain" });
    const chosen = await run(s.ctx, "nodes.create", s.admin, {
      ...input,
      title: "Chosen",
      prefixIds: [s.solved.id],
    });
    const empty = await run(s.ctx, "nodes.create", s.admin, {
      ...input,
      title: "Empty",
      prefixIds: [],
    });
    const category = await run(s.ctx, "nodes.create", s.admin, {
      parentId: null,
      type: "category",
      title: "Cat",
    });
    const offered = async (id: number) =>
      (await run(s.ctx, "threadPrefixes.list", s.admin, { nodeId: id })).items.map(
        (p: { id: number }) => p.id,
      );
    // Alert and Solved are active, Retired is not.
    expect(await offered(plain.id)).toEqual([s.alert.id, s.solved.id]);
    expect(await offered(chosen.id)).toEqual([s.solved.id]);
    expect(await offered(empty.id)).toEqual([]);
    expect(await offered(category.id)).toEqual([]);
  });

  test("the list with `carried` adds the prefixes threads of the forum still carry", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id, s.solved.id]);
    await s.thread(s.news.id, { prefixId: s.alert.id });
    // Solved is carried only in the forum next door.
    await s.offer(s.chat.id, [s.solved.id]);
    await s.thread(s.chat.id, { prefixId: s.solved.id });
    await s.offer(s.news.id, []);
    const ids = async (input: object) =>
      (
        await run(s.ctx, "threadPrefixes.list", s.author, { nodeId: s.news.id, ...input })
      ).items.map((p: { id: number }) => p.id);
    expect(await ids({})).toEqual([]);
    expect(await ids({ carried: true })).toEqual([s.alert.id]);
    expectNoTableScan(s.ctx, prefixSql.carriedHere, [s.alert.id, s.news.id]);
  });

  test("a thread's page shows the prefix of a forum that no longer offers it", async () => {
    const s = await setup();
    await s.offer(s.news.id, [s.alert.id]);
    const made = await s.thread(s.news.id, { prefixId: s.alert.id });
    await s.offer(s.news.id, []);
    const shown = await execute(s.ctx, threadsGetOp, GUEST, { threadId: made.id });
    expect(shown.thread.prefix?.label).toBe("Alert");
  });

  test("the offered set is read by an index range", async () => {
    const s = await setup();
    expectNoTableScan(s.ctx, prefixSql.offered, [s.news.id]);
  });
});
