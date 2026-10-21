CREATE TABLE `widgets` (
	`id` integer PRIMARY KEY NOT NULL,
	`position` text NOT NULL,
	`type` text NOT NULL,
	`display_order` integer NOT NULL,
	`title` text,
	`options` text DEFAULT '{}' NOT NULL,
	`rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL,
	`phones` integer DEFAULT true NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `widgets_position` ON `widgets` (`position`,`display_order`,`id`);--> statement-breakpoint
-- The blocks the pages draw today become widgets: the forum statistics (on while the old
-- `forumStatsEnabled` setting is on) and the featured threads above the pages, and the four side
-- blocks of the feed page. Written only into an empty table, so running this again adds nothing.
INSERT INTO `widgets` (`position`, `type`, `display_order`, `title`, `options`, `rule`, `phones`, `is_enabled`, `created_at`, `updated_at`)
SELECT `column1`, `column2`, `column3`, NULL, `column4`, '{"match":"all","conditions":[]}', 1, `column5`,
  CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM (VALUES
  ('overview_top', 'forumStats', 0, '{}',
    COALESCE((SELECT json_extract(`value`, '$.forumStatsEnabled') FROM `site_settings` WHERE `key` = 'configuration'), 0)),
  ('overview_top', 'featured', 1, '{}', 1),
  ('novedades_sidebar', 'rankedThreads', 0, '{"by":"mostReacted","limit":5}', 1),
  ('novedades_sidebar', 'rankedThreads', 1, '{"by":"latestThreads","limit":5}', 1),
  ('novedades_sidebar', 'suggestedMembers', 2, '{"limit":4}', 1),
  ('novedades_sidebar', 'forumLinks', 3, '{"limit":6}', 1)
)
WHERE NOT EXISTS (SELECT 1 FROM `widgets`);
