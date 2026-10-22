import type { SQLQueryBindings } from "bun:sqlite";
import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, invalidate, prepared } from "../../context";
import * as contracts from "../../contracts/forums";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { currentActor, getNodeTree, requirePermission } from "../../permissions";
import { confirmActorPassword } from "../admin/shared";
import { releaseFile } from "../images/attach";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs";
import { appendModeratorLog } from "../moderation";
import { PURGE_CHUNK, pollNeedingBatches, purgePollBatch, purgeThread } from "../purge/purge";
import { readSiteSettings, storeSiteSettings } from "../settings";
import {
  adjustAuthorsForMove,
  changeThreadState,
  nodeCountsPosts,
  purgeThreadChunk,
  type ThreadRow,
  threadColumns,
  threadPostsToPurge,
  updateNodeLast,
} from "./index";
import { moveUpKeepingView } from "./move-up-view";

export const NODE_DELETE_JOB = "forums.deleteNode";
export const nodeDeleteKey = (nodeId: number) => `${NODE_DELETE_JOB}.${nodeId}`;

/** The most threads a chunk moves, and the most posts they may hold between them. */
export const MOVE_THREADS = 100;
export const MOVE_POSTS = 5000;
/** The most threads a chunk removes for good; its posts are bounded by `PURGE_CHUNK`. */
export const DELETE_THREADS = 20;
/** How long the job waits when every thread left is mid-merge or mid-split. */
const BLOCKED_RETRY_MS = 30_000;

const Id = z.number().int().positive();
const State = z.object({
  nodeId: Id,
  threads: z.discriminatedUnion("action", [
    z.object({ action: z.literal("move"), nodeId: Id }),
    z.object({ action: z.literal("delete") }),
  ]),
  children: z.enum(["moveUp", "delete"]),
  actorId: Id,
  title: z.string(),
  /** Totals so far, for the closing log entry. */
  moved: z.number().int().nonnegative(),
  removedThreads: z.number().int().nonnegative(),
  removedPosts: z.number().int().nonnegative(),
});
type NodeDeleteState = z.infer<typeof State>;

export const nodeDeleteSql = {
  /** The node and every node under it, deepest first. */
  subtree:
    "WITH RECURSIVE sub(id, depth) AS (SELECT id, 0 FROM nodes WHERE id = ?1 UNION ALL SELECT n.id, sub.depth + 1 FROM nodes n JOIN sub ON n.parent_id = sub.id) SELECT id FROM sub ORDER BY depth DESC, id",
  /** Threads of a node a chunk can take: a range of an index on the node, in no order. */
  get free() {
    return `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND NOT EXISTS (SELECT 1 FROM thread_transfers x WHERE x.thread_id = threads.id) LIMIT ?2`;
  },
  any: "SELECT 1 AS n FROM threads WHERE node_id = ?1 LIMIT 1",
  targetType: "SELECT type FROM nodes WHERE id = ?1",
  lastPosition: "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1",
  /** A deletion under way for the node or one above it. */
  underway: "SELECT 1 AS n FROM jobs WHERE unique_key = ?1",
  /** A running deletion that moves its threads to the forum `?1`. */
  targeted:
    "SELECT json_extract(payload, '$.title') AS title FROM jobs WHERE type = 'forums.deleteNode' AND status IN ('pending', 'running') AND json_extract(payload, '$.threads.nodeId') = ?1 LIMIT 1",
  /** A forum under a top-level category among `?1` (a JSON array of the nodes going) that stays. */
  lifted:
    "SELECT 1 AS n FROM nodes d JOIN nodes c ON c.parent_id = d.id WHERE d.id IN (SELECT value FROM json_each(?1)) AND d.parent_id IS NULL AND d.type = 'category' AND c.type = 'forum' AND c.id NOT IN (SELECT value FROM json_each(?1)) LIMIT 1",
  /** The credit rules and reaction types that name one of the forums (`?1`, a JSON array). */
  creditRules:
    "SELECT title FROM credit_rules WHERE EXISTS (SELECT 1 FROM json_each(credit_rules.node_ids) WHERE value IN (SELECT value FROM json_each(?1)))",
  reactionTypes:
    "SELECT title FROM reaction_types WHERE EXISTS (SELECT 1 FROM json_each(reaction_types.forum_ids) WHERE value IN (SELECT value FROM json_each(?1)))",
};

