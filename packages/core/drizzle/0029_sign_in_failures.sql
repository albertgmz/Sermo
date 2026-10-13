CREATE TABLE `sign_in_failures` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sign_in_failures_key` ON `sign_in_failures` (`key`,`at`);--> statement-breakpoint
CREATE INDEX `sign_in_failures_at` ON `sign_in_failures` (`at`);