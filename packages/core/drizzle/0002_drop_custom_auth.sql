DROP TABLE `api_tokens`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
DROP INDEX `users_email`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `password_hash`;