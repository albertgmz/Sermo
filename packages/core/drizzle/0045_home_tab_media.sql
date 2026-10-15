ALTER TABLE `users` ADD `home_tab` text;--> statement-breakpoint
CREATE INDEX `attachments_type_id` ON `attachments` (`content_type`,`id`);