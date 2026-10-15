import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import { permissionsOf, viewableNodeIds } from "../../permissions";
import { type ThreadRow, threadRowsByIds } from "../forums";
import { readGates } from "../forums/read-gates";

/**
 * The candidates of a tag page, newest activity first, read from indexes that already separate
 * what is hidden from nearly everyone: `thread_tags_hub` (tag, live, sort_at, thread) holds the
 * threads that are visible and not merged away apart from the others, so a pile of deleted or
 * held threads is never walked by a viewer who cannot see them; `thread_tags_author` (tag, author)
 * finds the viewer's own threads of any state. Columns of the thread are copied into
 * thread_tags by triggers; who may see what is decided on the thread itself.
 */
export const hubSql = {
  byLive:
    "SELECT thread_id, sort_at, from_post, live FROM thread_tags INDEXED BY thread_tags_hub " +
    "WHERE tag_id = ?1 AND live = ?2 AND (sort_at, thread_id) < (?3, ?4) " +
    "ORDER BY sort_at DESC, thread_id DESC LIMIT ?5",
  byAuthor:
    "SELECT thread_id, sort_at, from_post, live FROM thread_tags INDEXED BY thread_tags_author " +
    "WHERE tag_id = ?1 AND author_id = ?2 AND (sort_at, thread_id) < (?3, ?4) " +
    "ORDER BY sort_at DESC, thread_id DESC LIMIT ?5",
};

type Candidate = { thread_id: number; sort_at: number; from_post: number; live: number };
type Key = readonly [number, number];

/** Candidates read in one batch, and the most one request examines in each stream. */
const BATCH = 256;
const BUDGET = 2048;

/** What a viewer reaches, worked out once: forum sets and the viewer. */
export interface HubReach {
  /** Forums whose other-member threads the viewer may open. */
  open: ReadonlySet<number>;
  /** Forums where only their own threads are open to them. */
  own: ReadonlySet<number>;
  /** Forums where they may see moderated threads, and where deleted ones. */
  moderated: ReadonlySet<number>;
  deleted: ReadonlySet<number>;
  /** Forums where they may read other members' text: a tag the opening post's hashtags put on a thread is that text. */
  readable: ReadonlySet<number>;
  /** The viewer's member id, -1 for a guest. */
  viewer: number;
}

/**
 * The reach of a viewer. With `indexable`, only what a search engine could index: visible
 * threads in forums whose threads and text are both open to the viewer (use it with the guest).
 */
export const hubReach = markPublic(
  "Applies the viewer's own reach: viewable forums, read gates, hidden states.",
  function hubReach(ctx: Ctx, actor: Actor, options: { indexable?: boolean } = {}): HubReach {
    const permissions = permissionsOf(ctx, actor);
    const gates = readGates(ctx, actor);
    const open = new Set<number>();
    const own = new Set<number>();
    const moderated = new Set<number>();
    const deleted = new Set<number>();
    const readable = new Set<number>();
    for (const nodeId of viewableNodeIds(ctx, actor)) {
      const reads = gates.readsOthers(nodeId);
      if (options.indexable) {
        if (gates.opensOthers(nodeId) && reads) open.add(nodeId);
        continue;
      }
      (gates.opensOthers(nodeId) ? open : own).add(nodeId);
      if (reads) readable.add(nodeId);
      if (permissions.can("forum.viewModerated", { nodeId })) moderated.add(nodeId);
      if (permissions.can("forum.viewDeleted", { nodeId })) deleted.add(nodeId);
    }
    return {
      open,
      own,
      moderated,
      deleted,
      readable: options.indexable ? open : readable,
      viewer: actorUserId(actor) ?? -1,
    };
  },
);

/** A candidate's thread passes the reach: its forum and gates, and its state for who may see it. */
function sees(reach: HubReach, thread: ThreadRow, fromPost: boolean): boolean {
  const mine = thread.user_id === reach.viewer;
  const place = reach.open.has(thread.node_id) || (mine && reach.own.has(thread.node_id));
  if (!place) return false;
  if (fromPost && !mine && !reach.readable.has(thread.node_id)) return false;
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
 * three streams, each seeking its own index: the live ones, the hidden ones in forums where they
 * may see hidden threads, and their own. When a stream spends its budget before it has enough,
 * `resume` is the key to continue from and nothing older than it is returned; the page may be
 * short. Callers check the site is open.
 */
export function hubPage(
  ctx: Ctx,
  reach: HubReach,
  tagId: number,
  cursor: Key | null,
  limit: number,
): { rows: ThreadRow[]; resume: Key | null } {
  const start: Key = cursor ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const byLive = (live: number) => (after: Key, size: number) =>
    prepared(ctx, "tags.hubLive", () =>
      ctx.sqlite.prepare<Candidate, [number, number, number, number, number]>(hubSql.byLive),
    ).all(tagId, live, after[0], after[1], size);
  const streams: Stream[] = [
    walk(
      ctx,
      byLive(1),
      (candidate, thread) => sees(reach, thread, candidate.from_post === 1),
      start,
      limit,
    ),
  ];
  if (reach.moderated.size > 0 || reach.deleted.size > 0)
    streams.push(
      walk(
        ctx,
        byLive(0),
        (candidate, thread) => sees(reach, thread, candidate.from_post === 1),
        start,
        limit,
      ),
    );
  if (reach.viewer >= 0)
    streams.push(
      walk(
        ctx,
        (after, size) =>
          prepared(ctx, "tags.hubAuthor", () =>
            ctx.sqlite.prepare<Candidate, [number, number, number, number, number]>(
              hubSql.byAuthor,
            ),
          ).all(tagId, reach.viewer, after[0], after[1], size),
        (candidate, thread) =>
          candidate.live === 0 && sees(reach, thread, candidate.from_post === 1),
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
