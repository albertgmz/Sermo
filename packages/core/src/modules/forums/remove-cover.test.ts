import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { insertCatalogImage } from "../appearance/catalog-fixtures";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const authorRow = insertUser(ctx);
  const author = userActor(authorRow);
  const other = userActor(insertUser(ctx));
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const call = (name: string, actor: object, input: object) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const coverId = insertCatalogImage(ctx, "thread_cover");
  const created = await call("threads.create", author, {
    nodeId: node.id,
    title: "With a cover",
    body: "Body",
  });
  const threadId = created.thread.id as number;
  const cover = () =>
    ctx.sqlite.prepare("UPDATE threads SET cover_id = ?1 WHERE id = ?2").run(coverId, threadId);
  cover();
  const row = () =>
    ctx.sqlite
      .prepare<{ cover_id: number | null; content_updated_at: number }, [number]>(
        "SELECT cover_id, content_updated_at FROM threads WHERE id = ?1",
      )
      .get(threadId)!;
  const remove = (actor: object, input: object = {}) =>
    call("threads.removeCover", actor, { threadId, ...input });
  const logged = () =>
    ctx.sqlite.prepare("SELECT action, target_id, reason FROM moderator_log").all();
  const edits = () =>
    ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'content.edited' AND target_type = 'thread' AND target_id = ?1 ORDER BY id",
      )
      .all(threadId)
      .map((event) => JSON.parse(event.payload));
  return {
    ctx,
    admin,
    moderator,
    author,
    authorRow,
    other,
    node,
    call,
    coverId,
    threadId,
    cover,
    row,
    remove,
    logged,
    edits,
  };
}

describe("threads.removeCover", () => {
  test("the author takes the cover off; nothing is logged and the thread shows no cover", async () => {
    const w = await world();
    w.ctx.clock.advance(5000);
    const before = w.row().content_updated_at;
    const thread = await w.remove(w.author);
    expect(thread).toMatchObject({ id: w.threadId, cover: null });
    expect(w.row()).toEqual({ cover_id: null, content_updated_at: w.ctx.now() });
    expect(w.row().content_updated_at).toBeGreaterThan(before);
    expect(w.logged()).toEqual([]);
    expect(w.edits().at(-1)).toEqual({});
  });

  test("a thread with no cover is a no-op that returns the thread", async () => {
    const w = await world();
    await w.remove(w.author);
    const snapshot = JSON.stringify([
      w.row(),
      w.edits(),
      w.logged(),
      w.ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM domain_events").get(),
    ]);
    w.ctx.clock.advance(5000);
    expect(await w.remove(w.author)).toMatchObject({ id: w.threadId, cover: null });
    expect(await w.remove(w.moderator, { reason: "Nothing there" })).toMatchObject({ cover: null });
    expect(
      JSON.stringify([
        w.row(),
        w.edits(),
        w.logged(),
        w.ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM domain_events").get(),
      ]),
    ).toBe(snapshot);
  });

  test("a moderator removes it with a reason, which is logged and published with the notice", async () => {
    const w = await world();
    await w.remove(w.moderator, { reason: "Not suitable", notify: true, message: "Sorry" });
    expect(w.row().cover_id).toBeNull();
    expect(w.logged()).toEqual([
      { action: "thread.removeCover", target_id: w.threadId, reason: "Not suitable" },
    ]);
    expect(w.edits().at(-1)).toMatchObject({
      reason: "Not suitable",
      notify: true,
      message: "Sorry",
    });
    w.cover();
    await w.remove(w.admin);
    expect(w.row().cover_id).toBeNull();
  });

  test("other members, guests and members who cannot see the forum are refused", async () => {
    const w = await world();
    await expect(w.remove(w.other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.remove(GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      w.call("threads.removeCover", w.author, { threadId: 999999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.row().cover_id).toBe(w.coverId);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, ?2, id, -1 FROM permission_definitions WHERE key = 'node.view'",
      )
      .run(w.authorRow.id, w.node.id);
    invalidate(w.ctx, "permissions");
    await expect(w.remove(userActor(w.authorRow))).rejects.toBeInstanceOf(NotFoundError);
    expect(w.row().cover_id).toBe(w.coverId);
  });

  test("the author of a thread awaiting approval or deleted cannot use it, a moderator can", async () => {
    const w = await world();
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(w.threadId);
    await expect(w.remove(w.author)).rejects.toBeInstanceOf(ForbiddenError);
    await w.remove(w.moderator);
    expect(w.row().cover_id).toBeNull();
    w.cover();
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(w.threadId);
    await expect(w.remove(w.author)).rejects.toBeInstanceOf(NotFoundError);
    expect(w.row().cover_id).toBe(w.coverId);
  });
});
