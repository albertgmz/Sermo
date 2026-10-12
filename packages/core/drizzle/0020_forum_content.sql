CREATE TABLE `forum_tabs` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forum_tabs_position` ON `forum_tabs` (`position`,`id`);--> statement-breakpoint
CREATE TABLE `rankings` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`target_id` integer NOT NULL,
	`score` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rankings_kind_position` ON `rankings` (`kind`,`position`);--> statement-breakpoint
CREATE TABLE `thread_prefixes` (
	`id` integer PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color_id` integer NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`color_id`) REFERENCES `palette_colors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `thread_prefixes_position` ON `thread_prefixes` (`position`,`id`);--> statement-breakpoint
CREATE INDEX `thread_prefixes_color` ON `thread_prefixes` (`color_id`);--> statement-breakpoint
ALTER TABLE `nodes` ADD `tab_id` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `prefix_id` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `highlighted_until` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `bumped_at` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `sort_at` integer GENERATED ALWAYS AS (max(coalesce(last_post_at, 0), coalesce(bumped_at, 0))) VIRTUAL;--> statement-breakpoint
CREATE INDEX `threads_node_sort` ON `threads` (`node_id`,`is_sticky`,`sort_at`,`id`);--> statement-breakpoint
CREATE INDEX `threads_prefix` ON `threads` (`prefix_id`,`node_id`,`is_sticky`,`sort_at`,`id`) WHERE prefix_id IS NOT NULL;