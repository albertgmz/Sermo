CREATE INDEX `posts_user` ON `posts` (`user_id`,`state`,`thread_id`);--> statement-breakpoint
CREATE INDEX `reactions_recipient` ON `reactions` (`content_user_id`,`score`);