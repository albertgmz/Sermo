CREATE TABLE `member_month_stats` (
	`id` integer PRIMARY KEY NOT NULL,
	`month` integer NOT NULL,
	`user_id` integer NOT NULL,
	`posts` integer DEFAULT 0 NOT NULL,
	`reactions` integer DEFAULT 0 NOT NULL,
	`referrals` integer DEFAULT 0 NOT NULL,
	`points_tenths` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_month_stats_member` ON `member_month_stats` (`month`,`user_id`);--> statement-breakpoint
CREATE INDEX `member_month_stats_standing` ON `member_month_stats` (`month`,"points_tenths" desc,"posts" desc,`user_id`);--> statement-breakpoint
CREATE TABLE `month_winners` (
	`month` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`posts` integer NOT NULL,
	`reactions` integer NOT NULL,
	`referrals` integer NOT NULL,
	`points_tenths` integer NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `groups` ADD `name_color_id` integer;--> statement-breakpoint
ALTER TABLE `groups` ADD `is_staff` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `custom_title` text;--> statement-breakpoint
ALTER TABLE `users` ADD `signature_source` text;--> statement-breakpoint
ALTER TABLE `users` ADD `signature_html` text;--> statement-breakpoint
ALTER TABLE `users` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `birthday_md` text;--> statement-breakpoint
ALTER TABLE `users` ADD `birth_year` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `social_discord` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `social_telegram` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `social_x` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `referred_by` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `referred_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `referral_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `award_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `users_post_count` ON `users` ("post_count" desc,`id`);--> statement-breakpoint
CREATE INDEX `users_reaction_score` ON `users` ("reaction_score" desc,`id`);--> statement-breakpoint
CREATE INDEX `users_award_xp` ON `users` ("award_xp" desc,`id`);--> statement-breakpoint
CREATE INDEX `users_credits` ON `users` ("credits" desc,`id`);--> statement-breakpoint
CREATE INDEX `users_award_count` ON `users` ("award_count" desc,`id`);--> statement-breakpoint
CREATE INDEX `users_referral_count` ON `users` ("referral_count" desc,`id`);--> statement-breakpoint
CREATE INDEX `users_birthday` ON `users` (`birthday_md`,`id`) WHERE birthday_md IS NOT NULL;--> statement-breakpoint
CREATE INDEX `users_referred_at` ON `users` (`referred_at`) WHERE referred_at IS NOT NULL;--> statement-breakpoint
UPDATE `groups` SET `is_staff` = 1 WHERE `builtin` IN ('moderator', 'admin');--> statement-breakpoint
UPDATE `users` SET `award_count` = COALESCE((SELECT SUM(`count`) FROM `member_award_totals` WHERE `member_award_totals`.`user_id` = `users`.`id`), 0);
