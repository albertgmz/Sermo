CREATE TABLE `terms_acceptances` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`ip` text,
	`accepted_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_acceptances_member` ON `terms_acceptances` (`user_id`,`kind`,`version`);--> statement-breakpoint
CREATE INDEX `terms_acceptances_with_ip` ON `terms_acceptances` (`id`) WHERE ip IS NOT NULL;--> statement-breakpoint
ALTER TABLE `static_pages` ADD `version` integer DEFAULT 1 NOT NULL;