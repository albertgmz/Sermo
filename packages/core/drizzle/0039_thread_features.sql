CREATE TABLE `thread_features` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer NOT NULL,
	`kind` text NOT NULL,
	`user_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `thread_features_end` ON `thread_features` (`ends_at`);--> statement-breakpoint
CREATE INDEX `thread_features_thread` ON `thread_features` (`thread_id`,`ends_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_features_staff` ON `thread_features` (`thread_id`) WHERE kind = 'staff' AND ends_at IS NULL;