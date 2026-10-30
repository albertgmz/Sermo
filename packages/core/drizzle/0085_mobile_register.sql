-- The phone bar of a guest gets a Create account entry (`mobile.register`), right after Log in. A
-- site that already has the entry does not change. The entries after Log in (in display order:
-- position, then id) move down to make room and keep their order; when one of them shares Log in's
-- position, they move two places, so the new entry is the only one between them and Log in.
-- Without a Log in entry the new entry goes at the end of the bar. The web app hides the entry
-- while registration is closed.
WITH `login` AS MATERIALIZED (
  SELECT `id`, `position` FROM `navigation_entries` WHERE `builtin` = 'mobile.login'
), `after` AS MATERIALIZED (
  SELECT `entry`.`id`, `entry`.`position` = `login`.`position` AS `tied`
  FROM `navigation_entries` AS `entry`, `login`
  WHERE `entry`.`location` = 'mobile' AND `entry`.`parent_id` IS NULL
    AND (`entry`.`position` > `login`.`position`
      OR (`entry`.`position` = `login`.`position` AND `entry`.`id` > `login`.`id`))
), `step` AS MATERIALIZED (
  SELECT 1 + COALESCE(MAX(`tied`), 0) AS `places` FROM `after`
)
UPDATE `navigation_entries`
SET `position` = `position` + (SELECT `places` FROM `step`)
WHERE `id` IN (SELECT `id` FROM `after`)
  AND NOT EXISTS (SELECT 1 FROM `navigation_entries` WHERE `builtin` = 'mobile.register');
--> statement-breakpoint
INSERT INTO `navigation_entries` (`location`, `parent_id`, `title`, `target`, `position`, `is_enabled`, `audience`, `builtin`, `created_at`, `updated_at`)
SELECT 'mobile', NULL, 'Create account', '/register',
  COALESCE(
    (SELECT `position` + 1 FROM `navigation_entries` WHERE `builtin` = 'mobile.login'),
    (SELECT COALESCE(MAX(`position`), -1) + 1 FROM `navigation_entries` WHERE `location` = 'mobile' AND `parent_id` IS NULL)
  ),
  1, 'guests', 'mobile.register', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM `navigation_entries` WHERE `builtin` = 'mobile.register');
