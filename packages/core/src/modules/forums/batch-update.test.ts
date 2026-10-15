import { describe, expect, test } from "bun:test";
import { insertNode, insertUser } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { type World, world } from "../feed/fixtures.test";

/** Two forums, a moderator who may do everything in one and nothing of the batch in the other. */
async function setup() {
  const w = world();
  const other = insertNode(w.ctx, { parentId: w.category.id });
  invalidate(w.ctx, "node_tree");
  const a1 = (await w.thread(w.alice, w.open.id, "A1")).thread.id as number;
  const a2 = (await w.thread(w.bob, w.open.id, "A2")).thread.id as number;
  const b1 = (await w.thread(w.alice, other.id, "B1")).thread.id as number;
  for (const permission of [
    "forum.lock",
    "forum.stick",
    "forum.feature",
    "forum.move",
    "forum.deleteAny",
    "forum.undelete",
    "forum.editAny",
  ])
    await w.call("permissions.set", w.admin, {
      groupId: 3,
      nodeId: other.id,
      entries: [{ permission, value: "never" }],
    });
  return { w, other, a1, a2, b1 };
}
const row = (w: World, id: number) =>
  w.ctx.sqlite
    .prepare<
      {
        node_id: number;
        state: string;
        is_locked: number;
        is_sticky: number;
        prefix_id: number | null;
      },
      [number]
    >("SELECT node_id, state, is_locked, is_sticky, prefix_id FROM threads WHERE id = ?1")
    .get(id)!;
const logged = (w: World, action: string) =>
  w.ctx.sqlite
    .prepare<{ target_id: number; reason: string; node_id: number | null }, [string]>(
      "SELECT target_id, reason, node_id FROM moderator_log WHERE action = ?1 ORDER BY id",
    )
    .all(action);

