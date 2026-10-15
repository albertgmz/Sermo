CREATE TABLE `session_activity` (
	`session_id` integer PRIMARY KEY NOT NULL,
	`last_active_at` integer NOT NULL,
	`country` text,
	`region` text,
	`city` text,
	FOREIGN KEY (`session_id`) REFERENCES `auth_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `ip_log` ADD `country` text;--> statement-breakpoint
ALTER TABLE `ip_log` ADD `region` text;--> statement-breakpoint
ALTER TABLE `ip_log` ADD `city` text;--> statement-breakpoint
CREATE INDEX `ip_log_member_sign_in` ON `ip_log` (`user_id`,`id`) WHERE action IN ('sign_in', 'sign_in_failed');--> statement-breakpoint
CREATE INDEX `ip_log_created_at` ON `ip_log` (`created_at`);