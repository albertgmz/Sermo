CREATE TABLE `consent_records` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`categories` text NOT NULL,
	`policy_version` integer NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
