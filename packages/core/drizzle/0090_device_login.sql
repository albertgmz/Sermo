CREATE TABLE `auth_device_code` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_device_code_deviceCode_uidx` ON `auth_device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_device_code_userCode_uidx` ON `auth_device_code` (`user_code`);--> statement-breakpoint
ALTER TABLE `auth_session` ADD `terminal_client` text;