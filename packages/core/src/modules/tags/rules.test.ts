import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { evaluate, loadFacts } from "../../shared/criteria";
import { fillThreads, type World, world } from "../feed/fixtures.test";
import { customMember, setEntry } from "../permissions/group-fixture";
import { hubPage, hubReach } from "./hub";

const MEMBERS = 2;

function tagged(w: World, actor: World["alice"], title: string, tags: string[], body = "Text") {
  w.ctx.clock.advance(60_000);
  return w.call("threads.create", actor, { nodeId: w.open.id, title, body, tags });
}
const tagsOf = async (w: World, threadId: number, actor: World["alice"] = w.admin) =>
  (await w.call("threads.get", actor, { threadId })).tags as string[];
const rows = (w: World, sql: string) =>
  w.ctx.sqlite.prepare<Record<string, unknown>, []>(sql).all();
const tagCount = (w: World, userId: number) =>
  w.ctx.sqlite
    .prepare<{ tag_count: number }, [number]>("SELECT tag_count FROM users WHERE id = ?1")
    .get(userId)!.tag_count;
const idOf = (w: World, name: string) =>
  w.ctx.sqlite.prepare<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?1").get(name)!
    .id;

describe("a posting restriction", () => {
  async function restricted() {
    const w = world();
    const mine = await tagged(w, w.alice, "Mine", ["kept"], "Opening #first");
    await w.call("restrictions.create", w.admin, {
      userId: w.aliceUser.id,
      kind: "posting",
      reason: "Muted",
      expiresAt: null,
      notify: false,
    });
    // The request of a muted member resolves their restriction.
    return { w, mine, alice: resolvedActor(w.ctx, w.aliceUser.id) };
  }

  test("takes away setting the tags of a thread, listed or by the opening post", async () => {
    const { w, mine, alice } = await restricted();
    await expect(
      w.call("threads.update", alice, { threadId: mine.thread.id, tags: ["kept", "fresh"] }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("threads.update", alice, { threadId: mine.thread.id, tags: [] }),
    ).rejects.toThrow(ForbiddenError);
    // The opening post may still be edited, but its new hashtags tag nothing.
    await w.call("posts.update", alice, { postId: mine.post.id, body: "Opening #second" });
    expect(await tagsOf(w, mine.thread.id)).toEqual(["first", "kept"]);
    expect(rows(w, "SELECT name FROM tags ORDER BY name")).toEqual([
      { name: "first" },
      { name: "kept" },
    ]);
    expect(
      (await w.call("threads.get", alice, { threadId: mine.thread.id })).permissions.canEditTags,
    ).toBe(false);
  });

  test("takes away starting a thread with tags; the thread itself is a posting refusal first", async () => {
    const { w, alice } = await restricted();
    await expect(
      w.call("threads.create", alice, {
        nodeId: w.open.id,
        title: "T",
        body: "Text #word",
        tags: ["listed"],
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(rows(w, "SELECT name FROM tags WHERE name IN ('listed', 'word')")).toEqual([]);
  });

  test("a restriction that has been lifted gives them back", async () => {
    const { w, mine } = await restricted();
    const restriction = w.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM user_restrictions LIMIT 1")
      .get()!;
    await w.call("restrictions.lift", w.admin, {
      restrictionId: restriction.id,
      reason: "Sorry",
      notify: false,
    });
    await w.call("threads.update", resolvedActor(w.ctx, w.aliceUser.id), {
      threadId: mine.thread.id,
      tags: ["fresh"],
    });
    expect(await tagsOf(w, mine.thread.id)).toEqual(["fresh"]);
  });
});

describe("hashtags that are hidden in the opening post", () => {
  test("in a spoiler or a quote they tag nothing; the open one does", async () => {
    const w = world();
    const created = await tagged(
      w,
      w.alice,
      "Twist",
      [],
      "[SPOILER]#thekillerisbob[/SPOILER] [QUOTE=bob]quoted #qtag[/QUOTE] The #open one [ISPOILER]#inline[/ISPOILER]",
    );
    expect(await tagsOf(w, created.thread.id)).toEqual(["open"]);
    expect(rows(w, "SELECT name FROM tags")).toEqual([{ name: "open" }]);
    expect(created.post.bodyHtml).toContain('href="/tags/open"');
    expect(created.post.bodyHtml).not.toContain("thekillerisbob");
    // The author is credited with the one tag only.
    expect(tagCount(w, w.aliceUser.id)).toBe(1);
  });

  test("a tag that exists links inside a spoiler, a new name does not", async () => {
    const w = world();
    await tagged(w, w.bob, "Seed", ["known"]);
    const created = await tagged(w, w.alice, "Spoiled", [], "[SPOILER]#known #unknown[/SPOILER]");
    expect(await tagsOf(w, created.thread.id)).toEqual([]);
    const spoiler = await w.call("spoilers.get", w.alice, {
      contentType: "post",
      contentId: created.post.id,
      position: 0,
    });
    expect(spoiler.html).toContain('href="/tags/known"');
    expect(spoiler.html).not.toContain("/tags/unknown");
  });
});

describe("aliases outlive the threads of their tag", () => {
  test("a tag with old names is kept when its last thread loses it", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["js"]);
    await w.call("tags.rename", w.mod, { tagId: idOf(w, "js"), name: "javascript" });
    await w.call("threads.update", w.alice, { threadId: created.thread.id, tags: [] });
    expect(rows(w, "SELECT name, thread_count FROM tags")).toEqual([
      { name: "javascript", thread_count: 0 },
    ]);
    expect(rows(w, "SELECT name FROM tag_aliases")).toEqual([{ name: "js" }]);
    // No thread, so no page; the staff list still shows it with its old name.
    await expect(w.call("tags.get", w.alice, { name: "js" })).rejects.toThrow(NotFoundError);
    const listed = await w.call("tags.list", w.mod, {});
    expect(listed.items).toMatchObject([{ name: "javascript", threadCount: 0, aliases: ["js"] }]);
    // Someone who types the old name later reaches the same tag, not a new unrelated one.
    const again = await tagged(w, w.bob, "Again", ["js"]);
    expect(await tagsOf(w, again.thread.id)).toEqual(["javascript"]);
    expect(rows(w, "SELECT name FROM tags")).toEqual([{ name: "javascript" }]);
  });

  test("a tag with no old name still goes with its last thread, and a hard delete keeps the others", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["plain", "named"]);
    await w.call("tags.rename", w.mod, { tagId: idOf(w, "named"), name: "renamed" });
    await w.call("threads.delete", w.mod, { threadId: created.thread.id });
    await w.call("threads.hardDelete", w.admin, { threadId: created.thread.id, reason: "gone" });
    expect(rows(w, "SELECT name FROM tags")).toEqual([{ name: "renamed" }]);
  });
});

