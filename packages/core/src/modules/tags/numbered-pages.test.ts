import { describe, expect, test } from "bun:test";
import { TAG_PAGES_MAX } from "../../contracts/tags";
import { type World, world } from "../feed/fixtures.test";

const titles = (items: { title: string }[]) => items.map((item) => item.title);

/** A thread of `actor` in a forum, one minute after the last, carrying the tag `news`. */
function tagged(w: World, actor: World["alice"], title: string, nodeId = w.open.id) {
  w.ctx.clock.advance(60_000);
  return w.call("threads.create", actor, { nodeId, title, body: "Text", tags: ["news"] });
}

describe("tags.threads numbered pages", () => {
  async function five() {
    const w = world();
    for (const title of ["1", "2", "3", "4", "5"]) await tagged(w, w.alice, title);
    // In a forum members cannot open: never on their pages, never counted for them.
    await tagged(w, w.admin, "secret", w.secret.id);
    const page = (actor: World["alice"], number: number) =>
      w.call("tags.threads", actor, { name: "news", page: number, limit: 2 });
    return { w, page };
  }

  test("pages run from the newest activity and count what the viewer may open", async () => {
    const { w, page } = await five();
    const [one, two, three, past] = await Promise.all(
      [1, 2, 3, 4].map((number) => page(w.bob, number)),
    );
    expect(titles(one.items)).toEqual(["5", "4"]);
    expect(titles(two.items)).toEqual(["3", "2"]);
    expect(titles(three.items)).toEqual(["1"]);
    expect(three.nextCursor).toBeNull();
    expect(past.items).toEqual([]);
    for (const answer of [one, two, three, past]) expect(answer.total).toBe(5);
    const staff = await page(w.admin, 1);
    expect(staff.total).toBe(6);
    expect(titles(staff.items)).toEqual(["secret", "5"]);
    // A cursor walk carries no count, and goes on from a numbered page as the next one starts.
    const next = await w.call("tags.threads", w.bob, {
      name: "news",
      limit: 2,
      cursor: one.nextCursor,
    });
    expect(titles(next.items)).toEqual(["3", "2"]);
    expect(next.total).toBeNull();
  });

  test("a deleted thread counts only for those who may see deleted threads", async () => {
    const { w, page } = await five();
    const ids = w.ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM threads WHERE title = ?1")
      .get("4")!;
    await w.call("threads.delete", w.mod, { threadId: ids.id, reason: "", notify: false });
    const member = await page(w.bob, 1);
    expect(member.total).toBe(4);
    expect(titles(member.items)).toEqual(["5", "3"]);
    // Moderators also open the staff forum: its thread, and the deleted one, count for them.
    const staff = await page(w.mod, 2);
    expect(staff.total).toBe(6);
    expect(titles(staff.items)).toEqual(["4", "3"]);
  });

  test(`the numbered pages hold the newest ${TAG_PAGES_MAX} threads, as XenForo's tag page`, async () => {
    const w = world();
    const first = await tagged(w, w.alice, "seed");
    // Copies of the thread, each newer than the last, carrying the tag: more than the pages hold.
    const columns = w.ctx.sqlite
      .prepare<{ name: string }, []>("SELECT name FROM pragma_table_info('threads')")
      .all()
      .map((column) => column.name)
      .filter((name) => name !== "id");
    const copied = columns
      .map((name) =>
        name === "title"
          ? "'copy ' || n"
          : ["last_post_at", "sort_at"].includes(name)
            ? `${name} + n * 1000`
            : name,
      )
      .join(", ");
    w.ctx.sqlite.run(
      `WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < ${TAG_PAGES_MAX + 4}) ` +
        `INSERT INTO threads (${columns.join(", ")}) SELECT ${copied} FROM threads, k WHERE threads.id = ${first.thread.id}`,
    );
    w.ctx.sqlite.run(
      "INSERT INTO thread_tags (thread_id, tag_id, added_by, from_post, sort_at, vis, node_id, author_id, created_at) " +
        "SELECT t.id, tt.tag_id, tt.added_by, tt.from_post, t.sort_at, tt.vis, tt.node_id, tt.author_id, tt.created_at " +
        `FROM threads t, thread_tags tt WHERE tt.thread_id = ${first.thread.id} AND t.title LIKE 'copy %'`,
    );
    const limit = 100;
    const last = TAG_PAGES_MAX / limit;
    const end = await w.call("tags.threads", w.bob, { name: "news", page: last, limit });
    expect(end.total).toBe(TAG_PAGES_MAX);
    expect(end.items).toHaveLength(limit);
    expect(end.items.at(-1).title).toBe("copy 5");
    // The pages end there; the cursor walks on to the older ones.
    expect(
      (await w.call("tags.threads", w.bob, { name: "news", page: last + 1, limit })).items,
    ).toEqual([]);
    const beyond = await w.call("tags.threads", w.bob, { name: "news", cursor: end.nextCursor });
    expect(titles(beyond.items)).toEqual(["copy 4", "copy 3", "copy 2", "copy 1", "seed"]);
  });
});
