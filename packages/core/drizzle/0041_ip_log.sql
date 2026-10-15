CREATE TABLE `ip_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`ip` text NOT NULL,
	`ip_net` text NOT NULL,
	`action` text NOT NULL,
	`content_type` text,
	`content_id` integer,
	`browser` text,
	`os` text,
	`device_type` text,
	`brand` text,
	`model` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ip_log_member_ip` ON `ip_log` (`user_id`,`ip`,`created_at`,`action`);--> statement-breakpoint
CREATE INDEX `ip_log_net_member` ON `ip_log` (`ip_net`,`user_id`,`created_at`,`action`) WHERE action <> 'sign_in_failed';--> statement-breakpoint
CREATE INDEX `ip_log_content` ON `ip_log` (`content_type`,`content_id`) WHERE content_id IS NOT NULL;