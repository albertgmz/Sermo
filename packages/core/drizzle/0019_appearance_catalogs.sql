CREATE TABLE `catalog_images` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`file_id` integer,
	`frame_width` real,
	`frame_left` real,
	`frame_top` real,
	`frame_scale` real,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `catalog_images_kind` ON `catalog_images` (`kind`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `palette_colors` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`foreground` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `palette_colors_kind` ON `palette_colors` (`kind`,`position`,`id`);--> statement-breakpoint
ALTER TABLE `awards` ADD `image_file_id` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `shop_items` ADD `image_file_id` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `cover_id` integer;--> statement-breakpoint
CREATE INDEX `threads_cover` ON `threads` (`cover_id`) WHERE cover_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `accent_color_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `name_color_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `frame_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `cover_preset_id` integer;--> statement-breakpoint
CREATE INDEX `users_accent_color` ON `users` (`accent_color_id`) WHERE accent_color_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `users_name_color` ON `users` (`name_color_id`) WHERE name_color_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `users_frame` ON `users` (`frame_id`) WHERE frame_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `users_cover_preset` ON `users` (`cover_preset_id`) WHERE cover_preset_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO `palette_colors` (`kind`, `name`, `color`, `foreground`, `position`, `is_active`, `created_at`, `updated_at`) VALUES
  ('accent', 'Red', '#dc2626', '#ffffff', 0, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('accent', 'Orange', '#ea580c', '#1a0a03', 1, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('accent', 'Amber', '#f59e0b', '#1c1304', 2, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('accent', 'Emerald', '#10b981', '#022c22', 3, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('accent', 'Sky', '#0ea5e9', '#03131f', 4, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('accent', 'Violet', '#8452f6', '#ffffff', 5, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Rose', '#fb7185', NULL, 0, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Coral', '#fb923c', NULL, 1, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Lime', '#a3e635', NULL, 2, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Emerald', '#34d399', NULL, 3, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Cyan', '#22d3ee', NULL, 4, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Sky', '#60a5fa', NULL, 5, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Indigo', '#818cf8', NULL, 6, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Pink', '#f472b6', NULL, 7, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Silver', '#c4c4cc', NULL, 8, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Gold', '#eab308', NULL, 9, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('name', 'Legendary', '#a78bfa', NULL, 10, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Sky', '#60a5fa', NULL, 0, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Emerald', '#34d399', NULL, 1, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Orange', '#fb923c', NULL, 2, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Violet', '#818cf8', NULL, 3, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Amber', '#eab308', NULL, 4, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Cyan', '#22d3ee', NULL, 5, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Rose', '#fb7185', NULL, 6, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('prefix', 'Lime', '#a3e635', NULL, 7, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER));