function statement<Row, Params extends SQLQueryBindings[]>(ctx: Ctx, sql: string) {
  return prepared(ctx, `forums.deleteNode.${sql}`, () => ctx.sqlite.prepare<Row, Params>(sql));
}
const run = (ctx: Ctx, sql: string, ...params: SQLQueryBindings[]) =>
  statement<unknown, SQLQueryBindings[]>(ctx, sql).run(...params);

/** Who the log names for what the job does: the administrator who asked, with their group. */
function auditActor(ctx: Ctx, userId: number): Actor {
  const row = statement<{ group_id: number }, [number]>(
    ctx,
    "SELECT group_id FROM users WHERE id = ?1",
  ).get(userId);
  return { kind: "user", userId, groupId: row?.group_id ?? 0, sessionId: 0 };
}

/**
 * A node (or one above it) whose deletion is queued or running cannot take a new child: the job
 * works for as long as its threads last and would lift or delete what arrived meanwhile.
 */
export function requireNotBeingDeleted(ctx: Ctx, nodeId: number | null | undefined): void {
  if (nodeId == null) return;
  const tree = getNodeTree(ctx);
  for (const id of [nodeId, ...tree.ancestors(nodeId).map((entry) => entry.id)])
    if (statement(ctx, nodeDeleteSql.underway).get(nodeDeleteKey(id)))
      throw new ConflictError("That node is being deleted, so nothing can be put under it.");
}

function subtreeOf(ctx: Ctx, nodeId: number): number[] {
  return statement<{ id: number }, [number]>(ctx, nodeDeleteSql.subtree)
    .all(nodeId)
    .map((row) => row.id);
}

type Step =
  | { status: "empty" }
  | { status: "blocked" }
  | { status: "failed"; reason: string }
  | { status: "done"; threads: number; posts: number };

/** The posts a thread holds in any state: positions are never reused, so the last one counts them. */
function allPosts(ctx: Ctx, row: ThreadRow): number {
  const last = statement<{ position: number }, [number]>(ctx, nodeDeleteSql.lastPosition).get(
    row.id,
  );
  return Math.max(row.reply_count + 1, (last?.position ?? 0) + 1);
}

/** Moves a chunk of the node's threads to the target, keeping every figure true. */
function moveChunk(ctx: Ctx, nodeId: number, targetId: number, scope: number[]): Step {
  const free = statement<ThreadRow, [number, number]>(ctx, nodeDeleteSql.free).all(
    nodeId,
    MOVE_THREADS,
  );
  if (free.length === 0)
    return statement(ctx, nodeDeleteSql.any).get(nodeId)
      ? { status: "blocked" }
      : { status: "empty" };
  // The forum the threads go to is judged again at every chunk: it may have been deleted, made a
  // category or moved into the nodes being deleted since the call.
  const target = statement<{ type: string }, [number]>(ctx, nodeDeleteSql.targetType).get(targetId);
  if (target?.type !== "forum") return { status: "failed", reason: "targetGone" };
  if (scope.includes(targetId)) return { status: "failed", reason: "targetInside" };
  const chunk: ThreadRow[] = [];
  let posts = 0;
  for (const row of free) {
    // Every post counts, hidden ones too: the reports and the log follow all of them.
    const size = allPosts(ctx, row);
    if (chunk.length > 0 && posts + size > MOVE_POSTS) break;
    chunk.push(row);
    posts += size;
  }
  const ids = JSON.stringify(chunk.map((row) => row.id));
  run(
    ctx,
    "UPDATE threads SET node_id = ?1 WHERE id IN (SELECT value FROM json_each(?2))",
    targetId,
    ids,
  );
  // As moving one thread does, a prefix the target forum does not offer is dropped.
  run(
    ctx,
    "UPDATE threads SET prefix_id = NULL WHERE id IN (SELECT value FROM json_each(?2)) AND prefix_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM forum_prefixes WHERE node_id = ?1 AND prefix_id = threads.prefix_id)",
    targetId,
    ids,
  );
  // What names the forum of a thread's content follows it, as moving one thread does.
  for (const table of ["report_groups", "moderator_log"]) {
    run(
      ctx,
      `UPDATE ${table} SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE thread_id IN (SELECT value FROM json_each(?2)))`,
      targetId,
      ids,
    );
    run(
      ctx,
      `UPDATE ${table} SET node_id = ?1 WHERE target_type = 'thread' AND target_id IN (SELECT value FROM json_each(?2))`,
      targetId,
      ids,
    );
  }
  const visible = chunk.filter((row) => row.state === "visible");
  if (visible.length > 0) {
    const visiblePosts = visible.reduce((sum, row) => sum + row.reply_count + 1, 0);
    const counts =
      "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3";
    run(ctx, counts, -visible.length, -visiblePosts, nodeId);
    run(ctx, counts, visible.length, visiblePosts, targetId);
    // Only a forum that counts posts adds to its authors' counts: they change when exactly one
    // of the two forums does.
    if (nodeCountsPosts(ctx, nodeId) !== nodeCountsPosts(ctx, targetId))
      for (const row of visible) adjustAuthorsForMove(ctx, row.id, nodeId, targetId);
    updateNodeLast(ctx, targetId);
  }
  run(ctx, "UPDATE nodes SET content_updated_at = ?1 WHERE id = ?2", ctx.now(), targetId);
  return { status: "done", threads: chunk.length, posts: 0 };
}

