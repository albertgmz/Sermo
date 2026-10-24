ALTER TABLE `posts` ADD `guest_name` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `guest_name` text;--> statement-breakpoint
-- The reserved account guest content belongs to (GUEST_ACCOUNT_ID, -2): outside the ids Better
-- Auth hands out, so no request can name it. It has no credential account (no password) and an
-- address on a reserved domain, so it can never sign in; its name starts with a space, which no
-- registered or imported name can, so it takes no member's name. It sits in the Guest group, keeps
-- its profile to itself, is never shown online and watches nothing.
INSERT INTO `auth_user` (`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`, `username`, `display_username`) VALUES (-2, 'Guest', 'guest-account@sermo.invalid', 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER), ' guest', 'Guest');--> statement-breakpoint
INSERT INTO `users` (`id`, `username`, `username_key`, `group_id`, `created_at`, `show_online`, `profile_view_privacy`, `profile_post_privacy`, `watch_on_create`, `watch_on_reply`) VALUES (-2, 'Guest', ' guest', 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), 0, 'self', 'self', 'none', 'none');
