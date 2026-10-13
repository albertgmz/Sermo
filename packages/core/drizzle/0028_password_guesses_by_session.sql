ALTER TABLE `admin_password_failures` ADD `session_id` integer;--> statement-breakpoint
CREATE INDEX `admin_password_failures_session` ON `admin_password_failures` (`user_id`,`session_id`,`at`);