/** Removes threads of the node for good, as far as one chunk's bounds allow. */
function removeChunk(ctx: Ctx, nodeId: number): Step {
  let threads = 0;
  let finished = 0;
  let posts = 0;
  let budget = PURGE_CHUNK;
  while (budget > 0 && threads < DELETE_THREADS) {
    const row = statement<ThreadRow, [number, number]>(ctx, nodeDeleteSql.free).get(nodeId, 1);
    if (!row) {
      if (threads === 0)
        return statement(ctx, nodeDeleteSql.any).get(nodeId)
          ? { status: "blocked" }
          : { status: "empty" };
      break;
    }
    threads++;
    // What a merge left behind holds no posts: only the address goes.
    if (row.merged_into_id != null) {
      purgeThread(ctx, row.id);
      finished++;
      budget--;
      continue;
    }
    // (The posts are charged again as they are purged, so a chunk does about half of what the
    // budget allows; that errs on the side of short transactions.)
    // Hiding a visible thread regroups its authors' counts over all its posts: that is charged to
    // the chunk, and a thread too big for what is left waits for the next one.
    if (row.state !== "deleted") {
      const cost = row.state === "visible" ? row.reply_count + 1 : 1;
      if (threads > 1 && cost > budget) break;
      changeThreadState(ctx, row.id, "deleted");
      budget -= cost;
      if (budget <= 0) break;
    }
    // A poll with very many voters goes voters at a time, a chunk each.
    const poll = pollNeedingBatches(ctx, row.id);
    if (poll !== null) {
      purgePollBatch(ctx, poll);
      break;
    }
    const found = threadPostsToPurge(ctx, row, budget);
    const more = found.length > budget;
    const removed = purgeThreadChunk(ctx, row, found.slice(0, budget), more);
    posts += removed;
    budget -= Math.max(1, removed);
    if (!more) finished++;
  }
  return { status: "done", threads: finished, posts };
}

