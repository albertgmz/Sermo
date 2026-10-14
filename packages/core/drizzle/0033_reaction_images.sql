ALTER TABLE `reaction_types` ADD `image_file_id` integer;--> statement-breakpoint
ALTER TABLE `reaction_types` ADD `frame_width` integer;--> statement-breakpoint
ALTER TABLE `reaction_types` ADD `frame_height` integer;--> statement-breakpoint
ALTER TABLE `reaction_types` ADD `frame_count` integer DEFAULT 1 NOT NULL;