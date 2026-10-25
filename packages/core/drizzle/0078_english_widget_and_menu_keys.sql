-- The feed page is What's new (`/whats-new`) and its names in the data are English: the two
-- widget positions of the page, the keys of the built-in menu entries that lead to it, and the
-- address those entries (and any entry an administrator pointed at the feed) carry. Rows are
-- renamed in place; the old address `/novedades` still redirects, so a link kept elsewhere
-- (a post, a page) keeps working.
UPDATE `widgets` SET `position` = 'whats_new_above' WHERE `position` = 'novedades_above';
--> statement-breakpoint
UPDATE `widgets` SET `position` = 'whats_new_sidebar' WHERE `position` = 'novedades_sidebar';
--> statement-breakpoint
UPDATE `navigation_entries` SET `builtin` = 'header.whats_new' WHERE `builtin` = 'header.novedades';
--> statement-breakpoint
UPDATE `navigation_entries` SET `builtin` = 'mobile.whats_new' WHERE `builtin` = 'mobile.novedades';
--> statement-breakpoint
UPDATE `navigation_entries`
SET `target` = '/whats-new' || substr(`target`, 11)
WHERE `target` = '/novedades'
  OR `target` LIKE '/novedades?%'
  OR `target` LIKE '/novedades#%'
  OR `target` LIKE '/novedades/%';
