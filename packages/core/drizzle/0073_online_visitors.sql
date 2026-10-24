CREATE TABLE `online_visitors` (
	`id` integer PRIMARY KEY NOT NULL,
	`visitor_key` text NOT NULL,
	`user_id` integer,
	`robot` text,
	`place_kind` text NOT NULL,
	`place_id` integer,
	`ip` text,
	`seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `online_visitors_key` ON `online_visitors` (`visitor_key`);--> statement-breakpoint
CREATE INDEX `online_visitors_seen` ON `online_visitors` (`seen_at`);