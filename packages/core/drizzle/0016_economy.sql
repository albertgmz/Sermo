-- Economy: credits, credit rules, awards and the shop. Additive: no existing table is rebuilt.
ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN award_xp INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN shop_purchase_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `shop_permission_grants` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`inventory_id` integer NOT NULL,
	`permission_id` integer NOT NULL,
	`value` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permission_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_permission_grants_key` ON `shop_permission_grants` (`inventory_id`,`permission_id`);
--> statement-breakpoint
CREATE INDEX `shop_permission_grants_user` ON `shop_permission_grants` (`user_id`,`permission_id`);
--> statement-breakpoint
CREATE TABLE `shop_group_grants` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`inventory_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_group_grants_key` ON `shop_group_grants` (`inventory_id`,`group_id`);
--> statement-breakpoint
CREATE INDEX `shop_group_grants_user` ON `shop_group_grants` (`user_id`,`group_id`);
--> statement-breakpoint
CREATE INDEX `shop_group_grants_group` ON `shop_group_grants` (`group_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`type` text NOT NULL,
	`source_type` text,
	`source_id` integer,
	`actor_id` integer,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_transactions_user` ON `credit_transactions` (`user_id`,`id`);
--> statement-breakpoint
CREATE TABLE `credit_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`trigger` text NOT NULL,
	`amount` integer NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`limit_count` integer,
	`limit_window_hours` integer,
	`node_ids` text DEFAULT '[]' NOT NULL,
	`created_after_event_id` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credit_rule_applications` (
	`id` integer PRIMARY KEY NOT NULL,
	`rule_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`source_user_id` integer DEFAULT 0 NOT NULL,
	`amount` integer NOT NULL,
	`state` text DEFAULT 'applied' NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_rule_applications_key` ON `credit_rule_applications` (`rule_id`,`user_id`,`source_type`,`source_id`,`source_user_id`);
--> statement-breakpoint
CREATE INDEX `credit_rule_applications_source` ON `credit_rule_applications` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `credit_rule_applications_limit` ON `credit_rule_applications` (`rule_id`,`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `awards` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`tier` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`is_stackable` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`criteria` text DEFAULT '[]' NOT NULL,
	`grant_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member_awards` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`award_id` integer NOT NULL,
	`granted_by` integer,
	`reason` text DEFAULT '' NOT NULL,
	`xp` integer NOT NULL,
	`credits` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`award_id`) REFERENCES `awards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_awards_user` ON `member_awards` (`user_id`,`revoked_at`,`id`);
--> statement-breakpoint
CREATE INDEX `member_awards_award` ON `member_awards` (`award_id`,`revoked_at`,`id`);
--> statement-breakpoint
CREATE TABLE `member_award_totals` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`award_id` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`auto_granted` integer DEFAULT 0 NOT NULL,
	`last_granted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`award_id`) REFERENCES `awards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_award_totals_user_award` ON `member_award_totals` (`user_id`,`award_id`);
--> statement-breakpoint
CREATE INDEX `member_award_totals_award` ON `member_award_totals` (`award_id`,`count`);
--> statement-breakpoint
CREATE TABLE `shop_categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`price` integer NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`stock` integer,
	`is_consumable` integer DEFAULT 0 NOT NULL,
	`is_giftable` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`effect` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `shop_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shop_items_category` ON `shop_items` (`category_id`,`position`,`id`);
