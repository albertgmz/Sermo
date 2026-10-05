/**
 * Raw-SQL probes of the hot queries the services are built on. They validate the schema and
 * indexes against the seeded dataset independently of service code, and separate database time
 * from service overhead when a service scenario is slow.
 */
import type { SQLQueryBindings } from "bun:sqlite";
import type { BenchEnv, Scenario } from "../harness";

function query(env: BenchEnv, key: string, sql: string) {
  let stmt = env.ctx.statements.get(`probe.${key}`) as
    | ReturnType<typeof env.ctx.sqlite.prepare<Record<string, unknown>, SQLQueryBindings[]>>
    | undefined;
  if (!stmt) {
    stmt = env.ctx.sqlite.prepare<Record<string, unknown>, SQLQueryBindings[]>(sql);
    env.ctx.statements.set(`probe.${key}`, stmt);
  }
  return stmt;
}

function users(env: BenchEnv, ids: unknown[]) {
  return query(
    env,
    "users",
    "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))",
  ).all(JSON.stringify(ids));
}

export const scenarios: Scenario[] = [
  {
    name: "probe: thread list page (deep keyset)",
    kind: "read",
    run(env, i) {
      const nodeId = env.meta.bigForumIds[i % env.meta.bigForumIds.length]!;
      const before = Date.UTC(2021, 0, 1) + ((i * 7919) % 1800) * 86_400_000;
      const rows = query(
        env,
        "threadList",
        "SELECT id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, view_count, first_post_id, last_post_at, last_post_id, last_poster_id " +
          "FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND (last_post_at < ?2 OR (last_post_at = ?2 AND id < ?3)) " +
          "ORDER BY last_post_at DESC, id DESC LIMIT 21",
      ).all(nodeId, before, 2 ** 31);
      users(
        env,
        rows.flatMap((r) => [r.user_id, r.last_poster_id]),
      );
      const member = env.meta.memberIds[i % env.meta.memberIds.length]!;
      query(
        env,
        "threadReads",
        "SELECT thread_id, last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))",
      ).all(member, JSON.stringify(rows.map((r) => r.id)));
      return rows;
    },
  },
  {
    name: "probe: posts page of a huge thread",
    kind: "read",
    run(env, i) {
      const threadId = env.meta.bigThreadIds[i % env.meta.bigThreadIds.length]!;
      const start = ((i * 104729) % 500) * 20;
      const rows = query(
        env,
        "postsPage",
        "SELECT p.id, p.user_id, p.position, p.state, p.created_at, p.edited_at, b.body_html, p.reaction_counts " +
          "FROM posts p JOIN post_bodies b ON b.post_id = p.id " +
          "WHERE p.thread_id = ?1 AND p.position BETWEEN ?2 AND ?3 AND p.state = 'visible' ORDER BY p.position",
      ).all(threadId, start, start + 19);
      users(
        env,
        rows.map((r) => r.user_id),
      );
      const member = env.meta.memberIds[i % env.meta.memberIds.length]!;
      query(
        env,
        "viewerReactions",
        "SELECT content_id, reaction_type_id FROM reactions WHERE content_type = 'post' AND user_id = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
      ).all(member, JSON.stringify(rows.map((r) => r.id)));
      return rows;
    },
  },
  {
    name: "probe: conversation inbox",
    kind: "read",
    run(env, i) {
      const userId = env.meta.busyConversationUserIds[i % env.meta.busyConversationUserIds.length]!;
      const rows = query(
        env,
        "inbox",
        "SELECT c.*, cp.last_read_message_id FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id " +
          "WHERE cp.user_id = ?1 AND cp.state = 'active' ORDER BY cp.last_message_at DESC, cp.conversation_id DESC LIMIT 21",
      ).all(userId);
      users(
        env,
        rows.flatMap((r) => [r.user_id, r.last_message_user_id]),
      );
      return rows;
    },
  },
  {
    name: "probe: profile wall with latest comments",
    kind: "read",
    run(env, i) {
      const userId = env.meta.bigWallUserIds[i % env.meta.bigWallUserIds.length]!;
      const rows = query(
        env,
        "wall",
        "SELECT * FROM profile_posts WHERE profile_user_id = ?1 AND state = 'visible' ORDER BY id DESC LIMIT 21",
      ).all(userId);
      const comments = query(
        env,
        "wallComments",
        "SELECT * FROM (SELECT c.*, row_number() OVER (PARTITION BY c.profile_post_id ORDER BY c.id DESC) AS rn " +
          "FROM profile_post_comments c WHERE c.profile_post_id IN (SELECT value FROM json_each(?1)) AND c.state = 'visible') WHERE rn <= 3",
      ).all(JSON.stringify(rows.map((r) => r.id)));
      users(env, [...rows.map((r) => r.user_id), ...comments.map((c) => c.user_id)]);
      return rows;
    },
  },
  ...(["common", "medium", "rare"] as const).map(
    (level): Scenario => ({
      name: `probe: search (${level} term)`,
      kind: "read",
      run(env, i) {
        const terms = env.meta.searchTerms[level];
        return query(
          env,
          "search",
          "SELECT p.id, p.thread_id FROM search_fts f JOIN posts p ON p.id = f.rowid JOIN threads t ON t.id = p.thread_id " +
            "WHERE search_fts MATCH ?1 AND p.state = 'visible' AND t.state = 'visible' ORDER BY f.rowid DESC LIMIT 21",
        ).all(`"${terms[i % terms.length]}"`);
      },
    }),
  ),
];
