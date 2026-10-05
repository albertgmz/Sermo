import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { registerJobHandler } from "./queue";

export const REBUILD_CHUNK_SIZES = {
  threads: 50,
  nodes: 1,
  users: 10,
  profile_posts: 100,
  conversations: 50,
  posts: 500,
  profile_post_comments: 500,
  conversation_messages: 500,
} as const;
const columns = {
  threads:
    "id, created_at, user_id, first_post_id, reply_count, last_post_at, last_post_id, last_poster_id",
  nodes:
    "id, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id",
  users: "id, post_count, reaction_score",
  profile_posts: "id, comment_count, last_comment_at, reaction_counts",
  conversations:
    "id, created_at, user_id, message_count, participant_count, last_message_at, last_message_id, last_message_user_id",
  posts: "id, reaction_counts",
  profile_post_comments: "id, reaction_counts",
  conversation_messages: "id, reaction_counts",
} as const;
const stages = [
  "threads",
  "nodes",
  "users",
  "profile_posts",
  "conversations",
  "posts",
  "profile_post_comments",
  "conversation_messages",
] as const;
type Stage = (typeof stages)[number];
export interface RebuildProgress {
  stage: Stage;
  after: number;
}
type Value = number | string | null;
type Row = Record<string, Value> & { id: number };
const reactionsFor: Partial<Record<Stage, string>> = {
  posts: "post",
  profile_posts: "profile_post",
  profile_post_comments: "profile_post_comment",
  conversation_messages: "conversation_message",
};

function one<T extends object>(
  ctx: Ctx,
  key: string,
  sql: string,
  ...params: (number | string)[]
): T | null {
  return (
    prepared(ctx, `jobs.rebuild.${key}`, () => ctx.sqlite.prepare<T, (number | string)[]>(sql)).get(
      ...params,
    ) ?? null
  );
}

function all<T extends object>(
  ctx: Ctx,
  key: string,
  sql: string,
  ...params: (number | string)[]
): T[] {
  return prepared(ctx, `jobs.rebuild.${key}`, () =>
    ctx.sqlite.prepare<T, (number | string)[]>(sql),
  ).all(...params);
}

function reactionCounts(ctx: Ctx, type: string, id: number): string {
  const rows = all<{ reaction_type_id: number; n: number }>(
    ctx,
    "reactionCounts",
    "SELECT reaction_type_id, COUNT(*) AS n FROM reactions " +
      "WHERE content_type = ?1 AND content_id = ?2 GROUP BY reaction_type_id",
    type,
    id,
  );
  return JSON.stringify(Object.fromEntries(rows.map((row) => [row.reaction_type_id, row.n])));
}

function expected(ctx: Ctx, stage: Stage, row: Row): Record<string, Value> {
  const id = row.id;
  if (stage === "threads") {
    const first = one<{ id: number }>(
      ctx,
      "firstPost",
      "SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position, id LIMIT 1",
      id,
    );
    const last = one<{ id: number; created_at: number; user_id: number }>(
      ctx,
      "lastPost",
      "SELECT id, created_at, user_id FROM posts WHERE thread_id = ?1 AND state = 'visible' " +
        "ORDER BY position DESC, id DESC LIMIT 1",
      id,
    );
    const count = one<{ n: number }>(
      ctx,
      "visiblePosts",
      "SELECT COUNT(*) AS n FROM posts WHERE thread_id = ?1 AND state = 'visible'",
      id,
    )!.n;
    return {
      first_post_id: first?.id ?? null,
      reply_count: Math.max(0, count - 1),
      last_post_at: last?.created_at ?? row.created_at ?? 0,
      last_post_id: last?.id ?? null,
      last_poster_id: last?.user_id ?? row.user_id ?? 0,
    };
  }
  if (stage === "nodes") {
    const counts = one<{ threads: number; posts: number }>(
      ctx,
      "nodeCounts",
      "SELECT COUNT(*) AS threads, COALESCE(SUM(reply_count + 1), 0) AS posts " +
        "FROM threads WHERE node_id = ?1 AND state = 'visible'",
      id,
    )!;
    const lastSql =
      "SELECT last_post_at, last_post_id, id AS thread_id, title, last_poster_id " +
      "FROM threads WHERE node_id = ?1 AND is_sticky = ?2 AND state = 'visible' " +
      "ORDER BY last_post_at DESC, id DESC LIMIT 1";
    type Last = {
      last_post_at: number;
      last_post_id: number | null;
      thread_id: number;
      title: string;
      last_poster_id: number;
    };
    const a = one<Last>(ctx, "nodeLast", lastSql, id, 0);
    const b = one<Last>(ctx, "nodeLast", lastSql, id, 1);
    const last = !a
      ? b
      : !b
        ? a
        : a.last_post_at > b.last_post_at ||
            (a.last_post_at === b.last_post_at && a.thread_id > b.thread_id)
          ? a
          : b;
    return {
      thread_count: counts.threads,
      post_count: counts.posts,
      last_post_at: last?.last_post_at ?? null,
      last_post_id: last?.last_post_id ?? null,
      last_thread_id: last?.thread_id ?? null,
      last_thread_title: last?.title ?? null,
      last_poster_id: last?.last_poster_id ?? null,
    };
  }
  if (stage === "users") {
    const posts = one<{ n: number }>(
      ctx,
      "userPosts",
      "SELECT COUNT(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id " +
        "WHERE p.user_id = ?1 AND p.state = 'visible' AND t.state = 'visible'",
      id,
    )!.n;
    const score = one<{ n: number }>(
      ctx,
      "userScore",
      "SELECT COALESCE(SUM(score), 0) AS n FROM reactions WHERE content_user_id = ?1",
      id,
    )!.n;
    return { post_count: posts, reaction_score: score };
  }
  if (stage === "profile_posts") {
    const comments = one<{ n: number; last_at: number | null }>(
      ctx,
      "profileComments",
      "SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM profile_post_comments " +
        "WHERE profile_post_id = ?1 AND state = 'visible'",
      id,
    )!;
    return {
      comment_count: comments.n,
      last_comment_at: comments.last_at,
      reaction_counts: reactionCounts(ctx, "profile_post", id),
    };
  }
  if (stage === "conversations") {
    const messages = one<{ n: number }>(
      ctx,
      "messageCount",
      "SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?1 AND state = 'visible'",
      id,
    )!.n;
    const participants = one<{ n: number }>(
      ctx,
      "participantCount",
      "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ?1 AND state = 'active'",
      id,
    )!.n;
    const last = one<{ id: number; created_at: number; user_id: number }>(
      ctx,
      "lastMessage",
      "SELECT id, created_at, user_id FROM conversation_messages WHERE conversation_id = ?1 " +
        "AND state = 'visible' ORDER BY id DESC LIMIT 1",
      id,
    );
    return {
      message_count: messages,
      participant_count: participants,
      last_message_id: last?.id ?? null,
      last_message_at: last?.created_at ?? row.created_at ?? 0,
      last_message_user_id: last?.user_id ?? row.user_id ?? 0,
    };
  }
  return { reaction_counts: reactionCounts(ctx, reactionsFor[stage]!, id) };
}

