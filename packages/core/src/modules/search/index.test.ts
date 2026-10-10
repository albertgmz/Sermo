import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { encodeCursor } from "../../pagination";
import {
  postsCreateOp,
  postsDeleteOp,
  postsUpdateOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsUpdateOp,
} from "../forums";
import { searchQueryOp, searchSql } from "./index";

function fixture() {
  const ctx = createTestContext();
  const author = userActor(insertUser(ctx));
  const member = userActor(insertUser(ctx));
  const forum = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  return { ctx, author, member, forum };
}
const search = (
  ctx: ReturnType<typeof createTestContext>,
  actor: typeof GUEST | ReturnType<typeof userActor>,
  q: string,
  more: Record<string, unknown> = {},
) => execute(ctx, searchQueryOp, actor, { q, ...more });

describe("search.query", () => {
  test("search.use controls guests and custom groups", async () => {
    const { ctx } = fixture();
    const guest = ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM permission_definitions WHERE key = 'search.use'")
      .get()!.id;
    expect((await search(ctx, GUEST, "needle")).items).toEqual([]);
    ctx.sqlite
      .prepare(
        "UPDATE permission_entries SET value = -1 WHERE permission_id = ?1 AND node_id = 0 AND group_id = 1 AND user_id = 0",
      )
      .run(guest);
    await expect(search(ctx, GUEST, "needle")).rejects.toBeInstanceOf(ForbiddenError);

    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Search members', 10) RETURNING id",
      )
      .get()!.id;
    const member = userActor(insertUser(ctx, { groupId }));
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, 1)",
      )
      .run(guest, groupId);
    expect((await search(ctx, member, "needle")).items).toEqual([]);
    ctx.sqlite
      .prepare(
        "UPDATE permission_entries SET value = -1 WHERE permission_id = ?1 AND node_id = 0 AND group_id = ?2 AND user_id = 0",
      )
      .run(guest, groupId);
    await expect(search(ctx, member, "needle")).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("whole words, accents, title restriction, edits, and literal FTS punctuation", async () => {
    const { ctx, author, forum } = fixture();
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Café guide",
      body: "**Rainbow** needles near syntax",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: made.thread.id,
      body: "rainbow field",
    });
    expect((await search(ctx, GUEST, "CAFE")).items.map((r) => r.post.id)).toEqual([made.post.id]);
    expect((await search(ctx, GUEST, "rainbow needles")).items.map((r) => r.post.id)).toEqual([
      made.post.id,
    ]);
    expect((await search(ctx, GUEST, "rainbow", { titlesOnly: true })).items).toHaveLength(0);
    expect((await search(ctx, GUEST, "cafe", { titlesOnly: true })).items).toHaveLength(1);
    expect((await search(ctx, GUEST, '" * - : (NEAR)')).items.map((r) => r.post.id)).toEqual([
      made.post.id,
    ]);
    expect(
      (await search(ctx, GUEST, "rainbow")).items.find((r) => r.post.id === made.post.id)?.post
        .excerpt,
    ).toContain("Rainbow needles");
    await execute(ctx, postsUpdateOp, author, { postId: reply.id, body: "violet meadow" });
    expect((await search(ctx, GUEST, "violet")).items[0]?.post.id).toBe(reply.id);
    expect((await search(ctx, GUEST, "rainbow")).items.map((r) => r.post.id)).not.toContain(
      reply.id,
    );
    await execute(ctx, threadsUpdateOp, author, { threadId: made.thread.id, title: "Azure guide" });
    expect((await search(ctx, GUEST, "cafe", { titlesOnly: true })).items).toHaveLength(0);
    expect((await search(ctx, GUEST, "azure", { titlesOnly: true })).items[0]?.post.id).toBe(
      made.post.id,
    );
    await expect(search(ctx, GUEST, "***")).rejects.toBeInstanceOf(ValidationError);
  });

  test("visibility, hidden nodes, subtree, and stable pagination", async () => {
    const { ctx, author, member, forum } = fixture();
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const child = insertNode(ctx, { parentId: forum.id });
    const other = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const a = await execute(ctx, threadsCreateOp, author, {
      nodeId: child.id,
      title: "T",
      body: "signal",
    });
    const b = await execute(ctx, threadsCreateOp, author, {
      nodeId: other.id,
      title: "T",
      body: "signal",
    });
    const c = await execute(ctx, postsCreateOp, author, { threadId: a.thread.id, body: "signal" });
    const d = await execute(ctx, postsCreateOp, author, { threadId: a.thread.id, body: "signal" });
    await execute(ctx, postsDeleteOp, moderator, { postId: c.id });
    expect(
      (await search(ctx, member, "signal", { nodeId: forum.id })).items.map((r) => r.post.id),
    ).toEqual([d.id, a.post.id]);
    const first = await search(ctx, GUEST, "signal", { limit: 1 });
    const second = await search(ctx, GUEST, "signal", { limit: 1, cursor: first.nextCursor });
    const third = await search(ctx, GUEST, "signal", { limit: 1, cursor: second.nextCursor });
    expect([first.items[0]?.post.id, second.items[0]?.post.id, third.items[0]?.post.id]).toEqual([
      d.id,
      b.post.id,
      a.post.id,
    ]);
    await execute(ctx, threadsDeleteOp, moderator, { threadId: b.thread.id });
    expect((await search(ctx, GUEST, "signal")).items.map((r) => r.post.id)).toEqual([
      d.id,
      a.post.id,
    ]);
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await expect(search(ctx, member, "signal", { nodeId: forum.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await search(ctx, member, "signal")).items).toHaveLength(0);
    expect((await search(ctx, GUEST, "signal", { nodeId: forum.id })).items).toHaveLength(2);
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 1, 0)")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await expect(search(ctx, GUEST, "signal", { nodeId: forum.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("1,000 candidate cap returns a short page and resumable cursor", async () => {
    const { ctx, author, forum } = fixture();
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "T",
      body: "needle",
    });
    const authorId = author.kind === "guest" ? 0 : author.userId;
    const add = ctx.sqlite.prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'deleted', 1) RETURNING id",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'needle', 'needle')",
    );
    for (let i = 1; i <= 1001; i++) body.run(add.get(made.thread.id, authorId, i)!.id);
    const page = await search(ctx, GUEST, "needle", { limit: 20 });
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).not.toBeNull();
    const resumed = await search(ctx, GUEST, "needle", { limit: 20, cursor: page.nextCursor });
    expect(resumed.items.map((r) => r.post.id)).toEqual([made.post.id]);
  });

  test("moderated posts and threads stay out of search for authors and moderators", async () => {
    const { ctx, author, forum } = fixture();
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Hiddenword",
      body: "hiddenword",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: made.thread.id,
      body: "hiddenword",
    });
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(reply.id);
    expect((await search(ctx, author, "hiddenword")).items.map((item) => item.post.id)).toEqual([
      made.post.id,
    ]);
    expect((await search(ctx, moderator, "hiddenword")).items).toHaveLength(1);
    ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(made.thread.id);
    expect((await search(ctx, author, "hiddenword")).items).toHaveLength(0);
    expect((await search(ctx, moderator, "hiddenword")).items).toHaveLength(0);
  });

  test("hot queries use indexed plans", () => {
    const { ctx } = fixture();
    expectNoTableScan(ctx, searchSql.candidates, ['"needle"', Number.MAX_SAFE_INTEGER, 101]);
    expectNoTableScan(ctx, searchSql.details, ["[1]"]);
    expectNoTableScan(ctx, searchSql.bodies, ["[1]"]);
  });

  test("FTS operators are literal words, extra words are capped, and bad cursors reject", async () => {
    const { ctx, author, forum } = fixture();
    const words = "one two three four five six seven eight nine ten";
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Title",
      body: `${words} body`,
    });
    expect(
      (await search(ctx, GUEST, `^ ${words} absent`)).items.map((item) => item.post.id),
    ).toEqual([made.post.id]);
    expect((await search(ctx, GUEST, "title:")).items.map((item) => item.post.id)).toEqual([
      made.post.id,
    ]);
    expect((await search(ctx, GUEST, "{title body}:")).items.map((item) => item.post.id)).toEqual([
      made.post.id,
    ]);
    await expect(search(ctx, GUEST, "title", { cursor: "garbage" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("well-formed cursors with invalid search positions reject", async () => {
    const { ctx } = fixture();
    for (const values of [[0], [-1], ["1"], [1, 2]]) {
      await expect(
        search(ctx, GUEST, "needle", { cursor: encodeCursor(values) }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  test("25 matches paginate without gaps and excerpts preserve text and code points", async () => {
    const { ctx, author, forum } = fixture();
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "T",
      body: "needle",
    });
    const ids = [made.post.id];
    for (let i = 0; i < 24; i++) {
      ids.push(
        (await execute(ctx, postsCreateOp, author, { threadId: made.thread.id, body: "needle" }))
          .id,
      );
    }
    const found: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await search(ctx, GUEST, "needle", { limit: 4, cursor: cursor ?? undefined });
      found.push(...page.items.map((item) => item.post.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(found).toEqual(ids.reverse());
    const decorated = await execute(ctx, postsCreateOp, author, {
      threadId: made.thread.id,
      body: "needle <b>C#</b> snake_case 15! **bold** [link](https://example.test)",
    });
    const excerpt = (await search(ctx, GUEST, "needle")).items.find(
      (item) => item.post.id === decorated.id,
    )?.post.excerpt;
    expect(excerpt).toBe("needle C# snake_case 15! bold link");
    const long = await execute(ctx, postsCreateOp, author, {
      threadId: made.thread.id,
      body: `needle ${"a".repeat(192)}😀Z`,
    });
    const tail = (await search(ctx, GUEST, "needle")).items.find((item) => item.post.id === long.id)
      ?.post.excerpt;
    expect(Array.from(tail ?? "")).toHaveLength(200);
    expect(tail?.endsWith("😀")).toBe(true);
  });
});
