-- Administration cannot start or end in a promotion job. Keep every existing membership,
-- including grants whose promotion no longer lists the group or is awaiting deletion.
CREATE TEMP TABLE administration_promotion_groups (group_id INTEGER PRIMARY KEY);
--> statement-breakpoint
INSERT INTO administration_promotion_groups (group_id)
SELECT DISTINCT e.group_id FROM permission_entries e
JOIN permission_definitions d ON d.id = e.permission_id
WHERE d.key = 'admin.permissions' AND e.group_id <> 0;
--> statement-breakpoint
INSERT OR IGNORE INTO user_groups (user_id, group_id, created_at)
SELECT g.user_id, g.group_id, min(g.created_at)
FROM user_group_grants g
JOIN administration_promotion_groups a ON a.group_id = g.group_id
GROUP BY g.user_id, g.group_id;
--> statement-breakpoint
DELETE FROM user_group_grants
WHERE group_id IN (SELECT group_id FROM administration_promotion_groups);
--> statement-breakpoint
UPDATE promotions SET group_ids = (
  SELECT json_group_array(value ORDER BY key) FROM json_each(promotions.group_ids)
  WHERE value NOT IN (SELECT group_id FROM administration_promotion_groups)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(promotions.group_ids)
  WHERE value IN (SELECT group_id FROM administration_promotion_groups)
);
--> statement-breakpoint
DROP TABLE administration_promotion_groups;
--> statement-breakpoint
-- Verification changes Unconfirmed to Member without an administration request. Move legacy
-- decisions from those automatic groups to their current holders, preserving never over allow
-- across both groups and any existing member entry. Future members inherit neither decision.
WITH legacy_entries AS MATERIALIZED (
  SELECT e.permission_id, e.group_id, e.value FROM permission_entries e
  JOIN permission_definitions d ON d.id = e.permission_id
  JOIN groups g ON g.id = e.group_id
  WHERE d.key = 'admin.permissions' AND e.node_id = 0 AND e.user_id = 0
    AND (g.builtin = 'unconfirmed' OR (g.builtin = 'registered' AND e.value = -1))
), holders AS MATERIALIZED (
  SELECT u.id AS user_id, e.permission_id, e.value FROM users u
  JOIN legacy_entries e ON e.group_id = u.group_id
  UNION ALL
  SELECT g.user_id, e.permission_id, e.value FROM user_groups g
  JOIN legacy_entries e ON e.group_id = g.group_id
  UNION ALL
  SELECT g.user_id, e.permission_id, e.value FROM user_group_grants g
  JOIN legacy_entries e ON e.group_id = g.group_id
  UNION ALL
  SELECT g.user_id, e.permission_id, e.value FROM shop_group_grants g
  JOIN legacy_entries e ON e.group_id = g.group_id
)
INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value)
SELECT permission_id, 0, 0, user_id,
  CASE WHEN min(value) = -1 THEN -1 ELSE max(value) END
FROM holders GROUP BY user_id, permission_id
ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value =
  CASE WHEN permission_entries.value = -1 OR excluded.value = -1 THEN -1
    ELSE max(permission_entries.value, excluded.value) END;
--> statement-breakpoint
DELETE FROM permission_entries
WHERE permission_id = (SELECT id FROM permission_definitions WHERE key = 'admin.permissions')
  AND user_id = 0 AND node_id = 0
  AND (group_id IN (SELECT id FROM groups WHERE builtin = 'unconfirmed')
    OR (group_id IN (SELECT id FROM groups WHERE builtin = 'registered') AND value = -1));
--> statement-breakpoint
-- 0017 prevents future stale combinations but cannot repair those left by older UPDATEs.
-- Materialize each member's desired key once using the same union and private-layer test as
-- 0016. The primary key and permission_combinations_key make the final update indexed, rather
-- than scanning all members for each distinct combination on a large installation.
CREATE TEMP TABLE repaired_permission_combinations (
  user_id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL,
  group_ids TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO repaired_permission_combinations (user_id, member_id, group_ids)
SELECT u.id,
  CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = u.id)
    OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = u.id)
    THEN u.id ELSE 0 END,
  (SELECT group_concat(g, ',' ORDER BY g) FROM (
    SELECT u.group_id AS g
    UNION SELECT group_id FROM user_groups WHERE user_id = u.id
    UNION SELECT group_id FROM user_group_grants WHERE user_id = u.id
    UNION SELECT group_id FROM shop_group_grants WHERE user_id = u.id
  ))
FROM users u;
--> statement-breakpoint
INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
SELECT DISTINCT member_id, group_ids, CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM repaired_permission_combinations;
--> statement-breakpoint
UPDATE users SET permission_combination_id = c.id
FROM repaired_permission_combinations r
JOIN permission_combinations c ON c.user_id = r.member_id AND c.group_ids = r.group_ids
WHERE users.id = r.user_id AND users.permission_combination_id IS NOT c.id;
--> statement-breakpoint
DROP TABLE repaired_permission_combinations;
--> statement-breakpoint
INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
ON CONFLICT (key) DO UPDATE SET version = version + 1;
