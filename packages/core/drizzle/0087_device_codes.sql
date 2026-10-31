ALTER TABLE `users` ADD `device_type_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_brand` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_brand_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_os_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_os_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_os_family` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_browser_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_browser_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `show_device` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- The device walk (`security.deviceBackfill`) ran before the codes were kept. Delete its record.
-- The next start walks the members again and fills the codes from the newest session or log row.
DELETE FROM `site_settings` WHERE `key` = 'security.deviceBackfill';