describe("threads.batchUpdate", () => {
  test("each thread is judged in its own forum; the refused one changes nothing", async () => {
    const { w, a1, a2, b1 } = await setup();
    const out = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a1, b1, a2],
      update: { action: "lock" },
      reason: "calm down",
    });
    expect(out.results).toEqual([
      { threadId: a1, changed: true, error: null },
      {
        threadId: b1,
        changed: false,
        error: { code: "forbidden", message: expect.any(String) },
      },
      { threadId: a2, changed: true, error: null },
    ]);
    expect([a1, b1, a2].map((id) => row(w, id).is_locked)).toEqual([1, 0, 1]);
    // Logged per thread, as the single action logs, with the shared reason and the forum.
    expect(logged(w, "thread.lock")).toEqual([
      { target_id: a1, reason: "calm down", node_id: w.open.id },
      { target_id: a2, reason: "calm down", node_id: w.open.id },
    ]);
    // Repeating says nothing changed.
    const again = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a1],
      update: { action: "lock" },
    });
    expect(again.results[0].changed).toBe(false);
    // An administrator is not held back in the other forum.
    const admin = await w.call("threads.batchUpdate", w.admin, {
      threadIds: [b1, a1],
      update: { action: "unlock" },
    });
    expect(admin.results.map((r: { changed: boolean }) => r.changed)).toEqual([false, true]);
    expect([a1, b1].map((id) => row(w, id).is_locked)).toEqual([0, 0]);
  });

  test("stick, feature, delete and restore follow their own permissions", async () => {
    const { w, a1, a2, b1 } = await setup();
    const ids = [a1, b1, a2];
    const run = (update: object) =>
      w.call("threads.batchUpdate", w.mod, { threadIds: ids, update });
    const changed = (out: { results: { changed: boolean; error: unknown }[] }) =>
      out.results.map((r) => (r.error ? "refused" : r.changed ? "changed" : "same"));
    expect(changed(await run({ action: "stick" }))).toEqual(["changed", "refused", "changed"]);
    expect(ids.map((id) => row(w, id).is_sticky)).toEqual([1, 0, 1]);
    expect(changed(await run({ action: "unstick" }))).toEqual(["changed", "refused", "changed"]);
    expect(changed(await run({ action: "feature" }))).toEqual(["changed", "refused", "changed"]);
    expect(
      w.ctx.sqlite
        .prepare<{ thread_id: number }, []>("SELECT thread_id FROM thread_features ORDER BY id")
        .all()
        .map((r) => r.thread_id),
    ).toEqual([a1, a2]);
    expect(changed(await run({ action: "unfeature" }))).toEqual(["changed", "refused", "changed"]);
    const before = {
      node: w.ctx.sqlite
        .prepare<{ thread_count: number; post_count: number }, [number]>(
          "SELECT thread_count, post_count FROM nodes WHERE id = ?1",
        )
        .get(w.open.id)!,
    };
    expect(before.node.thread_count).toBe(2);
    expect(changed(await run({ action: "delete" }))).toEqual(["changed", "refused", "changed"]);
    expect(ids.map((id) => row(w, id).state)).toEqual(["deleted", "visible", "deleted"]);
    // The forum's counters moved exactly as for single deletes.
    expect(
      w.ctx.sqlite
        .prepare<
          { thread_count: number; post_count: number; last_thread_id: number | null },
          [number]
        >("SELECT thread_count, post_count, last_thread_id FROM nodes WHERE id = ?1")
        .get(w.open.id),
    ).toEqual({ thread_count: 0, post_count: 0, last_thread_id: null });
    // A deleted thread cannot be featured: that one is refused, the rest are applied.
    const mixed = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a1, a2],
      update: { action: "restore" },
    });
    expect(changed(mixed)).toEqual(["changed", "changed"]);
    await w.call("threads.delete", w.mod, { threadId: a2 });
    const feature = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a2, a1],
      update: { action: "feature" },
    });
    expect(feature.results[0].error).toMatchObject({ code: "conflict" });
    expect(feature.results[1]).toMatchObject({ changed: true, error: null });
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM thread_features WHERE ends_at IS NULL",
        )
        .get()!.n,
    ).toBe(1);
  });

  test("moves threads to a forum the moderator may move into, counters included", async () => {
    const { w, other, a1, a2, b1 } = await setup();
    // The moderator has no forum.move in `other`: nothing is moved there, every item says so.
    const refused = await w
      .call("threads.batchUpdate", w.mod, {
        threadIds: [a1, a2],
        update: { action: "move", nodeId: other.id },
      })
      .catch((error: Error) => error);
    expect(refused).toMatchObject({ code: "forbidden" });
    expect(row(w, a1).node_id).toBe(w.open.id);
    // An administrator moves one thread from each forum into the first.
    const out = await w.call("threads.batchUpdate", w.admin, {
      threadIds: [b1, a1],
      update: { action: "move", nodeId: w.open.id },
    });
    expect(out.results.map((r: { changed: boolean }) => r.changed)).toEqual([true, false]);
    expect(row(w, b1).node_id).toBe(w.open.id);
    const counts = (id: number) =>
      w.ctx.sqlite
        .prepare<{ thread_count: number; post_count: number }, [number]>(
          "SELECT thread_count, post_count FROM nodes WHERE id = ?1",
        )
        .get(id);
    expect(counts(w.open.id)).toEqual({ thread_count: 3, post_count: 3 });
    expect(counts(other.id)).toEqual({ thread_count: 0, post_count: 0 });
    // Only forums are targets.
    await expect(
      w.call("threads.batchUpdate", w.admin, {
        threadIds: [a1],
        update: { action: "move", nodeId: w.category.id },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("sets and clears a prefix; a prefix that is not active is refused for that thread only", async () => {
    const { w, a1, a2 } = await setup();
    const prefix = await w.call("threadPrefixes.create", w.admin, {
      label: "News",
      colorId: w.ctx.sqlite
        .prepare<{ id: number }, []>("SELECT id FROM palette_colors WHERE kind = 'prefix' LIMIT 1")
        .get()!.id,
    });
    const set = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a1, a2],
      update: { action: "setPrefix", prefixId: prefix.id },
    });
    expect(set.results.map((r: { changed: boolean }) => r.changed)).toEqual([true, true]);
    expect([a1, a2].map((id) => row(w, id).prefix_id)).toEqual([prefix.id, prefix.id]);
    const cleared = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a1],
      update: { action: "setPrefix", prefixId: null },
    });
    expect(cleared.results[0].changed).toBe(true);
    expect(row(w, a1).prefix_id).toBeNull();
    const missing = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a1],
      update: { action: "setPrefix", prefixId: 9999 },
    });
    expect(missing.results[0].error).toMatchObject({ code: "validation" });
    expect(row(w, a1).prefix_id).toBeNull();
  });

  test("members get a refusal per thread, threads they cannot see are not found, guests are refused", async () => {
    const { w, a1 } = await setup();
    const hidden = (await w.thread(w.admin, w.secret.id, "Hidden")).thread.id as number;
    const out = await w.call("threads.batchUpdate", w.carol, {
      threadIds: [a1, hidden, 424242],
      update: { action: "stick" },
    });
    expect(out.results.map((r: { error: { code: string } | null }) => r.error?.code)).toEqual([
      "forbidden",
      "not_found",
      "not_found",
    ]);
    expect(row(w, a1).is_sticky).toBe(0);
    await expect(
      w.call("threads.batchUpdate", GUEST, { threadIds: [a1], update: { action: "stick" } }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("the list is bounded, non-empty and free of repeats", async () => {
    const { w, a1 } = await setup();
    const call = (threadIds: number[]) =>
      w.call("threads.batchUpdate", w.admin, { threadIds, update: { action: "lock" } });
    await expect(call([])).rejects.toBeInstanceOf(ValidationError);
    await expect(call([a1, a1])).rejects.toBeInstanceOf(ValidationError);
    await expect(call(Array.from({ length: 101 }, (_, i) => i + 1))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1_000);
    const out = await call(hundred);
    expect(out.results).toHaveLength(100);
    expect(
      out.results.every((r: { error: { code: string } }) => r.error.code === "not_found"),
    ).toBe(true);
  });

  test("a thread refused halfway through is rolled back alone", async () => {
    const { w, a1, a2 } = await setup();
    // A thread with a merge pending is refused after other items already wrote.
    w.ctx.sqlite
      .prepare(
        "INSERT INTO thread_transfers (thread_id, role, other_thread_id, job_key, created_at) VALUES (?1, 'merge_target', 99, 'k', 1)",
      )
      .run(a1);
    const out = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [a2, a1],
      update: { action: "delete" },
    });
    expect(out.results[0]).toMatchObject({ changed: true, error: null });
    expect(out.results[1].error).toMatchObject({ code: "conflict" });
    expect([row(w, a2).state, row(w, a1).state]).toEqual(["deleted", "visible"]);
    expect(logged(w, "thread.delete").map((e) => e.target_id)).toEqual([a2]);
  });
});