--> statement-breakpoint
CREATE TABLE `shop_inventory` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`state` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`expires_at` integer,
	`acquired_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `shop_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_inventory_user_item` ON `shop_inventory` (`user_id`,`item_id`);
--> statement-breakpoint
CREATE INDEX `shop_inventory_user_state` ON `shop_inventory` (`user_id`,`state`,`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `shop_inventory_expiry` ON `shop_inventory` (`state`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `shop_purchases` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`buyer_id` integer NOT NULL,
	`recipient_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`price` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shop_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shop_purchases_buyer` ON `shop_purchases` (`buyer_id`,`id`);
--> statement-breakpoint
CREATE INDEX `shop_purchases_buyer_item` ON `shop_purchases` (`buyer_id`,`item_id`);
--> statement-breakpoint
CREATE INDEX `shop_purchases_item` ON `shop_purchases` (`item_id`,`id`);
--> statement-breakpoint
-- A member's combination now also counts groups held through shop items, and is private to
-- the member when they hold a purchased permission. The combination triggers of 0011 are
-- recreated with those two additions; the four new tables' triggers follow the same shape.
DROP TRIGGER users_combination_insert;
--> statement-breakpoint
DROP TRIGGER users_combination_group;
--> statement-breakpoint
DROP TRIGGER user_groups_combination_insert;
--> statement-breakpoint
DROP TRIGGER user_groups_combination_delete;
--> statement-breakpoint
DROP TRIGGER user_group_grants_combination_insert;
--> statement-breakpoint
DROP TRIGGER user_group_grants_combination_delete;
--> statement-breakpoint
DROP TRIGGER permission_entries_combination_insert;
--> statement-breakpoint
DROP TRIGGER permission_entries_combination_delete;
--> statement-breakpoint
CREATE TRIGGER users_combination_insert AFTER INSERT ON users BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.id) THEN new.id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.id) THEN new.id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.id))
  ) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER users_combination_group AFTER UPDATE OF group_id ON users BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.id) THEN new.id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.id) THEN new.id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.id UNION SELECT group_id FROM user_groups WHERE user_id = new.id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.id))
  ) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER user_groups_combination_insert AFTER INSERT ON user_groups BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_groups_combination_delete AFTER DELETE ON user_groups WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_group_grants_combination_insert AFTER INSERT ON user_group_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER user_group_grants_combination_delete AFTER DELETE ON user_group_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_combination_insert AFTER INSERT ON permission_entries WHEN new.user_id <> 0 AND EXISTS (SELECT 1 FROM users WHERE id = new.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER permission_entries_combination_delete AFTER DELETE ON permission_entries WHEN old.user_id <> 0 AND EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_group_grants_combination_insert AFTER INSERT ON shop_group_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_group_grants_combination_delete AFTER DELETE ON shop_group_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_permission_grants_combination_insert AFTER INSERT ON shop_permission_grants BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = new.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = new.user_id) THEN new.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = new.user_id UNION SELECT group_id FROM user_groups WHERE user_id = new.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = new.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = new.user_id))
  ) WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER shop_permission_grants_combination_delete AFTER DELETE ON shop_permission_grants WHEN EXISTS (SELECT 1 FROM users WHERE id = old.user_id) BEGIN
  INSERT OR IGNORE INTO permission_combinations (user_id, group_ids, created_at)
    VALUES ((CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END), (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id)), CAST(unixepoch('subsec') * 1000 AS INTEGER));
  UPDATE users SET permission_combination_id = (
    SELECT id FROM permission_combinations WHERE user_id = (CASE WHEN EXISTS (SELECT 1 FROM permission_entries WHERE group_id = 0 AND user_id = old.user_id) OR EXISTS (SELECT 1 FROM shop_permission_grants WHERE user_id = old.user_id) THEN old.user_id ELSE 0 END) AND group_ids = (SELECT group_concat(g, ',' ORDER BY g) FROM (SELECT group_id AS g FROM users WHERE id = old.user_id UNION SELECT group_id FROM user_groups WHERE user_id = old.user_id UNION SELECT group_id FROM user_group_grants WHERE user_id = old.user_id UNION SELECT group_id FROM shop_group_grants WHERE user_id = old.user_id))
  ) WHERE id = old.user_id;
END;
--> statement-breakpoint
-- A purchased permission lives in the member's layer: bump it and the permissions cache.
CREATE TRIGGER shop_permission_grants_version_insert AFTER INSERT ON shop_permission_grants BEGIN
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (0, new.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER shop_permission_grants_version_delete AFTER DELETE ON shop_permission_grants BEGIN
  INSERT INTO permission_layer_versions (group_id, user_id, version) VALUES (0, old.user_id, 1)
    ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1;
  INSERT INTO cache_versions (key, version) VALUES ('permissions', 1)
    ON CONFLICT (key) DO UPDATE SET version = version + 1;
END;