describe("a tag the writer cannot see in use", () => {
  async function hidden(w: World) {
    await w.call("threads.create", w.admin, {
      nodeId: w.secret.id,
      title: "Case",
      body: "Staff only",
      tags: ["investigation"],
    });
  }

  test("a reply links neither it nor a new name", async () => {
    const w = world();
    await hidden(w);
    const thread = await tagged(w, w.bob, "Open thread", []);
    const reply = await w.call("posts.create", w.alice, {
      threadId: thread.thread.id,
      body: "#investigation #nothere",
    });
    expect(reply.bodyHtml).toBe("<p>#investigation #nothere</p>");
    // The one who can see it in use gets the link.
    const staff = await w.call("posts.create", w.admin, {
      threadId: thread.thread.id,
      body: "#investigation #nothere",
    });
    expect(staff.bodyHtml).toContain('href="/tags/investigation"');
    expect(staff.bodyHtml).not.toContain("/tags/nothere");
  });

  test("listing it is judged as a new name is: refused without tag.create, taken with it", async () => {
    const w = world();
    await hidden(w);
    setEntry(w.ctx, MEMBERS, "tag.create", -1);
    for (const name of ["investigation", "nothere"])
      await expect(tagged(w, w.alice, "T", [name])).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, MEMBERS, "tag.create", 0);
    setEntry(w.ctx, MEMBERS, "tag.create", 1);
    // A writer who may make tags uses the existing tag without being told it was there.
    const made = await tagged(w, w.alice, "T", ["investigation"]);
    expect(await tagsOf(w, made.thread.id)).toEqual(["investigation"]);
    expect(rows(w, "SELECT name, thread_count FROM tags")).toEqual([
      { name: "investigation", thread_count: 2 },
    ]);
  });

  test("a tag used in a forum the writer can open is known to them, whatever the thread's state", async () => {
    const w = world();
    const created = await tagged(w, w.bob, "Seed", ["shared"]);
    await w.call("threads.delete", w.mod, { threadId: created.thread.id });
    setEntry(w.ctx, MEMBERS, "tag.create", -1);
    const reply = await tagged(w, w.alice, "Mine", [], "#shared");
    expect(reply.post.bodyHtml).toContain('href="/tags/shared"');
  });
});