function updateChanged(ctx: Ctx, stage: Stage, row: Row, values: Record<string, Value>): boolean {
  const changes = Object.entries(values).filter(([key, value]) => row[key] !== value);
  if (changes.length > 0) {
    const sql = `UPDATE ${stage} SET ${changes.map(([key], i) => `${key} = ?${i + 1}`).join(", ")} WHERE id = ?${changes.length + 1}`;
    ctx.sqlite.prepare(sql).run(...changes.map(([, value]) => value), row.id);
  }
  if (stage === "conversations") {
    prepared(ctx, "jobs.rebuild.participantCopy", () =>
      ctx.sqlite.prepare(
        "UPDATE conversation_participants SET last_message_at = ?1 " +
          "WHERE conversation_id = ?2 AND state = 'active' AND last_message_at IS NOT ?1",
      ),
    ).run(values.last_message_at ?? null, row.id);
  }
  return changes.length > 0;
}

/** Repairs one ID-range chunk and atomically queues its continuation. */
export function rebuildCountersChunk(
  ctx: Ctx,
  progress: RebuildProgress = { stage: "threads", after: 0 },
  options: { enqueueNext?: boolean } = {},
): number {
  if (
    !stages.includes(progress.stage) ||
    !Number.isSafeInteger(progress.after) ||
    progress.after < 0
  )
    throw new TypeError("Invalid counter rebuild progress.");
  return writeTx(ctx, () => {
    const chunkSize = REBUILD_CHUNK_SIZES[progress.stage];
    const rows = all<Row>(
      ctx,
      `page.${progress.stage}`,
      `SELECT ${columns[progress.stage]} FROM ${progress.stage} WHERE id > ?1 ORDER BY id LIMIT ?2`,
      progress.after,
      chunkSize,
    );
    let changed = 0;
    for (const row of rows)
      if (updateChanged(ctx, progress.stage, row, expected(ctx, progress.stage, row))) changed++;
    const nextStageIndex = stages.indexOf(progress.stage) + 1;
    const next: RebuildProgress | null =
      rows.length === chunkSize
        ? { stage: progress.stage, after: rows.at(-1)!.id }
        : nextStageIndex < stages.length
          ? { stage: stages[nextStageIndex]!, after: 0 }
          : null;
    if (next && options.enqueueNext !== false) {
      const now = ctx.now();
      // The current running job relinquishes the key before the successor takes it.
      prepared(ctx, "jobs.rebuild.releaseKey", () =>
        ctx.sqlite.prepare(
          "UPDATE jobs SET unique_key = NULL WHERE unique_key = 'rebuild-counters' AND status = 'running'",
        ),
      ).run();
      prepared(ctx, "jobs.rebuild.enqueueNext", () =>
        ctx.sqlite.prepare(
          "INSERT INTO jobs (type, payload, run_at, unique_key, created_at, updated_at) " +
            "VALUES ('rebuild-counters', ?1, ?2, 'rebuild-counters', ?2, ?2) " +
            "ON CONFLICT (unique_key) DO NOTHING",
        ),
      ).run(JSON.stringify(next), now);
    }
    return changed;
  });
}

export function registerJobHandlers(ctx: Ctx): void {
  registerJobHandler(ctx, "rebuild-counters", (context, payload) => {
    rebuildCountersChunk(context, payload as RebuildProgress);
  });
}
