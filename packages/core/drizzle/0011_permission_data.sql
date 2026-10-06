-- Generated from the permission registry (src/permissions/registry.ts) as of this migration.
-- Later registry additions are stored at startup by syncPermissionRegistry.
INSERT INTO permission_definitions (key, scope, value_type, created_at) VALUES
  ('profile.view', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profile.editOwn', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('search.use', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('reaction.react', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('report.create', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('attachment.storageQuota', 'global', 'integer', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('node.view', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.createThread', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.reply', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.editOwn', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.editOwnTimeLimit', 'node', 'integer', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.editOwnThreadTitle', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.deleteOwn', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.viewAttachments', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.uploadAttachments', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.viewModerated', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.viewDeleted', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.editAny', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.deleteAny', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.undelete', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.approve', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.viewHistory', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.lock', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.replyLocked', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.stick', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.move', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('forum.manageReports', 'node', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.post', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.comment', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.editOwn', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.deleteOwn', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.manageOwnWall', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.viewModerated', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.viewDeleted', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.editAny', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.deleteAny', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.undelete', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('profilePost.approve', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('conversation.start', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('conversation.reply', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('conversation.maxRecipients', 'global', 'integer', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('conversation.viewHidden', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('conversation.moderate', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('moderation.access', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('report.manageProfiles', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('warning.view', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('member.warn', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('member.ban', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('member.spamCleanup', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('member.immuneToAutoBan', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('wordFilter.view', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('wordFilter.manage', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('moderatorLog.view', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('admin.nodes', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('admin.groups', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('admin.members', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('admin.permissions', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('admin.settings', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('admin.reactionTypes', 'global', 'flag', CAST(unixepoch('subsec') * 1000 AS INTEGER));
--> statement-breakpoint
-- Administrator groups (is_admin) had every permission everywhere.
INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.value_type = 'flag'
WHERE g.is_admin = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports', 'profilePost.viewModerated', 'profilePost.viewDeleted', 'profilePost.editAny', 'profilePost.deleteAny', 'profilePost.undelete', 'profilePost.approve', 'moderation.access', 'report.manageProfiles', 'warning.view', 'member.warn', 'wordFilter.view')
WHERE g.is_moderator = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('node.view')
WHERE g.can_view_nodes = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('forum.createThread', 'forum.reply')
WHERE g.can_post = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('profile.view')
WHERE g.can_view_profiles = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('profilePost.post', 'profilePost.comment')
WHERE g.can_post_profile = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('conversation.start')
WHERE g.can_start_conversations = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key IN ('reaction.react')
WHERE g.can_react = 1 AND g.is_admin = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profile.editOwn'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profile.editOwn'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profile.editOwn'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profile.editOwn'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'search.use'
WHERE g.builtin = 'guest';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'search.use'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'search.use'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'search.use'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'search.use'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'report.create'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'report.create'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'report.create'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'report.create'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwn'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwn'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwn'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwn'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnTimeLimit'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnTimeLimit'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnTimeLimit'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnTimeLimit'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnThreadTitle'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnThreadTitle'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnThreadTitle'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.editOwnThreadTitle'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.deleteOwn'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.deleteOwn'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.deleteOwn'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.deleteOwn'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.viewAttachments'
WHERE g.builtin = 'guest';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.viewAttachments'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.viewAttachments'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.viewAttachments'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.viewAttachments'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.uploadAttachments'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.uploadAttachments'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.uploadAttachments'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'forum.uploadAttachments'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.editOwn'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.editOwn'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.editOwn'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.editOwn'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.deleteOwn'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.deleteOwn'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.deleteOwn'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.deleteOwn'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.manageOwnWall'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.manageOwnWall'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.manageOwnWall'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'profilePost.manageOwnWall'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.reply'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.reply'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.reply'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, 1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.reply'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.maxRecipients'
WHERE g.builtin = 'unconfirmed';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.maxRecipients'
WHERE g.builtin = 'registered';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.maxRecipients'
WHERE g.builtin = 'moderator';
--> statement-breakpoint
INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0, -1 FROM groups g JOIN permission_definitions d ON d.key = 'conversation.maxRecipients'
WHERE g.builtin = 'admin';
--> statement-breakpoint
INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, 0, g.id, 0,
  CASE
    WHEN g.id BETWEEN 1 AND 4 AND (SELECT json_type(value, '$.groupUploadLimitBytes') FROM site_settings WHERE key = 'configuration') IS NOT NULL
      THEN COALESCE((SELECT json_extract(value, '$.groupUploadLimitBytes."' || g.id || '"') FROM site_settings WHERE key = 'configuration'), -1)
    ELSE CASE g.builtin WHEN 'guest' THEN 0 WHEN 'unconfirmed' THEN 0 WHEN 'registered' THEN 104857600 WHEN 'moderator' THEN 1073741824 WHEN 'admin' THEN 1073741824 END
  END
FROM groups g JOIN permission_definitions d ON d.key = 'attachment.storageQuota'
WHERE g.builtin IS NOT NULL;
--> statement-breakpoint
INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT d.id, np.node_id, np.group_id, 0, CASE WHEN d.key = 'node.view' THEN np.can_view WHEN d.key IN ('forum.createThread', 'forum.reply') THEN np.can_post ELSE np.can_moderate END
FROM node_permissions np JOIN groups g ON g.id = np.group_id JOIN permission_definitions d
  ON (d.key = 'node.view' AND np.can_view IS NOT NULL)
  OR (d.key IN ('forum.createThread', 'forum.reply') AND np.can_post IS NOT NULL)
  OR (d.key IN ('forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports') AND np.can_moderate IS NOT NULL)
WHERE g.is_admin = 0;
--> statement-breakpoint
INSERT INTO permission_combinations (user_id, group_ids, created_at) VALUES (0, '1', CAST(unixepoch('subsec') * 1000 AS INTEGER));
--> statement-breakpoint
INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
SELECT DISTINCT 0, CAST(group_id AS TEXT), CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM users;
--> statement-breakpoint
UPDATE users SET permission_combination_id = (
  SELECT c.id FROM permission_combinations c WHERE c.user_id = 0 AND c.group_ids = CAST(users.group_id AS TEXT)
);
--> statement-breakpoint
UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions';
--> statement-breakpoint
-- A member's combination follows their primary group, secondary groups, promotion grants and
-- whether they have member-specific entries, whoever writes those rows.
CREATE TRIGGER users_combination_insert AFTER INSERT ON users BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) THEN new.id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) THEN new.id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id))
  ) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER users_combination_group AFTER UPDATE OF group_id ON users BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) THEN new.id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) THEN new.id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id))
  ) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER user_groups_combination_insert AFTER INSERT ON user_groups BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_groups_combination_delete AFTER DELETE ON user_groups WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_group_grants_combination_insert AFTER INSERT ON user_group_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_group_grants_combination_delete AFTER DELETE ON user_group_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_combination_insert AFTER INSERT ON permission_entries WHEN new.user_id <> 0 AND EXISTS (SELECT 1 FROM users WHERE id = new.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_combination_delete AFTER DELETE ON permission_entries WHEN old.user_id <> 0 AND EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
-- Every entry change bumps its layer and the permissions cache version, so each process
-- reloads exactly the layers that changed.
CREATE TRIGGER permission_entries_version_insert AFTER INSERT ON permission_entries BEGIN
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (new.group_id, new.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_version_update AFTER UPDATE ON permission_entries BEGIN
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (old.group_id, old.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (new.group_id, new.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_version_delete AFTER DELETE ON permission_entries BEGIN
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (old.group_id, old.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER groups_version_insert AFTER INSERT ON groups BEGIN
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER groups_version_delete AFTER DELETE ON groups BEGIN
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER groups_version_update AFTER UPDATE OF title, rank, user_title, badge, builtin ON groups BEGIN
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
-- Legacy shims: writes to the old group flag columns and node_permissions rows are mirrored
-- into permission_entries. Nothing reads the old columns.
CREATE TRIGGER groups_legacy_flags AFTER UPDATE OF is_admin, is_moderator, can_view_nodes, can_post, can_view_profiles, can_post_profile, can_start_conversations, can_react ON groups BEGIN
  DELETE FROM permission_entries WHERE group_id = new.id AND user_id = 0 AND node_id = 0 AND permission_id IN (
    SELECT id FROM permission_definitions
    WHERE key IN ('profile.view', 'reaction.react', 'node.view', 'forum.createThread', 'forum.reply', 'forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports', 'profilePost.post', 'profilePost.comment', 'profilePost.viewModerated', 'profilePost.viewDeleted', 'profilePost.editAny', 'profilePost.deleteAny', 'profilePost.undelete', 'profilePost.approve', 'conversation.start', 'conversation.viewHidden', 'conversation.moderate', 'moderation.access', 'report.manageProfiles', 'warning.view', 'member.warn', 'member.ban', 'member.spamCleanup', 'member.immuneToAutoBan', 'wordFilter.view', 'wordFilter.manage', 'moderatorLog.view', 'admin.nodes', 'admin.groups', 'admin.members', 'admin.permissions', 'admin.settings', 'admin.reactionTypes') OR (old.is_admin = 1 AND new.is_admin = 0 AND value_type = 'flag')
  );
  INSERT OR REPLACE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
    SELECT id, 0, new.id, 0, 1 FROM permission_definitions WHERE new.is_admin = 1 AND value_type = 'flag';
  INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
    SELECT id, 0, new.id, 0, 1 FROM permission_definitions WHERE new.is_admin = 0 AND (
      (new.is_moderator = 1 AND key IN ('forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports', 'profilePost.viewModerated', 'profilePost.viewDeleted', 'profilePost.editAny', 'profilePost.deleteAny', 'profilePost.undelete', 'profilePost.approve', 'moderation.access', 'report.manageProfiles', 'warning.view', 'member.warn', 'wordFilter.view'))
      OR (new.can_view_nodes = 1 AND key IN ('node.view'))
      OR (new.can_post = 1 AND key IN ('forum.createThread', 'forum.reply'))
      OR (new.can_view_profiles = 1 AND key IN ('profile.view'))
      OR (new.can_post_profile = 1 AND key IN ('profilePost.post', 'profilePost.comment'))
      OR (new.can_start_conversations = 1 AND key IN ('conversation.start'))
      OR (new.can_react = 1 AND key IN ('reaction.react'))
    );
  INSERT OR IGNORE INTO permission_entries (permission_id, node_id, group_id, user_id, value)
    SELECT id, 0, new.id, 0, 1 FROM permission_definitions
    WHERE old.is_admin = 1 AND new.is_admin = 0 AND new.id <> 1 AND key IN ('profile.editOwn', 'search.use', 'report.create', 'forum.editOwn', 'forum.editOwnThreadTitle', 'forum.deleteOwn', 'forum.viewAttachments', 'forum.uploadAttachments', 'profilePost.editOwn', 'profilePost.deleteOwn', 'profilePost.manageOwnWall', 'conversation.reply');
END;
--> statement-breakpoint
CREATE TRIGGER node_permissions_legacy_insert AFTER INSERT ON node_permissions WHEN (SELECT is_admin FROM groups WHERE id = new.group_id) = 0 BEGIN
  DELETE FROM permission_entries WHERE group_id = new.group_id AND user_id = 0 AND node_id = new.node_id
    AND permission_id IN (SELECT id FROM permission_definitions WHERE key IN ('node.view', 'forum.createThread', 'forum.reply', 'forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports'));
  INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value)
    SELECT d.id, new.node_id, new.group_id, 0,
      CASE WHEN d.key = 'node.view' THEN new.can_view WHEN d.key IN ('forum.createThread', 'forum.reply') THEN new.can_post ELSE new.can_moderate END
    FROM permission_definitions d
    WHERE (d.key = 'node.view' AND new.can_view IS NOT NULL)
      OR (d.key IN ('forum.createThread', 'forum.reply') AND new.can_post IS NOT NULL)
      OR (d.key IN ('forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports') AND new.can_moderate IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER node_permissions_legacy_update AFTER UPDATE ON node_permissions WHEN (SELECT is_admin FROM groups WHERE id = new.group_id) = 0 BEGIN
  DELETE FROM permission_entries WHERE group_id = old.group_id AND user_id = 0 AND node_id = old.node_id
    AND permission_id IN (SELECT id FROM permission_definitions WHERE key IN ('node.view', 'forum.createThread', 'forum.reply', 'forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports'));
  DELETE FROM permission_entries WHERE group_id = new.group_id AND user_id = 0 AND node_id = new.node_id
    AND permission_id IN (SELECT id FROM permission_definitions WHERE key IN ('node.view', 'forum.createThread', 'forum.reply', 'forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports'));
  INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value)
    SELECT d.id, new.node_id, new.group_id, 0,
      CASE WHEN d.key = 'node.view' THEN new.can_view WHEN d.key IN ('forum.createThread', 'forum.reply') THEN new.can_post ELSE new.can_moderate END
    FROM permission_definitions d
    WHERE (d.key = 'node.view' AND new.can_view IS NOT NULL)
      OR (d.key IN ('forum.createThread', 'forum.reply') AND new.can_post IS NOT NULL)
      OR (d.key IN ('forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports') AND new.can_moderate IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER node_permissions_legacy_delete AFTER DELETE ON node_permissions WHEN (SELECT is_admin FROM groups WHERE id = old.group_id) = 0 BEGIN
  DELETE FROM permission_entries WHERE group_id = old.group_id AND user_id = 0 AND node_id = old.node_id
    AND permission_id IN (SELECT id FROM permission_definitions WHERE key IN ('node.view', 'forum.createThread', 'forum.reply', 'forum.viewModerated', 'forum.viewDeleted', 'forum.editAny', 'forum.deleteAny', 'forum.undelete', 'forum.approve', 'forum.viewHistory', 'forum.lock', 'forum.replyLocked', 'forum.stick', 'forum.move', 'forum.manageReports'));
END;
