-- The home page becomes the forum list and the feed moves to `/novedades`, so the home page has no
-- Forums tab any more. A member who chose it opens on the site's default; a home tab rule that
-- picked it is dropped, and a fallback of Forums becomes Latest.
UPDATE `users` SET `home_tab` = NULL WHERE `home_tab` = 'forums';
--> statement-breakpoint
UPDATE `site_settings`
SET `value` = json_set(`value`, '$.homeTab.rules', (
  SELECT json_group_array(json(rule.value) ORDER BY rule.key)
  FROM json_each(`site_settings`.`value`, '$.homeTab.rules') AS rule
  WHERE json_extract(rule.value, '$.tab') IS NOT 'forums'
))
WHERE `key` = 'configuration' AND json_type(`value`, '$.homeTab.rules') = 'array';
--> statement-breakpoint
UPDATE `site_settings`
SET `value` = json_set(`value`, '$.homeTab.fallback', 'latest')
WHERE `key` = 'configuration' AND json_extract(`value`, '$.homeTab.fallback') = 'forums';
--> statement-breakpoint
-- The header: Home (`/`) is now the forum list and is called Forums (a title an administrator
-- changed is kept); the old Forums entry leads to What's new and is called so whatever its title
-- was, since it now leads to another page.
UPDATE `navigation_entries` SET `title` = 'Forums' WHERE `builtin` = 'header.home' AND `title` = 'Home';
--> statement-breakpoint
UPDATE `navigation_entries`
SET `builtin` = 'header.novedades',
  `target` = '/novedades',
  `title` = 'What''s new',
  `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `builtin` = 'header.forums';
--> statement-breakpoint
UPDATE `navigation_entries` SET `target` = '/'
WHERE `builtin` = 'footer.community.forums' AND `target` = '/forums';
--> statement-breakpoint
-- The phone bar: What's new takes Profile's row and goes right after Home, for everyone, however
-- the bar is numbered: the top-level entries after Home move one place down first. Without a Home
-- entry nothing moves and What's new keeps Profile's place. The avatar menu at the top still leads
-- to the profile. Anything an administrator put under Profile goes with it.
DELETE FROM `navigation_entries`
WHERE `parent_id` = (SELECT `id` FROM `navigation_entries` WHERE `builtin` = 'mobile.profile');
--> statement-breakpoint
UPDATE `navigation_entries` SET `position` = `position` + 1
WHERE `location` = 'mobile' AND `parent_id` IS NULL
  AND (`builtin` IS NULL OR `builtin` <> 'mobile.profile')
  AND `position` > (SELECT `position` FROM `navigation_entries` WHERE `builtin` = 'mobile.home');
--> statement-breakpoint
UPDATE `navigation_entries`
SET `builtin` = 'mobile.novedades',
  `title` = 'What''s new',
  `target` = '/novedades',
  `position` = COALESCE(
    (SELECT `position` + 1 FROM `navigation_entries` WHERE `builtin` = 'mobile.home'),
    `position`
  ),
  `is_enabled` = 1,
  `audience` = 'everyone',
  `permission` = NULL,
  `icon` = NULL,
  `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `builtin` = 'mobile.profile';
