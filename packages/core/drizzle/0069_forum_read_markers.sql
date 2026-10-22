CREATE TABLE `node_reads` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`node_id` integer NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_reads_user_node` ON `node_reads` (`user_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `node_reads_read_at` ON `node_reads` (`read_at`);--> statement-breakpoint
CREATE INDEX `posts_thread_created` ON `posts` (`thread_id`,`created_at`);
--> statement-breakpoint
-- Deleting a node (`nodes.delete`) removes what hangs off it. The old per-group overrides are a
-- write-through shim nothing reads any more; a row of one still holds a foreign key to its node,
-- so it goes with the node (the existing delete trigger on the shim removes its mirrored entries).
CREATE TRIGGER `nodes_delete_legacy_overrides` BEFORE DELETE ON `nodes` BEGIN
  DELETE FROM `node_permissions` WHERE `node_id` = old.`id`;
END;