test("a nested write that throws is undone alone (the savepoint the batch relies on)", async () => {
  const { w, a1, a2 } = await setup();
  const lock = (id: number) =>
    w.ctx.sqlite.prepare("UPDATE threads SET is_locked = 1 WHERE id = ?1").run(id);
  writeTx(w.ctx, () => {
    lock(a1);
    expect(() =>
      writeTx(w.ctx, () => {
        lock(a2);
        throw new Error("refused after writing");
      }),
    ).toThrow("refused after writing");
  });
  expect([a1, a2].map((id) => row(w, id).is_locked)).toEqual([1, 0]);
});

test("a moderator revoked in another process is refused thread by thread, and nothing changes", async () => {
  const w = world();
  const t = (await w.thread(w.alice, w.open.id, "T")).thread.id as number;
  const group = (await w.call("groups.create", w.admin, { title: "Staff", rank: 40 })) as {
    id: number;
  };
  await w.call("permissions.set", w.admin, {
    groupId: group.id,
    entries: [
      { permission: "forum.lock", value: "allow" },
      { permission: "node.view", value: "allow" },
    ],
  });
  const staff = insertUser(w.ctx, { groupId: group.id });
  const database = sharedDatabase(w.ctx);
  try {
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, staff.id);
    expect(can(here, actor, "forum.lock", { nodeId: w.open.id })).toBe(true);
    await execute(elsewhere, getOperation("permissions.set"), w.admin, {
      groupId: group.id,
      entries: [{ permission: "forum.lock", value: "unset" }],
    });
    const out = (await execute(here, getOperation("threads.batchUpdate"), actor, {
      threadIds: [t],
      update: { action: "lock" },
    })) as { results: { error: { code: string } | null }[] };
    expect(out.results[0]!.error?.code).toBe("forbidden");
    expect(
      elsewhere.sqlite
        .prepare<{ is_locked: number }, [number]>("SELECT is_locked FROM threads WHERE id = ?1")
        .get(t)!.is_locked,
    ).toBe(0);
  } finally {
    database.close();
  }
});

test("repeating a lock or a pin notifies nobody: no event for a thread that did not change", async () => {
  const { w, a1 } = await setup();
  const events = () =>
    w.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM domain_events WHERE type = 'content.edited'",
      )
      .get()!.n;
  await w.call("threads.batchUpdate", w.mod, { threadIds: [a1], update: { action: "lock" } });
  const afterFirst = events();
  expect(afterFirst).toBeGreaterThan(0);
  await w.call("threads.batchUpdate", w.mod, { threadIds: [a1], update: { action: "lock" } });
  await w.call("threads.batchUpdate", w.mod, { threadIds: [a1], update: { action: "stick" } });
  await w.call("threads.batchUpdate", w.mod, { threadIds: [a1], update: { action: "stick" } });
  expect(events()).toBe(afterFirst + 1);
});
