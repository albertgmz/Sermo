CREATE INDEX `conversation_messages_state_id` ON `conversation_messages` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `conversation_messages_user_id` ON `conversation_messages` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `posts_state_id` ON `posts` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `posts_user_id` ON `posts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `profile_post_comments_state_id` ON `profile_post_comments` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `profile_post_comments_user_id` ON `profile_post_comments` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `profile_posts_state_id` ON `profile_posts` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `profile_posts_user_id` ON `profile_posts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `threads_state_id` ON `threads` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `threads_user_id` ON `threads` (`user_id`,`id`);