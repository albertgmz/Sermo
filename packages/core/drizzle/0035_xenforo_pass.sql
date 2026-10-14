CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_user_content` ON `bookmarks` (`user_id`,`content_type`,`content_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_user` ON `bookmarks` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `content_spoilers` (
	`id` integer PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer NOT NULL,
	`position` integer NOT NULL,
	`html` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_spoilers_content` ON `content_spoilers` (`content_type`,`content_id`,`position`);--> statement-breakpoint
CREATE TABLE `notice_dismissals` (
	`id` integer PRIMARY KEY NOT NULL,
	`notice_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`dismissed_at` integer NOT NULL,
	FOREIGN KEY (`notice_id`) REFERENCES `notices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notice_dismissals_user_notice` ON `notice_dismissals` (`user_id`,`notice_id`);--> statement-breakpoint
CREATE TABLE `notices` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	`audience` text DEFAULT 'everyone' NOT NULL,
	`audience_group_id` integer,
	`dismissible` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `url` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `audience` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `announcements` ADD `audience_group_id` integer;--> statement-breakpoint
ALTER TABLE `announcements` ADD `audience_user_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_messages` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `is_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_super_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `users_super_admin` ON `users` (`id`) WHERE is_super_admin = 1;--> statement-breakpoint
-- The first super admin: the member named Lucien on the test site; elsewhere the lowest-id
-- member of the built-in Administrator group (primary or secondary). A database with no such
-- member gets one when the admin bootstrap creates it.
UPDATE `users` SET `is_super_admin` = 1
WHERE `id` = coalesce(
  (SELECT `id` FROM `users` WHERE `username_key` = 'lucien' AND `erased_at` IS NULL),
  (SELECT min(`id`) FROM `users` u WHERE u.`erased_at` IS NULL AND (u.`group_id` = 4
    OR EXISTS (SELECT 1 FROM `user_groups` g WHERE g.`user_id` = u.`id` AND g.`group_id` = 4)))
);
