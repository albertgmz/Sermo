CREATE TABLE `forum_prefixes` (
	`id` integer PRIMARY KEY NOT NULL,
	`node_id` integer NOT NULL,
	`prefix_id` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prefix_id`) REFERENCES `thread_prefixes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forum_prefixes_pair` ON `forum_prefixes` (`node_id`,`prefix_id`);--> statement-breakpoint
CREATE INDEX `forum_prefixes_prefix` ON `forum_prefixes` (`prefix_id`);--> statement-breakpoint
ALTER TABLE `nodes` ADD `require_prefix` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Until now every prefix could go on any thread of any forum. Every forum starts by offering every
-- prefix, so nothing changes on the day of the upgrade: administrators narrow the sets afterwards.
-- A handful of rows (forums are few, prefixes are capped at 100); no thread is read or written.
INSERT INTO `forum_prefixes` (`node_id`, `prefix_id`)
SELECT n.`id`, p.`id` FROM `nodes` n CROSS JOIN `thread_prefixes` p WHERE n.`type` = 'forum';
