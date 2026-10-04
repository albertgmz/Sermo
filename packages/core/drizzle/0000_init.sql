CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_expires_at` ON `api_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `cache_versions` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cache_versions_key` ON `cache_versions` (`key`);--> statement-breakpoint
CREATE TABLE `conversation_messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`conversation_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`state` text DEFAULT 'visible' NOT NULL,
	`created_at` integer NOT NULL,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	`reaction_counts` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversation_messages_conv` ON `conversation_messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE TABLE `conversation_participants` (
	`id` integer PRIMARY KEY NOT NULL,
	`conversation_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`joined_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`last_read_message_id` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_participants_conv_user` ON `conversation_participants` (`conversation_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `conversation_participants_inbox` ON `conversation_participants` (`user_id`,`state`,`last_message_at`,`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`last_message_id` integer,
	`last_message_user_id` integer NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`participant_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_moderator` integer DEFAULT false NOT NULL,
	`can_view_nodes` integer DEFAULT true NOT NULL,
	`can_post` integer DEFAULT false NOT NULL,
	`can_view_profiles` integer DEFAULT true NOT NULL,
	`can_post_profile` integer DEFAULT false NOT NULL,
	`can_start_conversations` integer DEFAULT false NOT NULL,
	`can_react` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`locked_until` integer,
	`unique_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_unique_key` ON `jobs` (`unique_key`);--> statement-breakpoint
CREATE TABLE `node_permissions` (
	`id` integer PRIMARY KEY NOT NULL,
	`node_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`can_view` integer,
	`can_post` integer,
	`can_moderate` integer,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_permissions_node_group` ON `node_permissions` (`node_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_id` integer,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`thread_count` integer DEFAULT 0 NOT NULL,
	`post_count` integer DEFAULT 0 NOT NULL,
	`last_post_at` integer,
	`last_post_id` integer,
	`last_thread_id` integer,
	`last_thread_title` text,
	`last_poster_id` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nodes_parent_position` ON `nodes` (`parent_id`,`position`);--> statement-breakpoint
CREATE TABLE `post_bodies` (
	`post_id` integer PRIMARY KEY NOT NULL,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`position` integer NOT NULL,
	`state` text DEFAULT 'visible' NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`reaction_counts` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_thread_position` ON `posts` (`thread_id`,`position`);--> statement-breakpoint
CREATE TABLE `profile_post_comments` (
	`id` integer PRIMARY KEY NOT NULL,
	`profile_post_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`state` text DEFAULT 'visible' NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	`reaction_counts` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`profile_post_id`) REFERENCES `profile_posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_post_comments_post` ON `profile_post_comments` (`profile_post_id`,`id`);--> statement-breakpoint
CREATE TABLE `profile_posts` (
	`id` integer PRIMARY KEY NOT NULL,
	`profile_user_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`state` text DEFAULT 'visible' NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	`reaction_counts` text DEFAULT '{}' NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`last_comment_at` integer,
	FOREIGN KEY (`profile_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_posts_wall` ON `profile_posts` (`profile_user_id`,`id`);--> statement-breakpoint
CREATE TABLE `reaction_types` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`emoji` text NOT NULL,
	`score` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`content_user_id` integer NOT NULL,
	`reaction_type_id` integer NOT NULL,
	`score` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reaction_type_id`) REFERENCES `reaction_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_content_user` ON `reactions` (`content_type`,`content_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `thread_reads` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`thread_id` integer NOT NULL,
	`last_read_post_id` integer NOT NULL,
	`last_read_position` integer NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_reads_user_thread` ON `thread_reads` (`user_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` integer PRIMARY KEY NOT NULL,
	`node_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`state` text DEFAULT 'visible' NOT NULL,
	`is_sticky` integer DEFAULT false NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`first_post_id` integer,
	`last_post_at` integer NOT NULL,
	`last_post_id` integer,
	`last_poster_id` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `threads_node_list` ON `threads` (`node_id`,`is_sticky`,`last_post_at`,`id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_key` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`group_id` integer NOT NULL,
	`about` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`post_count` integer DEFAULT 0 NOT NULL,
	`reaction_score` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_key` ON `users` (`username_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email` ON `users` (`email`);