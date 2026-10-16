import type { BenchEnv, Scenario } from "../harness";

/*
 * The feed card's unread count and poll badge: one request for a page of 20 through the full app.
 * The seed has no thread activity inside the 30 days an unread flag lasts and no polls, so each
 * scenario prepares them in `setup` and puts them back in `teardown`, directly in the database.
 * `latest` walks the visible threads by last activity, so the threads woken here (given activity
 * in the last hours, newest first) are the ones the first page shows. The reader is a member with
 * no read marks at all, so every woken thread is unread for them. A scenario that measured an
 * ordinary feed read would hide the cost it is here to bound, so `setup` reads the page once and
 * throws, after putting everything back, unless the page carries what the scenario is about.
 */

type Item = {
  unread?: { count: number; more: boolean } | null;
  thread?: { pollKind: string | null };
};

let readerId = 0;
let originalActivity: { id: number; last_post_at: number }[] = [];

const wakeThreads = (env: BenchEnv, ids: number[]) => {
  const now = env.ctx.now();
  originalActivity = env.ctx.sqlite
    .prepare<{ id: number; last_post_at: number }, [string]>(
      "SELECT id, last_post_at FROM threads WHERE id IN (SELECT value FROM json_each(?1))",
    )
    .all(JSON.stringify(ids));
  const update = env.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2");
  // In the order given: the first is the newest.
  const at = new Map(ids.map((id, n) => [id, now - n * 60_000]));
  for (const row of originalActivity) update.run(at.get(row.id)!, row.id);
};

/** Puts back the activity times and removes the polls this file made (their creation time is 1). */
const restore = (env: BenchEnv) => {
  env.ctx.sqlite.prepare("DELETE FROM polls WHERE created_at = 1").run();
  const update = env.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2");
  for (const row of originalActivity) update.run(row.last_post_at, row.id);
  originalActivity = [];
};

/** A member of the seed with no read marks: nothing seeded is read, nothing seeded is replaced. */
const findReader = (env: BenchEnv) => {
  const reader = env.ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT u.id FROM users u WHERE u.group_id = 2 AND NOT EXISTS (SELECT 1 FROM thread_reads r WHERE r.user_id = u.id) ORDER BY u.id DESC LIMIT 1",
    )
    .get();
  if (!reader) throw new Error("Every seeded member has reads: no member to read nothing.");
  readerId = reader.id;
};

const newest = (env: BenchEnv, count: number) =>
  env.ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT id FROM threads WHERE state = 'visible' AND first_post_id IS NOT NULL ORDER BY id DESC LIMIT ?1",
    )
    .all(count)
    .map((row) => row.id);

const readPage = async (env: BenchEnv) =>
  ((await env.call("feed.list", env.actors.user(readerId), { limit: 20 })) as { items: Item[] })
    .items;

/** Prepares, then checks the first page; on a page that is not what the scenario needs, undoes it. */
async function prepare(
  env: BenchEnv,
  what: string,
  make: () => void,
  enough: (items: Item[]) => boolean,
) {
  // The reader is looked up before anything changes: a setup that throws gets no teardown.
  findReader(env);
  try {
    make();
    const items = await readPage(env);
    if (!enough(items))
      throw new Error(
        `The first page does not carry ${what}: the scenario would measure an ordinary feed read.`,
      );
  } catch (error) {
    restore(env);
    throw error;
  }
}

const withUnread = (items: Item[]) => items.filter((item) => item.unread).length;

const unreadFeed = (
  name: string,
  what: string,
  ids: (env: BenchEnv) => number[],
  enough: (items: Item[]) => boolean,
): Scenario => ({
  name,
  kind: "read",
  setup: (env) => prepare(env, what, () => wakeThreads(env, ids(env)), enough),
  teardown: restore,
  run: (env) => env.call("feed.list", env.actors.user(readerId), { limit: 20 }),
});

export const scenarios: Scenario[] = [
  // Typical threads: the first unread posts of 20 threads, a few replies each.
  unreadFeed(
    "feed.list latest unread counts",
    "unread counts on at least half of its entries",
    (env) => newest(env, 600),
    (items) => withUnread(items) >= 10,
  ),
  // The worst case: the seed's longest threads, each with more unread posts than the count's cap.
  unreadFeed(
    "feed.list latest unread counts, long threads",
    "capped unread counts (99+)",
    (env) => env.meta.bigThreadIds,
    (items) => items.some((item) => item.unread?.more),
  ),
  {
    // A poll on every other one of the 40 newest woken threads: the badge's statement for the page.
    name: "feed.list latest poll badges",
    kind: "read",
    setup: (env) =>
      prepare(
        env,
        "poll badges and unread counts",
        () => {
          const ids = newest(env, 600);
          wakeThreads(env, ids);
          env.ctx.sqlite
            .prepare(
              "INSERT INTO polls (thread_id, user_id, kind, max_choices, created_at, updated_at) SELECT id, user_id, 'poll', 1, 1, 1 FROM threads WHERE id IN (SELECT value FROM json_each(?1))",
            )
            .run(JSON.stringify(ids.slice(0, 40).filter((_, n) => n % 2 === 0)));
        },
        (items) => items.some((item) => item.thread?.pollKind) && withUnread(items) >= 10,
      ),
    teardown: restore,
    run: (env) => env.call("feed.list", env.actors.user(readerId), { limit: 20 }),
  },
];
