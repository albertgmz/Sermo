CREATE TABLE `credit_backfill_members` (
	`id` integer PRIMARY KEY NOT NULL,
	`run_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`total` integer NOT NULL,
	`paid` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `credit_backfills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_backfill_members_run_user` ON `credit_backfill_members` (`run_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `credit_backfills` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`preview_id` integer,
	`from_at` integer NOT NULL,
	`until_at` integer NOT NULL,
	`cap` integer NOT NULL,
	`started_by` integer NOT NULL,
	`last_user_id` integer DEFAULT 0 NOT NULL,
	`through` integer DEFAULT 0 NOT NULL,
	`by_trigger` text DEFAULT '{}' NOT NULL,
	`summary` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
