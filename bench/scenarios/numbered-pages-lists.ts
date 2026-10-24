import type { Actor } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";
import { lastPage, middlePage, one, scenario } from "./numbered-pages";

// The dearest numbered page of the lists that take a page number besides the thread, tag and
// conversation lists (`numbered-pages.ts`): the search results, the member directory and its
// rankings, the alerts, the bookmarks and a member's posts and threads. Each target is worked out
// once in setup from the list's own total.
//
// What is dear differs by list:
// - the directory and the rankings are placed by a positional read from the nearer end of the list,
//   so their middle page skips the most;
// - the alerts are placed by an index-only read, so their last page skips the most;
// - the search results, the bookmarks and the profile lists are cut from one walk of the newest 500
//   items the viewer may see, whatever the page: the walk is measured on its last page, and for
//   the search also with a filter that leaves few matches, which examines the most candidates.

// The total of a list's first page, for the lists whose last page is not worth ten pages.
async function totalOf(
  env: BenchEnv,
  operation: string,
  actor: Actor,
  input: Record<string, unknown>,
) {
  const first = JSON.parse((await env.call(operation, actor, { ...input, page: 1 })) as string) as {
    total: number | null;
  };
  return first.total ?? 0;
}

// Bookmarks for the bookmarks scenario: one member, who has none in the seed, gets a bookmark on
// each of the random visible threads and posts of the seed's meta (about a thousand, more than the
// 500 the numbered pages hold). They carry a time of 1 so teardown finds them again and no other
// scenario's rows are touched.
const BOOKMARK_MARK = 1;
let bookmarkMember = 0;
function bookmarkRows(env: BenchEnv): number {
  const { memberIds, threadIds, postAuthors } = env.meta;
  bookmarkMember = memberIds.at(-1) ?? 0;
  if (bookmarkMember === 0 || threadIds.length < 500 || postAuthors.length < 500)
    throw new Error("The seed has too few threads, posts and members to bookmark.");
  const db = env.ctx.sqlite;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, ?2, ?3, ?4)",
  );
  db.transaction(() => {
    for (const id of threadIds) insert.run(bookmarkMember, "thread", id, BOOKMARK_MARK);
    for (const [id] of postAuthors) insert.run(bookmarkMember, "post", id, BOOKMARK_MARK);
  })();
  return bookmarkMember;
}
function removeBookmarkRows(env: BenchEnv): void {
  env.ctx.sqlite
    .prepare("DELETE FROM bookmarks WHERE user_id = ?1 AND created_at = ?2")
    .run(bookmarkMember, BOOKMARK_MARK);
}

const term = (env: BenchEnv, group: keyof BenchEnv["meta"]["searchTerms"], i = 0) => {
  const terms = env.meta.searchTerms[group];
  return terms[i % terms.length]!;
};

export const scenarios: Scenario[] = [
  // A common word: the walk fills its 500 results, the page is the last of them.
  scenario("search.query last page (common word)", "search.query", async (env) => [
    await lastPage(env, "search.query", env.actors.member(0), { q: term(env, "common") }),
  ]),
  // A common word in one small forum: few matches, so the walk examines all 1,000 candidates its
  // budget allows before it ends. Page 1, as the list holds fewer than ten pages.
  scenario("search.query first page (small forum)", "search.query", async (env) => {
    const smallest = one<{ id: number }>(
      env,
      "SELECT id FROM nodes WHERE type = 'forum' AND post_count > 0 ORDER BY post_count, id LIMIT 1",
      "no forum",
    );
    return [
      {
        actor: env.actors.member(0),
        input: { q: term(env, "common"), nodeId: smallest.id, page: 1 },
      },
    ];
  }),

  // The member directory, newest first, and the posts ranking, as a member and as a guest (a guest
  // is shown fewer members: closed profiles).
  scenario("users.list directory middle page (member)", "users.list", async (env) => [
    await middlePage(env, "users.list", env.actors.member(0), { sort: "newest" }),
  ]),
  scenario("users.list directory last page (guest)", "users.list", async (env) => [
    await lastPage(env, "users.list", env.actors.guest, { sort: "newest" }),
  ]),
  scenario("users.list ranking middle page (posts)", "users.list", async (env) => [
    await middlePage(env, "users.list", env.actors.member(0), { sort: "posts", ranked: true }),
  ]),

  // The member with the most alerts: all of them, and the unread ones.
  scenario("notifications.list last page (heaviest member)", "notifications.list", async (env) => {
    const id = env.meta.notificationHeavyUserIds[0];
    if (id === undefined) throw new Error("The seed has no member with alerts.");
    return [await lastPage(env, "notifications.list", env.actors.user(id), {})];
  }),
  scenario(
    "notifications.list unread page (heaviest member)",
    "notifications.list",
    async (env) => {
      const id = env.meta.notificationHeavyUserIds[0];
      if (id === undefined) throw new Error("The seed has no member with alerts.");
      const actor = env.actors.user(id);
      const total = await totalOf(env, "notifications.list", actor, { unreadOnly: true });
      const pages = Math.max(1, Math.ceil(total / 20));
      return [{ actor, input: { unreadOnly: true, page: pages } }];
    },
  ),

  // A member with a thousand bookmarks, about half on content that is still readable.
  scenario(
    "bookmarks.list last page",
    "bookmarks.list",
    async (env) => {
      const id = bookmarkRows(env);
      return [await lastPage(env, "bookmarks.list", env.actors.user(id), {})];
    },
    removeBookmarkRows,
  ),

  // The member with the most posts: as a guest, who is shown the least.
  scenario("posts.byAuthor last page", "posts.byAuthor", async (env) => {
    const id = env.meta.memberIds[0];
    if (id === undefined) throw new Error("The seed has no active member.");
    return [await lastPage(env, "posts.byAuthor", env.actors.guest, { userId: id })];
  }),
  scenario("threads.byAuthor last page", "threads.byAuthor", async (env) => {
    const id = env.meta.memberIds[0];
    if (id === undefined) throw new Error("The seed has no active member.");
    return [await lastPage(env, "threads.byAuthor", env.actors.member(1), { userId: id })];
  }),
];
