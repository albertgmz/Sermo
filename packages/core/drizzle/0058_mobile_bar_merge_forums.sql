-- The bottom bar of a phone drops its Forums entry: Home leads to the forums list there (a Forums
-- tab on the home page), so the bar holds Home, Messages, Alerts and Profile (a guest: Home and
-- Log in) around the + button. Anything an administrator put under the entry goes with it.
DELETE FROM `navigation_entries`
WHERE `parent_id` = (SELECT `id` FROM `navigation_entries` WHERE `builtin` = 'mobile.forums');
--> statement-breakpoint
DELETE FROM `navigation_entries` WHERE `builtin` = 'mobile.forums';
