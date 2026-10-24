import { type Ctx, prepared } from "../../context";
import { type ThreadRow, threadRowsByIds } from "../forums";
import type { HubReach } from "./reach";

export { type HubReach, hubReach } from "./reach";

/**
 * The candidates of a tag page, newest activity first, read from indexes that already separate
 * what is hidden from nearly everyone. `thread_tags.vis` is the state of the thread: 1 visible,
 * 2 held for approval, 3 deleted or merged away. `thread_tags_hub` (tag, vis, sort_at, thread)
 * gives each state its own run, so a pile of deleted threads is never walked by a viewer who may
 * not see deleted ones, nor a pile of held ones by a viewer who may not see held ones;
 * `thread_tags_author` (tag, author, vis) finds the viewer's own held threads. Columns of the
 * thread are copied into thread_tags by triggers; who may see what is decided on the thread.
 */
export const hubSql = {
  byVis:
    "SELECT thread_id, sort_at, from_post FROM thread_tags INDEXED BY thread_tags_hub " +
    "WHERE tag_id = ?1 AND vis = ?2 AND (sort_at, thread_id) < (?3, ?4) " +
    "ORDER BY sort_at DESC, thread_id DESC LIMIT ?5",
  byAuthor:
    "SELECT thread_id, sort_at, from_post FROM thread_tags INDEXED BY thread_tags_author " +
    "WHERE tag_id = ?1 AND author_id = ?2 AND vis = ?3 AND (sort_at, thread_id) < (?4, ?5) " +
    "ORDER BY sort_at DESC, thread_id DESC LIMIT ?6",
};

export const VIS_VISIBLE = 1;
export const VIS_HELD = 2;
export const VIS_HIDDEN = 3;

type Candidate = { thread_id: number; sort_at: number; from_post: number };
type Key = readonly [number, number];

/** Candidates read in one batch, and the most one request examines in each stream. */
const BATCH = 256;
const BUDGET = 2048;

/** A candidate's thread passes the reach: its forum and gates, and its state for who may see it. */
function sees(reach: HubReach, thread: ThreadRow, fromPost: boolean): boolean {
  const mine = thread.user_id === reach.viewer;
  const place = reach.open.has(thread.node_id) || (mine && reach.own.has(thread.node_id));
  if (!place) return false;
  if (fromPost && !mine && !reach.readable.has(thread.node_id)) return false;
  if (thread.is_adult === 1 && !mine && reach.hidesAdult) return false;
  if (thread.merged_into_id !== null) return false;
  if (thread.state === "visible") return true;
  if (thread.state === "moderated") return mine || reach.moderated.has(thread.node_id);
  return reach.deleted.has(thread.node_id);
}

type Stream = { rows: ThreadRow[]; horizon: Key | null };

/**
 * Walks one index in batches until `need` visible threads are found, the index ends, or the
 * request has examined `BUDGET` entries; then `horizon` is where it stopped, and nothing older
 * is known.
 */
function walk(
  ctx: Ctx,
  read: (after: Key, size: number) => Candidate[],
  accept: (candidate: Candidate, thread: ThreadRow) => boolean,
  cursor: Key,
  need: number,
): Stream {
  const rows: ThreadRow[] = [];
  let after = cursor;
  let examined = 0;
  while (examined < BUDGET) {
    const batch = read(after, BATCH);
    if (batch.length === 0) return { rows, horizon: null };
    examined += batch.length;
    const threads = new Map(
      threadRowsByIds(
        ctx,
        batch.map((candidate) => candidate.thread_id),
      ).map((thread) => [thread.id, thread]),
    );
    for (const candidate of batch) {
      after = [candidate.sort_at, candidate.thread_id];
      const thread = threads.get(candidate.thread_id);
      if (thread && accept(candidate, thread)) rows.push(thread);
      if (rows.length >= need) return { rows, horizon: null };
    }
    if (batch.length < BATCH) return { rows, horizon: null };
  }
  return { rows, horizon: after };
}

/**
 * Up to `limit` threads carrying the tag within the reach, after `cursor` (`[sort_at, thread
 * id]` of the last row of the page before), newest first. A viewer's threads come from up to
 * four streams, each seeking its own run of an index: the visible ones, the held ones and the
 * deleted ones where they may see such threads in some forum, and their own held ones. When a
 * stream spends its budget before it has enough, `resume` is the key to continue from and
 * nothing older than it is returned; the page may be short, even empty. Callers check the site
 * is open.
 */
export function hubPage(
  ctx: Ctx,
  reach: HubReach,
  tagId: number,
  cursor: Key | null,
  limit: number,
): { rows: ThreadRow[]; resume: Key | null } {
  const start: Key = cursor ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const accept = (candidate: Candidate, thread: ThreadRow) =>
    sees(reach, thread, candidate.from_post === 1);
  const byVis = (vis: number) => (after: Key, size: number) =>
    prepared(ctx, "tags.hubVis", () =>
      ctx.sqlite.prepare<Candidate, [number, number, number, number, number]>(hubSql.byVis),
    ).all(tagId, vis, after[0], after[1], size);
  const streams: Stream[] = [walk(ctx, byVis(VIS_VISIBLE), accept, start, limit)];
  if (reach.moderated.size > 0) streams.push(walk(ctx, byVis(VIS_HELD), accept, start, limit));
  if (reach.deleted.size > 0) streams.push(walk(ctx, byVis(VIS_HIDDEN), accept, start, limit));
  // Their own held threads, found by author, never by walking the others': the fetch is of those.
  if (reach.viewer >= 0)
    streams.push(
      walk(
        ctx,
        (after, size) =>
          prepared(ctx, "tags.hubAuthor", () =>
            ctx.sqlite.prepare<Candidate, [number, number, number, number, number, number]>(
              hubSql.byAuthor,
            ),
          ).all(tagId, reach.viewer, VIS_HELD, after[0], after[1], size),
        accept,
        start,
        limit,
      ),
    );
  const merged = new Map<number, ThreadRow>();
  for (const stream of streams) for (const row of stream.rows) merged.set(row.id, row);
  const horizons = streams.flatMap((stream) => (stream.horizon ? [stream.horizon] : []));
  // Nothing older than the newest place a stream stopped at is certain.
  const resume = horizons.reduce<Key | null>(
    (best, key) =>
      best === null || key[0] > best[0] || (key[0] === best[0] && key[1] > best[1]) ? key : best,
    null,
  );
  const rows = [...merged.values()]
    .filter(
      (row) =>
        resume === null ||
        row.sort_at > resume[0] ||
        (row.sort_at === resume[0] && row.id >= resume[1]),
    )
    .sort((a, b) => b.sort_at - a.sort_at || b.id - a.id)
    .slice(0, limit);
  return { rows, resume: rows.length >= limit ? null : resume };
}

/** The threads of `hubPage`, without where to resume (for a probe or a count). */
export function hubThreads(
  ctx: Ctx,
  reach: HubReach,
  tagId: number,
  cursor: Key | null,
  limit: number,
): ThreadRow[] {
  return hubPage(ctx, reach, tagId, cursor, limit).rows;
}
