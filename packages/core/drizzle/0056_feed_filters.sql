CREATE TABLE `feed_filters` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`scope` text NOT NULL,
	`filter` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_filters_user_name` ON `feed_filters` (`user_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `feed_filters_user` ON `feed_filters` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `feed_hidden_nodes` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`node_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_hidden_nodes_pair` ON `feed_hidden_nodes` (`user_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `threads_prefix_feed` ON `threads` (`prefix_id`,`state`,"last_post_at" desc,"id" desc) WHERE prefix_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_sticky_feed` ON `threads` (`state`,"last_post_at" desc,"id" desc) WHERE is_sticky = 1;--> statement-breakpoint
CREATE INDEX `threads_locked_feed` ON `threads` (`state`,"last_post_at" desc,"id" desc) WHERE is_locked = 1;