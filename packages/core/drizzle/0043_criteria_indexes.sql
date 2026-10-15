ALTER TABLE `posts` ADD `reaction_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `posts` SET `reaction_total` = (SELECT coalesce(sum(value), 0) FROM json_each(`reaction_counts`)) WHERE `reaction_counts` != '{}';--> statement-breakpoint
CREATE INDEX `posts_user_reactions` ON `posts` (`user_id`,"reaction_total" desc) WHERE reaction_total > 0;--> statement-breakpoint
CREATE INDEX `content_quotes_quoted_user` ON `content_quotes` (`quoted_user_id`,`content_type`,`content_id`);--> statement-breakpoint
CREATE INDEX `credit_transactions_user_created` ON `credit_transactions` (`user_id`,`created_at`,`type`,`amount`);--> statement-breakpoint
CREATE INDEX `reactions_user_type` ON `reactions` (`user_id`,`reaction_type_id`);--> statement-breakpoint
CREATE INDEX `reactions_recipient_type` ON `reactions` (`content_user_id`,`reaction_type_id`);--> statement-breakpoint
CREATE INDEX `users_referrer_referred` ON `users` (`referred_by`,`referred_at`) WHERE referred_by IS NOT NULL;