describe("the tag page does not walk what is hidden", () => {
  /** Rows for `count` threads of a forum carrying a tag, newest first by `at`. */
  function bulk(
    w: World,
    tagId: number,
    nodeId: number,
    count: number,
    at: number,
    state = "visible",
  ) {
    const ids = fillThreads(w.ctx, nodeId, w.aliceUser.id, count, { at: (i) => at + i });
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = ?1 WHERE id IN (SELECT value FROM json_each(?2))")
      .run(state, JSON.stringify(ids));
    w.ctx.sqlite
      .prepare(
        "INSERT INTO thread_tags (thread_id, tag_id, added_by, sort_at, live, node_id, author_id, created_at) SELECT t.id, ?1, t.user_id, t.sort_at, t.state = 'visible', t.node_id, t.user_id, 1 FROM threads t WHERE t.id IN (SELECT value FROM json_each(?2))",
      )
      .run(tagId, JSON.stringify(ids));
    return ids;
  }
  const tag = (w: World, name: string) =>
    w.ctx.sqlite
      .prepare<{ id: number }, [string]>(
        "INSERT INTO tags (name, created_at) VALUES (?1, 1) RETURNING id",
      )
      .get(name)!.id;

  test("thousands of deleted threads are not read to find the few live ones", async () => {
    const w = world();
    const id = tag(w, "spam");
    bulk(w, id, w.open.id, 5000, 1_000_000, "deleted");
    const live = bulk(w, id, w.open.id, 3, 1);
    let candidates = 0;
    const prepare = w.ctx.sqlite.prepare.bind(w.ctx.sqlite);
    w.ctx.statements.clear();
    // biome-ignore lint/suspicious/noExplicitAny: counting what the candidate statements return
    (w.ctx.sqlite as any).prepare = (sql: string) => {
      // biome-ignore lint/suspicious/noExplicitAny: bun's statement type is generic over its rows
      const statement = prepare(sql) as any;
      if (!sql.includes("FROM thread_tags INDEXED BY thread_tags_hub")) return statement;
      const all = statement.all.bind(statement);
      statement.all = (...args: unknown[]) => {
        const found = all(...args) as unknown[];
        candidates += found.length;
        return found;
      };
      return statement;
    };
    try {
      const page = hubPage(w.ctx, hubReach(w.ctx, GUEST), id, null, 21);
      expect(page.rows.map((row) => row.id).sort()).toEqual([...live].sort());
      expect(page.resume).toBeNull();
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the original
      (w.ctx.sqlite as any).prepare = prepare;
      w.ctx.statements.clear();
    }
    expect(candidates).toBe(3);
    // Staff who may see the deleted ones page through them.
    const staff = hubPage(w.ctx, hubReach(w.ctx, w.admin), id, null, 21);
    expect(staff.rows).toHaveLength(21);
  });

  test("live threads in a forum closed to the viewer are given up on at a budget, and the page goes on from there", async () => {
    const w = world();
    const id = tag(w, "busy");
    // 2,100 newer threads in the forum guests cannot open, then two they can.
    bulk(w, id, w.secret.id, 2100, 1_000_000);
    const visible = bulk(w, id, w.open.id, 2, 1);
    const reach = hubReach(w.ctx, GUEST);
    const first = hubPage(w.ctx, reach, id, null, 21);
    expect(first.rows).toEqual([]);
    expect(first.resume).not.toBeNull();
    const second = hubPage(w.ctx, reach, id, first.resume, 21);
    expect(second.rows.map((row) => row.id).sort()).toEqual([...visible].sort());
    expect(second.resume).toBeNull();
    // The operation hands the viewer the key to go on with, on a page past the first.
    const resumed = await w.call("tags.threads", GUEST, {
      name: "busy",
      cursor: Buffer.from(JSON.stringify(first.resume)).toString("base64url"),
    });
    expect(resumed.items).toHaveLength(2);
  });

  test("a viewer's own held thread is found through their own index, among a pile of others", async () => {
    const w = world();
    const id = tag(w, "mine");
    bulk(w, id, w.open.id, 3000, 1_000_000, "moderated");
    const own = bulk(w, id, w.open.id, 1, 5, "moderated");
    w.ctx.sqlite
      .prepare("UPDATE threads SET user_id = ?1 WHERE id = ?2")
      .run(w.carolUser.id, own[0]!);
    w.ctx.sqlite
      .prepare("UPDATE thread_tags SET author_id = ?1 WHERE thread_id = ?2")
      .run(w.carolUser.id, own[0]!);
    const page = hubPage(w.ctx, hubReach(w.ctx, w.carol), id, null, 21);
    expect(page.rows.map((row) => row.id)).toEqual([own[0]!]);
    expect(hubPage(w.ctx, hubReach(w.ctx, w.bob), id, null, 21).rows).toEqual([]);
  });
});

