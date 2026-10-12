CREATE TABLE `navigation_entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`parent_id` integer,
	`title` text NOT NULL,
	`target` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`audience` text DEFAULT 'everyone' NOT NULL,
	`permission` text,
	`builtin` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `navigation_entries_order` ON `navigation_entries` (`location`,`parent_id`,`position`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `navigation_entries_builtin` ON `navigation_entries` (`builtin`) WHERE builtin IS NOT NULL;--> statement-breakpoint
CREATE TABLE `static_pages` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body_source` text NOT NULL,
	`body_html` text NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `static_pages_slug` ON `static_pages` (`slug`);
--> statement-breakpoint
INSERT INTO `navigation_entries` (`location`, `parent_id`, `title`, `target`, `position`, `is_enabled`, `audience`, `builtin`, `created_at`, `updated_at`) VALUES
  ('header', NULL, 'Home', '/', 0, 1, 'everyone', 'header.home', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('header', NULL, 'Forums', '/forums', 1, 1, 'everyone', 'header.forums', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('header', NULL, 'Members', '/members', 2, 1, 'everyone', 'header.members', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('header', NULL, 'Upgrade', '/upgrade', 3, 1, 'everyone', 'header.upgrade', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('header', NULL, 'Awards', '/awards', 4, 1, 'everyone', 'header.awards', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('header', NULL, 'Credits', '/credits', 5, 1, 'everyone', 'header.credits', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('mobile', NULL, 'Home', '/', 0, 1, 'everyone', 'mobile.home', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('mobile', NULL, 'Forums', '/forums', 1, 1, 'everyone', 'mobile.forums', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('mobile', NULL, 'Messages', '/conversations', 2, 1, 'members', 'mobile.messages', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('mobile', NULL, 'Alerts', '/notifications', 3, 1, 'members', 'mobile.alerts', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('mobile', NULL, 'Profile', '/account', 4, 1, 'members', 'mobile.profile', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('mobile', NULL, 'Log in', '/login', 5, 1, 'guests', 'mobile.login', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('account', NULL, 'Profile', '/account', 0, 1, 'members', 'account.profile', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('account', NULL, 'Account', '/account', 1, 1, 'members', 'account.settings', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('footer', NULL, 'Community', NULL, 0, 1, 'everyone', 'footer.community', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('footer', NULL, 'Useful', NULL, 1, 1, 'everyone', 'footer.useful', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('footer', NULL, 'Legal', NULL, 2, 1, 'everyone', 'footer.legal', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER));
--> statement-breakpoint
WITH child(parent, title, target, position, builtin) AS (VALUES
  ('footer.community', 'Forums', '/forums', 0, 'footer.community.forums'),
  ('footer.community', 'Members', '/members', 1, 'footer.community.members'),
  ('footer.community', 'Awards', '/awards', 2, 'footer.community.awards'),
  ('footer.useful', 'Credits', '/credits', 0, 'footer.useful.credits'),
  ('footer.useful', 'Upgrade', '/upgrade', 1, 'footer.useful.upgrade'),
  ('footer.legal', 'Terms', '/terms', 0, 'footer.legal.terms'),
  ('footer.legal', 'Privacy', '/privacy', 1, 'footer.legal.privacy'),
  ('footer.legal', 'Legal notice', '/legal', 2, 'footer.legal.notice'),
  ('footer.legal', 'Contact', '/contact', 3, 'footer.legal.contact')
)
INSERT INTO `navigation_entries` (`location`, `parent_id`, `title`, `target`, `position`, `is_enabled`, `audience`, `builtin`, `created_at`, `updated_at`)
SELECT 'footer', (SELECT id FROM navigation_entries WHERE builtin = child.parent), child.title, child.target, child.position, 1, 'everyone', child.builtin, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM child;
