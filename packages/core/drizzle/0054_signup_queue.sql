ALTER TABLE `users` ADD `signup_review` text;--> statement-breakpoint
CREATE INDEX `users_signup_review` ON `users` (`id`) WHERE signup_review IS NOT NULL AND group_id <> 5;--> statement-breakpoint
CREATE INDEX `notifications_signup_alert` ON `notifications` (`id`) WHERE type = 'moderator.signup' AND read_at IS NULL;