describe("the triggers write only what changes", () => {
  test("a reply that leaves the thread's sort time as it was rewrites no tag row; a new one does", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["a", "b"]);
    w.ctx.sqlite.run("CREATE TEMP TABLE writes (n INTEGER)");
    w.ctx.sqlite.run(
      "CREATE TEMP TRIGGER count_writes AFTER UPDATE ON thread_tags BEGIN INSERT INTO writes VALUES (1); END",
    );
    const count = () =>
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM writes").get()!.n;
    w.ctx.sqlite
      .prepare(
        "UPDATE threads SET last_post_at = last_post_at, bumped_at = bumped_at WHERE id = ?1",
      )
      .run(created.thread.id);
    expect(count()).toBe(0);
    await w.reply(w.bob, created.thread.id, "A reply");
    expect(count()).toBe(2);
    const sorted = rows(w, "SELECT sort_at FROM thread_tags");
    const thread = rows(w, `SELECT sort_at FROM threads WHERE id = ${created.thread.id}`)[0]!;
    expect(sorted).toEqual([thread, thread]);
  });

  test("a thread that moves to another forum takes its tag rows along", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["a"]);
    const other = insertNode(w.ctx, { parentId: w.category.id });
    invalidate(w.ctx, "node_tree");
    await w.call("threads.move", w.mod, { threadId: created.thread.id, nodeId: other.id });
    expect(rows(w, "SELECT node_id FROM thread_tags")).toEqual([{ node_id: other.id }]);
  });
});

