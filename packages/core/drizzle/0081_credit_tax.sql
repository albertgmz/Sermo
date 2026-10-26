CREATE TABLE `credit_tax_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`month` integer NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`fee` integer NOT NULL,
	`minimum` integer NOT NULL,
	`step` integer NOT NULL,
	`started_by` integer,
	`last_user_id` integer DEFAULT 0 NOT NULL,
	`through` integer DEFAULT 0 NOT NULL,
	`members` integer DEFAULT 0 NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`top` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_tax_runs_month` ON `credit_tax_runs` (`kind`,`month`) WHERE kind != 'preview';--> statement-breakpoint
CREATE INDEX `credit_tax_runs_kind` ON `credit_tax_runs` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_transactions_tax_month` ON `credit_transactions` (`user_id`,`source_id`) WHERE source_type = 'tax';