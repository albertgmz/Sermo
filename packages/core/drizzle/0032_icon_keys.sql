ALTER TABLE `navigation_entries` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `navigation_entries` ADD `icon_position` text DEFAULT 'before' NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `icon_key` text;