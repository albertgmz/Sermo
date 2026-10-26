-- Group messages hidden from one participant by a block between that participant and the author.
CREATE TABLE `conversation_message_hides` (
	`id` integer PRIMARY KEY NOT NULL,
	`message_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `conversation_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_hides_message_user` ON `conversation_message_hides` (`message_id`,`user_id`);--> statement-breakpoint
-- Block replaces ignore. Every ignore becomes a block with its id and date. A converted block
-- hides no conversation: only a block made from now on hides the private conversations of the
-- two members, and only messages sent from now on are hidden in a group conversation.
CREATE TABLE `user_blocks` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`blocked_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `user_blocks` (`id`, `user_id`, `blocked_id`, `created_at`) SELECT `id`, `user_id`, `ignored_id`, `created_at` FROM `user_ignores`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_blocks_pair` ON `user_blocks` (`user_id`,`blocked_id`);--> statement-breakpoint
CREATE INDEX `user_blocks_blocked` ON `user_blocks` (`blocked_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `user_blocks_user_recent` ON `user_blocks` (`user_id`,`id`);--> statement-breakpoint
DROP TABLE `user_ignores`;--> statement-breakpoint
-- The permission to ignore becomes the permission to block, with every value an administrator
-- set. `member.ignorable` leaves the registry (staff can be blocked); its stored rows stay
-- unread, as for any key the registry no longer declares.
UPDATE `permission_definitions` SET `key` = 'member.block' WHERE `key` = 'member.ignore';--> statement-breakpoint
-- When a block hid a private conversation from both members (the purge removes it 90 days later).
ALTER TABLE `conversations` ADD `hidden_at` integer;--> statement-breakpoint
CREATE INDEX `conversations_hidden` ON `conversations` (`hidden_at`) WHERE hidden_at IS NOT NULL;