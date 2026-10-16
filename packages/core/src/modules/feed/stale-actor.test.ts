import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { setEntry } from "../permissions/group-fixture";

const run = (ctx: Ctx, name: string, actor: Actor, input: object) =>
  execute(ctx, getOperation(name), actor, input);

/**
 * A member and a forum; `here` is the member's process (actor resolved, permission state warm),
 * `elsewhere` another process, where an administrator closes the site to members after the
 * request began.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const member = insertUser(fixture);
  const forum = insertNode(fixture, {});
  const later = insertNode(fixture, {});
  invalidate(fixture, "node_tree");
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, member.id);
  // Warm: the member may use the feed's own writes.
  await run(here, "feed.hideForum", actor, { nodeId: forum.id, hidden: true });
  const saved = (await run(here, "feed.saveFilter", actor, {
    name: "Mine",
    scope: "latest",
    filter: {},
  })) as { id: number };
  const close = () =>
    run(elsewhere, "permissions.set", founder, {
      groupId: 2,
      entries: [{ permission: "site.view", value: "never" }],
    });
  const count = (table: string) =>
    elsewhere.sqlite.prepare<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;
  return { database, here, elsewhere, actor, forum, later, saved, close, count };
}

test("a member the site was closed to since the request began writes nothing", async () => {
  const s = await scenario();
  try {
    await s.close();
    await expect(
      run(s.here, "feed.saveFilter", s.actor, { name: "Late", scope: "latest", filter: {} }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      run(s.here, "feed.deleteFilter", s.actor, { filterId: s.saved.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      run(s.here, "feed.hideForum", s.actor, { nodeId: s.forum.id, hidden: false }),
    ).rejects.toThrow(ForbiddenError);
    expect(s.count("feed_filters")).toBe(1);
    expect(s.count("feed_hidden_nodes")).toBe(1);
  } finally {
    s.database.close();
  }
});

test("a forum closed to the member since the request began cannot be hidden", async () => {
  const s = await scenario();
  try {
    // Elsewhere, the forum is closed to members after the request began.
    setEntry(s.elsewhere, 2, "node.view", -1, s.later.id);
    await expect(
      run(s.here, "feed.hideForum", s.actor, { nodeId: s.later.id, hidden: true }),
    ).rejects.toThrow(NotFoundError);
    expect(s.count("feed_hidden_nodes")).toBe(1);
  } finally {
    s.database.close();
  }
});