describe("a moderator who cannot read the text saves a tag list", () => {
  test("the tags its hashtags put there stay, the others are replaced", async () => {
    const w = world();
    const created = await tagged(w, w.bob, "T", ["manual"], "Text #fromtext");
    const manager = customMember(w.ctx, [
      "tag.manage",
      "tag.apply",
      "tag.create",
      "site.view",
      "node.view",
    ]);
    setEntry(w.ctx, manager.groupId, "forum.viewContent", -1, w.open.id);
    // They are shown the tags set by hand, and send them back with one more.
    expect(await tagsOf(w, created.thread.id, manager.actor)).toEqual(["manual"]);
    await w.call("threads.update", manager.actor, {
      threadId: created.thread.id,
      tags: ["manual", "added"],
    });
    expect(await tagsOf(w, created.thread.id)).toEqual(["added", "fromtext", "manual"]);
    await w.call("threads.update", manager.actor, { threadId: created.thread.id, tags: [] });
    expect(await tagsOf(w, created.thread.id)).toEqual(["fromtext"]);
    // Someone who reads the text replaces the whole list, as before.
    await w.call("threads.update", w.mod, { threadId: created.thread.id, tags: [] });
    expect(await tagsOf(w, created.thread.id)).toEqual([]);
  });

  test("tag.manage alone is not enough to set tags: tag.apply is needed as well", async () => {
    const w = world();
    const created = await tagged(w, w.bob, "T", ["a"]);
    const manager = customMember(w.ctx, ["tag.manage", "site.view", "node.view"]);
    await expect(
      w.call("threads.update", manager.actor, { threadId: created.thread.id, tags: ["b"] }),
    ).rejects.toThrow(ForbiddenError);
    expect(
      (await w.call("threads.get", manager.actor, { threadId: created.thread.id })).permissions
        .canEditTags,
    ).toBe(false);
  });
});

describe("what tags_added_at_least counts", () => {
  const rule = {
    match: "all" as const,
    conditions: [{ criterion: "tags_added_at_least", value: 2 }],
  };
  const holds = (w: World, userId: number) =>
    evaluate(rule, loadFacts(w.ctx, [userId], [rule]).get(userId)!);

  test("only the tags of visible threads, as post_count counts visible posts", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["a", "b"]);
    expect(tagCount(w, w.aliceUser.id)).toBe(2);
    expect(holds(w, w.aliceUser.id)).toBe(true);
    await w.call("threads.delete", w.mod, { threadId: created.thread.id });
    expect(tagCount(w, w.aliceUser.id)).toBe(0);
    expect(holds(w, w.aliceUser.id)).toBe(false);
    await w.call("threads.restore", w.mod, { threadId: created.thread.id });
    expect(tagCount(w, w.aliceUser.id)).toBe(2);
    // Tags added while the thread is hidden count when it comes back, not before.
    await w.call("threads.delete", w.mod, { threadId: created.thread.id });
    await w.call("threads.update", w.mod, { threadId: created.thread.id, tags: ["a", "b", "c"] });
    expect(tagCount(w, w.aliceUser.id)).toBe(0);
    expect(tagCount(w, actorUserId(w.mod)!)).toBe(0);
    await w.call("threads.restore", w.mod, { threadId: created.thread.id });
    expect(tagCount(w, w.aliceUser.id)).toBe(2);
    expect(tagCount(w, actorUserId(w.mod)!)).toBe(1);
  });

  test("a thread held for approval counts once it is approved", async () => {
    const w = world();
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_thread_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const held = await tagged(w, w.alice, "Held", ["a", "b"]);
    expect(held.thread.state).toBe("moderated");
    expect(tagCount(w, w.aliceUser.id)).toBe(0);
    await w.call("threads.restore", w.mod, { threadId: held.thread.id });
    expect(tagCount(w, w.aliceUser.id)).toBe(2);
  });

  test("the counters agree with a recount after every move of a thread", async () => {
    const w = world();
    const a = await tagged(w, w.alice, "A", ["x", "y"]);
    const b = await tagged(w, w.bob, "B", ["x"]);
    await w.call("threads.delete", w.mod, { threadId: a.thread.id });
    await w
      .call("threads.merge", w.mod, { threadId: b.thread.id, sourceThreadIds: [a.thread.id] })
      .catch(() => undefined);
    await w.call("threads.update", w.bob, { threadId: b.thread.id, tags: ["x", "z"] });
    for (const user of [w.aliceUser.id, w.bobUser.id]) {
      const recount = w.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM thread_tags tt JOIN threads t ON t.id = tt.thread_id WHERE tt.added_by = ?1 AND t.state = 'visible' AND t.merged_into_id IS NULL",
        )
        .get(user)!.n;
      expect(tagCount(w, user)).toBe(recount);
    }
    const live = rows(w, "SELECT count(*) AS n FROM thread_tags WHERE live = 1")[0];
    const visible = rows(
      w,
      "SELECT count(*) AS n FROM thread_tags tt JOIN threads t ON t.id = tt.thread_id WHERE t.state = 'visible' AND t.merged_into_id IS NULL",
    )[0];
    expect(live).toEqual(visible);
  });
});