/** The nodes' leftovers, then the nodes: the last step, once no thread is left in any of them. */
function removeNodes(ctx: Ctx, state: NodeDeleteState, scope: number[], actor: Actor): void {
  const inScope = JSON.stringify(scope);
  for (const id of scope) {
    const node = statement<
      {
        parent_id: number | null;
        tab_id: number | null;
        icon_file_id: number | null;
        cover_file_id: number | null;
      },
      [number]
    >(ctx, "SELECT parent_id, tab_id, icon_file_id, cover_file_id FROM nodes WHERE id = ?1").get(
      id,
    );
    if (!node) continue;
    // Nodes under it that stay (or were made meanwhile) take its place, seen by no one who could not
    // see them here; a category that becomes a root category keeps the tab of the one it replaces.
    // They go after the deleted node's siblings, in their own order.
    moveUpKeepingView(ctx, id, inScope, () => {
      const after =
        statement<{ n: number }, [number | null, number]>(
          ctx,
          "SELECT coalesce(max(position), -1) + 1 AS n FROM nodes WHERE parent_id IS ?1 AND id != ?2",
        ).get(node.parent_id, id)?.n ?? 0;
      run(
        ctx,
        "UPDATE nodes SET parent_id = ?1, position = position + ?5, tab_id = CASE WHEN type = 'category' AND ?1 IS NULL THEN ?2 END WHERE parent_id = ?3 AND id NOT IN (SELECT value FROM json_each(?4))",
        node.parent_id,
        node.tab_id,
        id,
        inScope,
        after,
      );
    });
    for (const sql of [
      "DELETE FROM permission_entries WHERE node_id = ?1",
      "DELETE FROM node_watches WHERE node_id = ?1",
      "DELETE FROM node_reads WHERE node_id = ?1",
      "DELETE FROM feed_hidden_nodes WHERE node_id = ?1",
      "DELETE FROM rankings WHERE node_id = ?1",
      "DELETE FROM nodes WHERE id = ?1",
    ])
      run(ctx, sql, id);
    for (const fileId of [node.icon_file_id, node.cover_file_id])
      if (fileId !== null) releaseFile(ctx, fileId);
  }
  const settings = readSiteSettings(ctx);
  if (settings.feedExcludedForumIds.some((id) => scope.includes(id)))
    storeSiteSettings(ctx, {
      ...settings,
      feedExcludedForumIds: settings.feedExcludedForumIds.filter((id) => !scope.includes(id)),
    });
  invalidate(ctx, "node_tree");
  invalidate(ctx, "node_tabs");
  invalidate(ctx, "permissions");
  appendModeratorLog(ctx, actor, "node.delete.completed", "node", state.nodeId, "", {
    title: state.title,
    forums: scope.length,
    movedThreads: state.moved,
    removedThreads: state.removedThreads,
    removedPosts: state.removedPosts,
  });
  publishEvent(ctx, { type: "content.deleted", targetType: "node", targetId: state.nodeId });
}

/**
 * One chunk of the deletion, in one transaction with the completion of its own job and the queuing
 * of its successor under the same key: a replayed run no longer owns its job and does nothing, and
 * a crash between chunks resumes from what the database holds (the nodes' remaining threads).
 */
function deleteChunk(ctx: Ctx, state: NodeDeleteState, job: ClaimedJob) {
  writeTx(ctx, () => {
    if (!completeRunningJob(ctx, job)) return;
    if (!statement(ctx, "SELECT 1 AS n FROM nodes WHERE id = ?1").get(state.nodeId)) return;
    const scope = state.children === "delete" ? subtreeOf(ctx, state.nodeId) : [state.nodeId];
    const actor = auditActor(ctx, state.actorId);
    for (const id of scope) {
      const step =
        state.threads.action === "move"
          ? moveChunk(ctx, id, state.threads.nodeId, scope)
          : removeChunk(ctx, id);
      if (step.status === "empty") continue;
      if (step.status === "failed") {
        // Nothing is queued: the node stays read-only with its remaining threads, and the log says
        // why. Deleting it again, with a forum that exists, carries on.
        appendModeratorLog(ctx, actor, "node.delete.failed", "node", state.nodeId, "", {
          title: state.title,
          reason: step.reason,
          movedThreads: state.moved,
          removedThreads: state.removedThreads,
        });
        return;
      }
      const next: NodeDeleteState =
        step.status === "blocked"
          ? state
          : state.threads.action === "move"
            ? { ...state, moved: state.moved + step.threads }
            : {
                ...state,
                removedThreads: state.removedThreads + step.threads,
                removedPosts: state.removedPosts + step.posts,
              };
      enqueueJob(ctx, NODE_DELETE_JOB, next, {
        uniqueKey: nodeDeleteKey(state.nodeId),
        ...(step.status === "blocked" ? { runAt: ctx.now() + BLOCKED_RETRY_MS } : {}),
      });
      return;
    }
    // The forums of a top-level category are not lifted to the top level, whenever they came.
    if (statement(ctx, nodeDeleteSql.lifted).get(JSON.stringify(scope))) {
      appendModeratorLog(ctx, actor, "node.delete.failed", "node", state.nodeId, "", {
        title: state.title,
        reason: "forumsAtTop",
        movedThreads: state.moved,
        removedThreads: state.removedThreads,
      });
      return;
    }
    removeNodes(ctx, state, scope, actor);
  });
}

