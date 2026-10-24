import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { SEARCH_PAGES_MAX } from "../../contracts/search";
import { execute } from "../../operation";
import { postsCreateOp, postsDeleteOp, threadsCreateOp } from "../forums";
import { searchQueryOp } from "./index";

function fixture() {
  const ctx = createTestContext();
  const authorUser = insertUser(ctx);
  const author = userActor(authorUser);
  const other = userActor(insertUser(ctx));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const forum = insertNode(ctx, {});
  const secret = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  ctx.sqlite
    .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
    .run(secret.id);
  ctx.sqlite
    .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 1, 0)")
    .run(secret.id);
  invalidate(ctx, "permissions");
  return { ctx, author, authorUser, other, moderator, forum, secret };
}
type Fixture = ReturnType<typeof fixture>;

const search = (
  f: Fixture,
  actor: Fixture["author"] | typeof GUEST,
  more: Record<string, unknown>,
) => execute(f.ctx, searchQueryOp, actor, { q: "needle", ...more });
const post = (f: Fixture, nodeId: number, actor = f.author) =>
  execute(f.ctx, threadsCreateOp, actor, { nodeId, title: "T", body: "needle" }).then(
    (made) => made.post.id,
  );
const ids = (list: { items: { post: { id: number } }[] }) => list.items.map((item) => item.post.id);

describe("search.query numbered pages", () => {
  test("first, middle and last page, newest first, with the count of what the viewer may see", async () => {
    const f = fixture();
    const made: number[] = [];
    for (let i = 0; i < 5; i++) made.push(await post(f, f.forum.id));
    // Out of sight of members and guests: neither listed nor counted for them.
    const hidden = await post(f, f.secret.id, f.moderator);
    const deleted = await execute(f.ctx, postsCreateOp, f.author, {
      threadId: (
        await execute(f.ctx, threadsCreateOp, f.author, {
          nodeId: f.forum.id,
          title: "T",
          body: "x",
        })
      ).thread.id,
      body: "needle",
    });
    await execute(f.ctx, postsDeleteOp, f.moderator, { postId: deleted.id });

    const at = (number: number) => search(f, f.other, { page: number, limit: 2 });
    const [one, two, three, four] = await Promise.all([1, 2, 3, 4].map(at));
    expect(ids(one!)).toEqual([made[4]!, made[3]!]);
    expect(ids(two!)).toEqual([made[2]!, made[1]!]);
    expect(ids(three!)).toEqual([made[0]!]);
    expect(ids(four!)).toEqual([]);
    for (const list of [one, two, three, four]) expect(list!.total).toBe(5);
    expect(one!.nextCursor).not.toBeNull();
    expect(three!.nextCursor).toBeNull();
    expect((await search(f, GUEST, { page: 1 })).total).toBe(5);
    // A moderator sees the one in the staff forum as well.
    expect((await search(f, f.moderator, { page: 1, limit: 20 })).total).toBe(6);
    expect(ids(await search(f, f.moderator, { page: 1, limit: 1 }))).toEqual([hidden]);
    // The cursor goes on from the page's last result; a walk by cursor carries no count.
    const next = await search(f, f.other, { cursor: one!.nextCursor!, limit: 2 });
    expect(ids(next)).toEqual(ids(two!));
    expect(next.total).toBeNull();
    expect((await search(f, f.other, { limit: 2 })).total).toBeNull();
  });

  test("a filter narrows the pages and the count", async () => {
    const f = fixture();
    const mine = await post(f, f.forum.id);
    await post(f, f.forum.id, f.other);
    await post(f, f.forum.id, f.other);
    const filtered = await search(f, f.other, { page: 1, authorId: f.authorUser.id });
    expect(ids(filtered)).toEqual([mine]);
    expect(filtered.total).toBe(1);
    expect((await search(f, f.other, { page: 1 })).total).toBe(3);
  });

  test("the numbered pages hold the newest SEARCH_PAGES_MAX results, and a cursor goes on", async () => {
    const f = fixture();
    const first = await post(f, f.forum.id);
    const threadId = f.ctx.sqlite
      .prepare<{ thread_id: number }, [number]>("SELECT thread_id FROM posts WHERE id = ?1")
      .get(first)!.thread_id;
    const add = f.ctx.sqlite.prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', 1) RETURNING id",
    );
    const body = f.ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'needle', 'needle')",
    );
    for (let i = 1; i <= SEARCH_PAGES_MAX + 20; i++)
      body.run(add.get(threadId, f.authorUser.id, i)!.id);
    const last = SEARCH_PAGES_MAX / 20;
    const final = await search(f, f.other, { page: last, limit: 20 });
    expect(final.items).toHaveLength(20);
    expect(final.total).toBe(SEARCH_PAGES_MAX);
    expect(final.nextCursor).not.toBeNull();
    const beyond = await search(f, f.other, { page: last + 1, limit: 20 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(SEARCH_PAGES_MAX);
    // The cursor of the last numbered page reaches the results the pages left out.
    const rest = await search(f, f.other, { cursor: final.nextCursor!, limit: 50 });
    expect(rest.items).toHaveLength(21);
    expect(rest.items.at(-1)!.post.id).toBe(first);
  });
});