describe("stale actors", () => {
  /** A staff member of a hand-made group that holds tag.manage, and another process that revokes it. */
  async function scenario() {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const group = (await execute(fixture, getOperation("groups.create"), founder, {
      title: "Taggers",
      rank: 40,
    })) as { id: number };
    await execute(fixture, getOperation("permissions.set"), founder, {
      groupId: group.id,
      entries: ["tag.manage", "node.view"].map((permission) => ({ permission, value: "allow" })),
    });
    const staff = insertUser(fixture, { groupId: group.id });
    const node = insertNode(fixture, {});
    invalidate(fixture, "node_tree");
    for (const [title, tags] of [
      ["One", ["one", "uno"]],
      ["Two", ["two"]],
    ] as const)
      await execute(fixture, getOperation("threads.create"), founder, {
        nodeId: node.id,
        title,
        body: "Text",
        tags,
      } as never);
    const database = sharedDatabase(fixture);
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, staff.id);
    return { database, here, elsewhere, actor, founder, group };
  }
  const snapshot = (ctx: Ctx) =>
    JSON.stringify([
      ctx.sqlite.prepare("SELECT id, name FROM tags ORDER BY id").all(),
      ctx.sqlite.prepare("SELECT tag_id, name FROM tag_aliases ORDER BY id").all(),
      ctx.sqlite.prepare("SELECT thread_id, tag_id FROM thread_tags ORDER BY id").all(),
      ctx.sqlite.prepare("SELECT action FROM moderator_log ORDER BY id").all(),
    ]);
  const attempts: Record<string, (ids: { one: number; two: number }) => [string, object]> = {
    "tags.rename": ({ one }) => ["tags.rename", { tagId: one, name: "renamed" }],
    "tags.merge": ({ one, two }) => ["tags.merge", { tagId: one, intoTagId: two }],
    "tags.delete": ({ one }) => ["tags.delete", { tagId: one }],
  };

  for (const [name, attempt] of Object.entries(attempts))
    test(`${name} is refused to a staff member revoked meanwhile`, async () => {
      const s = await scenario();
      try {
        const id = (tag: string) =>
          s.here.sqlite
            .prepare<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?1")
            .get(tag)!.id;
        const [operation, input] = attempt({ one: id("one"), two: id("two") });
        // Warm: the request that resolved the actor did hold the permission.
        await execute(s.here, getOperation("tags.list"), s.actor, {});
        await execute(s.elsewhere, getOperation("permissions.set"), s.founder, {
          groupId: s.group.id,
          entries: [{ permission: "tag.manage", value: "unset" }],
        });
        const before = snapshot(s.here);
        await expect(
          execute(s.here, getOperation(operation), s.actor, input),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(snapshot(s.here)).toBe(before);
      } finally {
        s.database.close();
      }
    });
});