export function registerNodeDeleteJob(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    NODE_DELETE_JOB,
    async (context, payload, job) => {
      const state = State.parse(payload);
      // Requests wrote meanwhile: let the WAL restart before this chunk, and keep checkpoints off
      // only while it writes.
      await paceWal(context);
      const release = holdCheckpoints(context);
      try {
        deleteChunk(context, state, job);
      } finally {
        release();
      }
    },
    {
      holdCheckpoints: false,
      // A chunk that kept failing: the log says so, and the node stays read-only.
      onFailed(ctx, job) {
        const state = State.safeParse(job.payload);
        if (!state.success) return;
        appendModeratorLog(
          ctx,
          auditActor(ctx, state.data.actorId),
          "node.delete.failed",
          "node",
          state.data.nodeId,
          "",
          { title: state.data.title, reason: "error", error: job.error },
        );
      },
    },
  );
}

export const nodesDeleteOp = implement(contracts.nodesDelete, async (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.nodes");
    const tree = getNodeTree(ctx);
    const node = tree.get(input.nodeId);
    if (!node) throw new NotFoundError();
    const scope = input.children === "delete" ? tree.subtreeIds(node.id) : [node.id];
    // A forum cannot hold a tab, so a root forum would show under every tab: the forums of a
    // root category are deleted with it, or moved elsewhere first.
    if (
      input.children === "moveUp" &&
      node.parentId === null &&
      node.type === "category" &&
      tree.entries.some((entry) => entry.parentId === node.id && entry.type === "forum")
    )
      throw new ValidationError(
        "The forums under a top-level category cannot move up to the top level. Move them to another category first, or delete them with it.",
      );
    if (input.threads.action === "move") {
      const target = tree.get(input.threads.nodeId);
      if (!target) throw new ValidationError("The forum to move the threads to does not exist.");
      if (target.type !== "forum")
        throw new ValidationError("Threads can only be moved to a forum.");
      if (scope.includes(target.id))
        throw new ValidationError("The threads cannot move to a forum that is being deleted.");
      // A forum that is itself being emptied, or sits under one, is no place to put them.
      for (const id of [target.id, ...tree.ancestors(target.id).map((entry) => entry.id)])
        if (statement(ctx, nodeDeleteSql.underway).get(nodeDeleteKey(id)))
          throw new ConflictError("The forum to move the threads to is being deleted.");
    }
    const named = JSON.stringify(scope);
    // Another deletion is moving its threads into one of these: they would be destroyed with it.
    for (const id of scope) {
      const targeting = statement<{ title: string }, [number]>(ctx, nodeDeleteSql.targeted).get(id);
      if (targeting)
        throw new ConflictError(
          `The deletion of ${targeting.title} is moving its threads into this forum. Wait for it to finish.`,
        );
    }
    const rules = [
      ...statement<{ title: string }, [string]>(ctx, nodeDeleteSql.creditRules).all(named),
      ...statement<{ title: string }, [string]>(ctx, nodeDeleteSql.reactionTypes).all(named),
    ];
    if (rules.length > 0)
      throw new ConflictError(
        `Remove the forum from these before deleting it: ${rules.map((rule) => rule.title).join(", ")}.`,
      );
    const counts = statement<{ threads: number; posts: number }, [string]>(
      ctx,
      "SELECT coalesce(sum(thread_count), 0) AS threads, coalesce(sum(post_count), 0) AS posts FROM nodes WHERE id IN (SELECT value FROM json_each(?1))",
    ).get(named)!;
    // Read-only from now on: nobody starts a thread or replies while the job empties the nodes.
    run(
      ctx,
      "UPDATE nodes SET is_read_only = 1 WHERE id IN (SELECT value FROM json_each(?1))",
      named,
    );
    const state: NodeDeleteState = {
      nodeId: node.id,
      threads: input.threads,
      children: input.children,
      actorId: user.userId,
      title: node.title,
      moved: 0,
      removedThreads: 0,
      removedPosts: 0,
    };
    if (enqueueJob(ctx, NODE_DELETE_JOB, state, { uniqueKey: nodeDeleteKey(node.id) }) === null)
      throw new ConflictError("This forum is already being deleted.");
    invalidate(ctx, "node_tree");
    appendModeratorLog(
      ctx,
      actor,
      "node.delete",
      "node",
      node.id,
      "",
      {
        title: node.title,
        type: node.type,
        threads: input.threads,
        children: input.children,
        forums: scope.length,
        threadCount: counts.threads,
        postCount: counts.posts,
      },
      node.id,
    );
    return { ok: true as const };
  });
});
