ALTER TABLE `nodes` ADD `is_adult` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `is_adult` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_adult` ON `threads` (`node_id`,`is_sticky`,`state`) WHERE is_adult = 1;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_adult` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `adult_accepted_at` integer;