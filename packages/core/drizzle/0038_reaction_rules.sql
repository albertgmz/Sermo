ALTER TABLE `reaction_types` ADD `rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_types` ADD `forum_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_types` ADD `hide_when_locked` integer DEFAULT false NOT NULL;