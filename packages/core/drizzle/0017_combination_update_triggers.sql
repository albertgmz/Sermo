-- The combination triggers of 0011 and 0016 fire on INSERT and DELETE only, so a row whose
-- member or group was changed by UPDATE left both members on their previous combinations.
-- Each table gets two more triggers with the bodies of its DELETE and INSERT triggers: one
-- recomputes the member the row left, the other the member it now belongs to.
CREATE TRIGGER permission_entries_combination_update_old AFTER UPDATE OF user_id, group_id ON permission_entries WHEN old.user_id <> 0 AND EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_combination_update_new AFTER UPDATE OF user_id, group_id ON permission_entries WHEN new.user_id <> 0 AND EXISTS (SELECT 1 FROM users WHERE id = new.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_groups_combination_update_old AFTER UPDATE OF user_id, group_id ON user_groups WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_groups_combination_update_new AFTER UPDATE OF user_id, group_id ON user_groups BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_group_grants_combination_update_old AFTER UPDATE OF user_id, group_id ON user_group_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_group_grants_combination_update_new AFTER UPDATE OF user_id, group_id ON user_group_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_group_grants_combination_update_old AFTER UPDATE OF user_id, group_id ON shop_group_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_group_grants_combination_update_new AFTER UPDATE OF user_id, group_id ON shop_group_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_permission_grants_combination_update_old AFTER UPDATE OF user_id ON shop_permission_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_permission_grants_combination_update_new AFTER UPDATE OF user_id ON shop_permission_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
-- A purchased permission moved to another member changes both members' layers (INSERT and
-- DELETE already bump them, see 0016).
CREATE TRIGGER shop_permission_grants_version_update AFTER UPDATE ON shop_permission_grants BEGIN
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (0, old.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (0, new.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
