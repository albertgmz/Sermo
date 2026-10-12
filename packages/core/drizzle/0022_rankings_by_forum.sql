DROP TABLE `rankings`;--> statement-breakpoint
CREATE TABLE `rankings` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`node_id` integer NOT NULL,
	`position` integer NOT NULL,
	`target_id` integer NOT NULL,
	`score` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rankings_kind_node_position` ON `rankings` (`kind`,`node_id`,`position`);--> statement-breakpoint
CREATE INDEX `threads_node_state_id` ON `threads` (`node_id`,`state`,`id`);
