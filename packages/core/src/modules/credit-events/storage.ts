import type { SQLQueryBindings } from "bun:sqlite";
import { type Ctx, prepared } from "../../context";
import type { CREDIT_TRIGGERS } from "../../db/schema";

export type Trigger = (typeof CREDIT_TRIGGERS)[number];
export interface RuleRow {
  id: number;
  title: string;
  trigger: Trigger;
  amount: number;
  is_active: number;
  limit_count: number | null;
  limit_window_hours: number | null;
  node_ids: string;
  created_after_event_id: number;
  created_at: number;
  updated_at: number;
}

export const queries = {
  list: "SELECT * FROM credit_rules ORDER BY id",
  rule: "SELECT * FROM credit_rules WHERE id = ?1",
  forums: "SELECT id, type FROM nodes WHERE id IN (SELECT value FROM json_each(?1))",
  create:
    "INSERT INTO credit_rules (title, trigger, amount, is_active, limit_count, limit_window_hours, node_ids, created_after_event_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT coalesce(max(id), 0) FROM domain_events), ?8, ?8) RETURNING *",
  update:
    "UPDATE credit_rules SET title = ?1, amount = ?2, is_active = ?3, limit_count = ?4, limit_window_hours = ?5, node_ids = ?6, updated_at = ?7 WHERE id = ?8 RETURNING *",
  delete: "DELETE FROM credit_rules WHERE id = ?1",
  active:
    "SELECT * FROM credit_rules WHERE trigger = ?1 AND is_active = 1 AND created_after_event_id < ?2 ORDER BY id",
  limit:
    "SELECT count(*) AS count FROM credit_rule_applications WHERE rule_id = ?1 AND user_id = ?2 AND created_at > ?3 AND created_at <= ?4",
  apply:
    "INSERT INTO credit_rule_applications (rule_id, user_id, source_type, source_id, source_user_id, amount, state, last_event_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'applied', ?7, ?8) ON CONFLICT (rule_id, user_id, source_type, source_id, source_user_id) DO NOTHING RETURNING id",
  flip: "UPDATE credit_rule_applications SET state = ?1, last_event_id = ?2 WHERE source_type = ?3 AND source_id = ?4 AND state = ?5 AND last_event_id < ?2 RETURNING rule_id, user_id, amount",
  firstVisibilityChange:
    "SELECT id, json_extract(payload, '$.previousState') AS previous_state FROM domain_events WHERE target_type = ?1 AND target_id = ?2 AND type IN ('content.deleted', 'content.state_changed') AND (json_extract(payload, '$.previousState') = 'visible' OR json_extract(payload, '$.state') = 'visible') ORDER BY id LIMIT 1",
  thread: "SELECT user_id, node_id, state, created_at FROM threads WHERE id = ?1",
  post: "SELECT p.user_id, p.position, p.state, p.created_at, t.node_id, t.user_id AS recipient_id, t.state AS parent_state FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
  profile_post:
    "SELECT user_id, profile_user_id AS recipient_id, state, created_at FROM profile_posts WHERE id = ?1",
  profile_post_comment:
    "SELECT c.user_id, c.state, c.created_at, p.state AS parent_state FROM profile_post_comments c JOIN profile_posts p ON p.id = c.profile_post_id WHERE c.id = ?1",
  conversation_message:
    "SELECT user_id, state, created_at FROM conversation_messages WHERE id = ?1",
  award: "SELECT user_id, revoked_at FROM member_awards WHERE id = ?1",
} as const;

export function query<T>(ctx: Ctx, key: keyof typeof queries) {
  return prepared(ctx, `credit-events.${key}`, () =>
    ctx.sqlite.prepare<T, SQLQueryBindings[]>(queries[key]),
  );
}
