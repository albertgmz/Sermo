CREATE TABLE `admin_password_failures` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `admin_password_failures_user` ON `admin_password_failures` (`user_id`,`at`);--> statement-breakpoint
ALTER TABLE `users` ADD `erased_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `sessions_revoked_at` integer;--> statement-breakpoint
CREATE INDEX `users_erased` ON `users` (`id`) WHERE erased_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_failed_updated` ON `jobs` (`updated_at`) WHERE status = 'failed';