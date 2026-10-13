-- The Upgrade link leaves the header and the footer: it is an entry of the account menu.
-- Entries an administrator put under it follow it, so a child keeps its parent's location.
UPDATE `navigation_entries` SET `location` = 'account', `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `parent_id` = (SELECT `id` FROM `navigation_entries` WHERE `builtin` = 'header.upgrade');
--> statement-breakpoint
UPDATE `navigation_entries` SET
  `location` = 'account',
  `builtin` = 'account.upgrade',
  `audience` = CASE WHEN `audience` = 'permission' THEN `audience` ELSE 'members' END,
  `position` = (SELECT COALESCE(MAX(`position`), -1) + 1 FROM `navigation_entries` WHERE `location` = 'account' AND `parent_id` IS NULL),
  `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `builtin` = 'header.upgrade';
--> statement-breakpoint
DELETE FROM `navigation_entries` WHERE `builtin` = 'footer.useful.upgrade';
