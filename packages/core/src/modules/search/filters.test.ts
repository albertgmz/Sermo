import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { postsCreateOp, threadsCreateOp } from "../forums";
import { searchQueryOp } from "./index";

function fixture() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const ann = insertUser(ctx, { username: "ann" });
  const ben = insertUser(ctx, { username: "ben" });
  const category = insertNode(ctx, { type: "category", title: "Cat" });
  const forumA = insertNode(ctx, { parentId: category.id, title: "Alpha" });
  const forumB = insertNode(ctx, { parentId: category.id, title: "Beta" });
  invalidate(ctx, "node_tree");
  const prefix = (label: string) => {
    const { id } = ctx.sqlite
      .prepare<{ id: number }, [string]>(
        "INSERT INTO thread_prefixes (label, color_id, created_at, updated_at) VALUES (?1, (SELECT id FROM palette_colors WHERE kind = 'prefix' ORDER BY position LIMIT 1), 1, 1) RETURNING id",
      )
      .get(label)!;
    ctx.sqlite
      .prepare("INSERT INTO forum_prefixes (node_id, prefix_id) VALUES (?1, ?3), (?2, ?3)")
      .run(forumA.id, forumB.id, id);
    return id;
  };
  const search = (input: Record<string, unknown>, actor: Parameters<typeof execute>[2] = GUEST) =>
    execute(ctx, searchQueryOp, actor, { q: "needle", ...input } as never);
  return { ctx, admin, ann, ben, forumA, forumB, prefix, search };
}

describe("search filters", () => {
  test("authorId and prefixId narrow the results before the page is cut", async () => {
    const f = fixture();
    const bug = f.prefix("Bug");
    const idea = f.prefix("Idea");
    const annActor = userActor(f.ann);
    const benActor = userActor(f.ben);
    const make = (actor: typeof annActor, nodeId: number, title: string, prefixId: number) =>
      execute(f.ctx, threadsCreateOp, actor, {
        nodeId,
        title,
        body: `needle in ${title}`,
        prefixId,
      } as never);
    const t1 = await make(annActor, f.forumA.id, "Ann bug", bug);
    f.ctx.clock.advance(1000);
    const t2 = await make(benActor, f.forumA.id, "Ben bug", bug);
    f.ctx.clock.advance(1000);
    const t3 = await make(annActor, f.forumB.id, "Ann idea", idea);
    f.ctx.clock.advance(1000);
    const reply = await execute(f.ctx, postsCreateOp, benActor, {
      threadId: t3.thread.id,
      body: "needle reply",
    } as never);
    const ids = async (input: Record<string, unknown>) =>
      (await f.search(input)).items.map((item) => item.post.id);

    expect(await ids({})).toEqual([reply.id, t3.post.id, t2.post.id, t1.post.id]);
    expect(await ids({ authorId: f.ann.id })).toEqual([t3.post.id, t1.post.id]);
    expect(await ids({ prefixId: bug })).toEqual([t2.post.id, t1.post.id]);
    expect(await ids({ authorId: f.ann.id, prefixId: bug })).toEqual([t1.post.id]);
    // A reply carries its thread's prefix.
    expect(await ids({ prefixId: idea, authorId: f.ben.id })).toEqual([reply.id]);
    expect(await ids({ authorId: f.ann.id, nodeId: f.forumB.id })).toEqual([t3.post.id]);
    // Nobody wrote it / nothing carries it: an empty page, not an error.
    expect(await ids({ authorId: 99_999 })).toEqual([]);
    expect(await ids({ prefixId: 99_999 })).toEqual([]);

    // The filter acts inside the walk: a limit of one pages through matching posts only.
    const first = await f.search({ authorId: f.ann.id, limit: 1 });
    expect(first.items.map((item) => item.post.id)).toEqual([t3.post.id]);
    expect(first.nextCursor).not.toBeNull();
    const second = await f.search({ authorId: f.ann.id, limit: 1, cursor: first.nextCursor });
    expect(second.items.map((item) => item.post.id)).toEqual([t1.post.id]);
    expect(second.nextCursor).toBeNull();
  });

  test("each result's thread carries its forum and prefix", async () => {
    const f = fixture();
    const tag = f.prefix("Tagged");
    const annActor = userActor(f.ann);
    const tagged = await execute(f.ctx, threadsCreateOp, annActor, {
      nodeId: f.forumA.id,
      title: "With prefix",
      body: "needle one",
      prefixId: tag,
    } as never);
    f.ctx.clock.advance(1000);
    const plain = await execute(f.ctx, threadsCreateOp, annActor, {
      nodeId: f.forumB.id,
      title: "Without",
      body: "needle two",
    } as never);
    const { items } = await f.search({});
    expect(items.map((item) => item.thread)).toEqual([
      {
        id: plain.thread.id,
        title: "Without",
        nodeId: f.forumB.id,
        node: { id: f.forumB.id, title: "Beta" },
        prefix: null,
      },
      {
        id: tagged.thread.id,
        title: "With prefix",
        nodeId: f.forumA.id,
        node: { id: f.forumA.id, title: "Alpha" },
        prefix: { id: tag, label: "Tagged", color: "#60a5fa", icon: "" },
      },
    ]);
  });

  test("filters never reveal what the viewer cannot open", async () => {
    const f = fixture();
    const tag = f.prefix("Hidden tag");
    await execute(f.ctx, threadsCreateOp, f.admin, {
      nodeId: f.forumA.id,
      title: "Staff only",
      body: "needle secret",
      prefixId: tag,
    } as never);
    for (const group of [1, 2])
      f.ctx.sqlite
        .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, ?2, 0)")
        .run(f.forumA.id, group);
    invalidate(f.ctx, "permissions");
    const adminId = f.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM users WHERE group_id = 4")
      .get()!.id;
    expect((await f.search({ prefixId: tag })).items).toEqual([]);
    expect((await f.search({ authorId: adminId }, userActor(f.ben))).items).toEqual([]);
    expect((await f.search({ prefixId: tag }, f.admin)).items).toHaveLength(1);
  });
});
