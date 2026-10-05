CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY NOT NULL,
	`file_id` integer NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_file` ON `attachments` (`file_id`);--> statement-breakpoint
CREATE INDEX `attachments_content` ON `attachments` (`content_type`,`content_id`,`position`);--> statement-breakpoint
CREATE TABLE `bans` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`moderator_id` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`lifted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moderator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bans_user_active` ON `bans` (`user_id`,`lifted_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `domain_events_target` ON `domain_events` (`target_type`,`target_id`,`id`);--> statement-breakpoint
CREATE TABLE `event_subscribers` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_subscribers_name_unique` ON `event_subscribers` (`name`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY NOT NULL,
	`driver` text NOT NULL,
	`storage_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_type` text NOT NULL,
	`sha256` text NOT NULL,
	`width` integer,
	`height` integer,
	`uploader_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`visibility` text DEFAULT 'unattached' NOT NULL,
	`parent_file_id` integer,
	`variant` text,
	`download_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`attached_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_driver_key` ON `files` (`driver`,`storage_key`);--> statement-breakpoint
CREATE INDEX `files_unattached_cleanup` ON `files` (`visibility`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `files_uploader` ON `files` (`uploader_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_variant` ON `files` (`parent_file_id`,`variant`);--> statement-breakpoint
CREATE TABLE `moderator_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`actor_id` integer NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moderator_log_recent` ON `moderator_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `moderator_log_actor` ON `moderator_log` (`actor_id`,`id`);--> statement-breakpoint
CREATE INDEX `moderator_log_target` ON `moderator_log` (`target_type`,`target_id`,`id`);--> statement-breakpoint
CREATE TABLE `post_revisions` (
	`id` integer PRIMARY KEY NOT NULL,
	`post_id` integer NOT NULL,
	`editor_id` integer NOT NULL,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	`edited_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`editor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_revisions_post` ON `post_revisions` (`post_id`,`id`);--> statement-breakpoint
CREATE TABLE `report_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`assigned_to_id` integer,
	`report_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_groups_target` ON `report_groups` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `report_groups_queue` ON `report_groups` (`state`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `report_groups_assignee` ON `report_groups` (`assigned_to_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_id` integer NOT NULL,
	`reporter_id` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `report_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_group` ON `reports` (`group_id`,`id`);--> statement-breakpoint
CREATE INDEX `reports_reporter` ON `reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_key_unique` ON `site_settings` (`key`);--> statement-breakpoint
CREATE TABLE `warnings` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`moderator_id` integer NOT NULL,
	`points` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moderator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warnings_user_expiry` ON `warnings` (`user_id`,`expires_at`,`id`);--> statement-breakpoint
CREATE TABLE `word_filters` (
	`id` integer PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`action` text NOT NULL,
	`replacement` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_filters_term` ON `word_filters` (`term`);--> statement-breakpoint
ALTER TABLE `conversation_messages` ADD `attachment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `icon_file_id` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `cover_file_id` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `attachment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profile_posts` ADD `attachment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `excerpt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `content_updated_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_file_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `cover_file_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `banned_until` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `banned_permanently` integer DEFAULT false NOT NULL;