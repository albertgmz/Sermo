CREATE TABLE `award_categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `awards` ADD `category_id` integer REFERENCES award_categories(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `awards_category` ON `awards` (`category_id`);