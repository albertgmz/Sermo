ALTER TABLE `users` ADD `username_changed_at` integer;--> statement-breakpoint
CREATE INDEX `users_banned` ON `users` (`id`) WHERE banned_permanently = 1 OR banned_until IS NOT NULL;
