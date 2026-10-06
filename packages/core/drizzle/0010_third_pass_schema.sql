-- Third pass: data-driven permissions, promotions, watching/following/ignoring, notifications,
-- email, push, and moderation additions. Additive only: no existing table is rebuilt or dropped.

-- Groups ------------------------------------------------------------------------------------
-- The legacy flag columns (is_admin, can_post, ...) stay as write-through shims; triggers in the
-- permission-data migration mirror writes to them into permission_entries. Nothing reads them.
ALTER TABLE groups ADD COLUMN description TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
-- Display and hierarchy only; never used to resolve permissions.
ALTER TABLE groups ADD COLUMN rank INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE groups ADD COLUMN user_title TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE groups ADD COLUMN badge TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
-- 'guest' | 'unconfirmed' | 'registered' | 'moderator' | 'admin'; null for admin-created groups.
ALTER TABLE groups ADD COLUMN builtin TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX groups_builtin ON groups(builtin);
--> statement-breakpoint
UPDATE groups SET builtin = 'guest', rank = 0 WHERE id = 1;
--> statement-breakpoint
UPDATE groups SET builtin = 'registered', rank = 10, user_title = 'Member' WHERE id = 2;
--> statement-breakpoint
UPDATE groups SET builtin = 'moderator', rank = 50, user_title = 'Moderator', badge = 'moderator' WHERE id = 3;
--> statement-breakpoint
UPDATE groups SET builtin = 'admin', rank = 100, user_title = 'Administrator', badge = 'admin' WHERE id = 4;
--> statement-breakpoint
INSERT INTO groups (id, title, is_admin, is_moderator, can_view_nodes, can_post, can_view_profiles, can_post_profile, can_start_conversations, can_react, description, rank, user_title, badge, builtin)
VALUES (5, 'Unconfirmed', 0, 0, 1, 0, 1, 0, 0, 0, 'Members who have not confirmed their email address.', 1, 'Awaiting confirmation', '', 'unconfirmed');
--> statement-breakpoint

-- Users -------------------------------------------------------------------------------------
-- Maintained by triggers (see 0011): the combination of the member's groups (and their own
-- member-specific entries) that their resolved permissions are cached under.
ALTER TABLE users ADD COLUMN permission_combination_id INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX users_permission_combination ON users(permission_combination_id);
--> statement-breakpoint
-- Buffered in memory by requests and flushed by the scheduler (a read never writes).
ALTER TABLE users ADD COLUMN last_activity_at INTEGER;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN follower_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN unread_notification_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- BCP 47 language tag; null uses the site default.
ALTER TABLE users ADD COLUMN language TEXT;
--> statement-breakpoint
-- 'none' | 'watch' | 'watch_email': watch threads automatically on create / reply.
ALTER TABLE users ADD COLUMN watch_on_create TEXT NOT NULL DEFAULT 'watch';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN watch_on_reply TEXT NOT NULL DEFAULT 'watch';
--> statement-breakpoint
-- 'everyone' | 'members' | 'followed' | 'self'
ALTER TABLE users ADD COLUMN profile_view_privacy TEXT NOT NULL DEFAULT 'everyone';
--> statement-breakpoint
-- 'members' | 'followed' | 'self'
ALTER TABLE users ADD COLUMN profile_post_privacy TEXT NOT NULL DEFAULT 'members';
--> statement-breakpoint
-- Active restriction expiry per kind (null = none); RESTRICTION_PERMANENT for no expiry.
ALTER TABLE users ADD COLUMN restricted_posting_until INTEGER;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN restricted_conversations_until INTEGER;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN restricted_profile_posts_until INTEGER;
--> statement-breakpoint
-- Per-member hourly email cap window.
ALTER TABLE users ADD COLUMN email_window_start INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN email_window_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_digest_at INTEGER;
--> statement-breakpoint

