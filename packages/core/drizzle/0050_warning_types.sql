CREATE TABLE `warning_action_fires` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`action_id` integer NOT NULL,
	`fired_at` integer NOT NULL,
	`group_id` integer,
	`group_added_at` integer,
	`group_ends_at` integer,
	`notify` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`action_id`) REFERENCES `warning_actions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warning_action_fires_member` ON `warning_action_fires` (`user_id`,`action_id`);--> statement-breakpoint
CREATE INDEX `warning_action_fires_action` ON `warning_action_fires` (`action_id`);--> statement-breakpoint
CREATE INDEX `warning_action_fires_ends` ON `warning_action_fires` (`group_ends_at`) WHERE group_ends_at IS NOT NULL;--> statement-breakpoint
CREATE TABLE `warning_actions` (
	`id` integer PRIMARY KEY NOT NULL,
	`threshold` integer NOT NULL,
	`kind` text NOT NULL,
	`days` integer,
	`group_id` integer,
	`restriction_kind` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warning_actions_threshold` ON `warning_actions` (`threshold`,`id`);--> statement-breakpoint
CREATE TABLE `warning_types` (
	`id` integer PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_es` text NOT NULL,
	`points` integer NOT NULL,
	`expiry_days` integer,
	`default_reason` text DEFAULT '' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
ALTER TABLE `warnings` ADD `type_id` integer REFERENCES warning_types(id);--> statement-breakpoint
CREATE INDEX `warnings_type` ON `warnings` (`type_id`) WHERE type_id IS NOT NULL;