-- Permissions -------------------------------------------------------------------------------
-- Every permission the code registry declares; rows are added when a new permission first
-- appears, so ids are stable and entries can reference them.
CREATE TABLE permission_definitions (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  value_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX permission_definitions_key ON permission_definitions(key);
--> statement-breakpoint
-- One value for one permission, for exactly one group or one member, at the global scope
-- (node_id = 0) or on a node. Flags: 1 allow, 0 no (nodes only), -1 never; a missing row is
-- unset/inherit. Numbers: the value, -1 meaning unlimited.
CREATE TABLE permission_entries (
  id INTEGER PRIMARY KEY,
  permission_id INTEGER NOT NULL REFERENCES permission_definitions(id),
  node_id INTEGER NOT NULL DEFAULT 0,
  group_id INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL,
  CHECK ((group_id = 0) <> (user_id = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX permission_entries_target ON permission_entries(group_id, user_id, node_id, permission_id);
--> statement-breakpoint
CREATE INDEX permission_entries_node ON permission_entries(node_id);
--> statement-breakpoint
-- A distinct set of groups (sorted, comma separated), private to one member when that member
-- has member-specific entries (user_id != 0).
CREATE TABLE permission_combinations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 0,
  group_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX permission_combinations_key ON permission_combinations(user_id, group_ids);
--> statement-breakpoint
-- Version of each layer (a group's entries, or one member's entries). A process compares these
-- with its in-memory layers when the 'permissions' cache version moves, and reloads only the
-- layers that changed.
CREATE TABLE permission_layer_versions (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX permission_layer_versions_layer ON permission_layer_versions(group_id, user_id);
--> statement-breakpoint
-- Secondary groups assigned by hand.
CREATE TABLE user_groups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_groups_user_group ON user_groups(user_id, group_id);
--> statement-breakpoint
CREATE INDEX user_groups_group ON user_groups(group_id, user_id);
--> statement-breakpoint

-- Promotions --------------------------------------------------------------------------------
CREATE TABLE promotions (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- JSON array of {criterion, value} from the criteria registry; all must hold.
  criteria TEXT NOT NULL DEFAULT '[]',
  -- JSON array of secondary group ids to add.
  group_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
-- A member's state for one promotion: 'auto' (applied by evaluation), 'manual' (promoted by an
-- admin; evaluation leaves it), 'exempt' (never applied; evaluation leaves it).
CREATE TABLE user_promotions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_promotions_user_promotion ON user_promotions(user_id, promotion_id);
--> statement-breakpoint
CREATE INDEX user_promotions_promotion ON user_promotions(promotion_id, user_id);
--> statement-breakpoint
-- Secondary groups granted by an applied promotion, separate from hand-assigned user_groups.
CREATE TABLE user_group_grants (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_group_grants_key ON user_group_grants(user_id, promotion_id, group_id);
--> statement-breakpoint
CREATE INDEX user_group_grants_group ON user_group_grants(group_id, user_id);
--> statement-breakpoint
CREATE TABLE promotion_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promotion_id INTEGER NOT NULL,
  -- 'promote' | 'demote' | 'exempt' | 'reset'
  action TEXT NOT NULL,
  -- Null for automatic changes.
  actor_id INTEGER,
  group_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX promotion_log_user ON promotion_log(user_id, id);
--> statement-breakpoint
CREATE INDEX promotion_log_recent ON promotion_log(created_at, id);
--> statement-breakpoint

-- Markdown extensions -----------------------------------------------------------------------
-- Mentions resolved to user ids on write, so renames never break them.
CREATE TABLE content_mentions (
  id INTEGER PRIMARY KEY,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX content_mentions_content_user ON content_mentions(content_type, content_id, user_id);
--> statement-breakpoint
CREATE INDEX content_mentions_user ON content_mentions(user_id, id);
--> statement-breakpoint
CREATE TABLE content_quotes (
  id INTEGER PRIMARY KEY,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  quoted_post_id INTEGER NOT NULL,
  quoted_user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX content_quotes_content_post ON content_quotes(content_type, content_id, quoted_post_id);
--> statement-breakpoint
CREATE INDEX content_quotes_post ON content_quotes(quoted_post_id);
--> statement-breakpoint

-- Watching, following, ignoring -------------------------------------------------------------
CREATE TABLE thread_watches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  email INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
-- Fan-out walks a thread's watchers by user id.
CREATE UNIQUE INDEX thread_watches_thread_user ON thread_watches(thread_id, user_id);
--> statement-breakpoint
CREATE INDEX thread_watches_user ON thread_watches(user_id, id);
--> statement-breakpoint
CREATE TABLE node_watches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES nodes(id),
  -- 'threads' (new threads only) | 'posts' (every new post)
  mode TEXT NOT NULL,
  email INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX node_watches_node_user ON node_watches(node_id, user_id);
--> statement-breakpoint
CREATE INDEX node_watches_user ON node_watches(user_id, id);
--> statement-breakpoint
CREATE TABLE user_follows (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_follows_pair ON user_follows(user_id, followed_id);
--> statement-breakpoint
-- Followers of a member, for fan-out and the followers list.
CREATE INDEX user_follows_followed ON user_follows(followed_id, user_id);
--> statement-breakpoint
CREATE TABLE user_ignores (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ignored_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_ignores_pair ON user_ignores(user_id, ignored_id);
--> statement-breakpoint
-- Delivery filter: which of a batch of recipients ignore the actor.
CREATE INDEX user_ignores_ignored ON user_ignores(ignored_id, user_id);
--> statement-breakpoint

-- Notifications -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  -- The thread the content belongs to, so reading a thread clears its notifications.
  thread_id INTEGER,
  -- Most recent actor; null for system notifications.
  actor_id INTEGER,
  actor_count INTEGER NOT NULL DEFAULT 1,
  -- JSON array of the most recent actor ids (newest first, capped).
  actor_ids TEXT NOT NULL DEFAULT '[]',
  -- Unread notifications with the same key are merged; null never merges.
  group_key TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  -- Highest domain event merged into this row; replays of older events are ignored.
  last_event_id INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  read_at INTEGER
);
--> statement-breakpoint
CREATE INDEX notifications_user_recent ON notifications(user_id, updated_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_user_group ON notifications(user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX notifications_user_unread ON notifications(user_id, id) WHERE read_at IS NULL;
--> statement-breakpoint
CREATE INDEX notifications_user_thread ON notifications(user_id, thread_id) WHERE read_at IS NULL AND thread_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX notifications_content ON notifications(content_type, content_id);
--> statement-breakpoint
CREATE INDEX notifications_read_purge ON notifications(read_at, id) WHERE read_at IS NOT NULL;
--> statement-breakpoint
-- Per member, per type overrides of the admin defaults; null columns use the default.
CREATE TABLE notification_preferences (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  in_app INTEGER,
  email INTEGER,
  push INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_preferences_user_type ON notification_preferences(user_id, type);
--> statement-breakpoint
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body_source TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint

-- Email and push ----------------------------------------------------------------------------
CREATE TABLE email_failures (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  email TEXT NOT NULL,
  template TEXT NOT NULL,
  error TEXT NOT NULL,
  permanent INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX email_failures_recent ON email_failures(created_at, id);
--> statement-breakpoint
-- Addresses the receiving server rejected outright; nothing more is sent to them.
CREATE TABLE undeliverable_emails (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX undeliverable_emails_email ON undeliverable_emails(email);
--> statement-breakpoint
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX push_subscriptions_endpoint ON push_subscriptions(endpoint);
--> statement-breakpoint
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id, id);
--> statement-breakpoint

-- Moderation additions ----------------------------------------------------------------------
-- A merged thread keeps its row as a tombstone (state 'deleted') pointing at the destination,
-- so its id keeps resolving and is never reused.
ALTER TABLE threads ADD COLUMN merged_into_id INTEGER;
--> statement-breakpoint
CREATE TABLE thread_bans (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX thread_bans_thread_user ON thread_bans(thread_id, user_id);
--> statement-breakpoint
CREATE INDEX thread_bans_user ON thread_bans(user_id, id);
--> statement-breakpoint
ALTER TABLE nodes ADD COLUMN require_thread_approval INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE nodes ADD COLUMN require_reply_approval INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE nodes ADD COLUMN is_read_only INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE nodes ADD COLUMN min_account_age_days INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE nodes ADD COLUMN min_post_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- History of restrictions; users.restricted_*_until holds the active expiry per kind.
CREATE TABLE user_restrictions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'posting' | 'conversations' | 'profile_posts'
  kind TEXT NOT NULL,
  moderator_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  lifted_at INTEGER
);
--> statement-breakpoint
CREATE INDEX user_restrictions_user ON user_restrictions(user_id, kind, id);
--> statement-breakpoint
-- The node of the reported content (null for profile content, members and messages), so the
-- report queue can be filtered by node and scoped to the nodes a moderator moderates.
ALTER TABLE report_groups ADD COLUMN node_id INTEGER;
--> statement-breakpoint
CREATE INDEX report_groups_node_queue ON report_groups(node_id, state, updated_at, id);
--> statement-breakpoint
UPDATE report_groups SET node_id = (
  SELECT t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = report_groups.target_id
) WHERE target_type = 'post';
--> statement-breakpoint
ALTER TABLE moderator_log ADD COLUMN node_id INTEGER;
--> statement-breakpoint
CREATE INDEX moderator_log_node ON moderator_log(node_id, id);
