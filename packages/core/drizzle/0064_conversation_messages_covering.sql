DROP INDEX `conversation_messages_conv`;--> statement-breakpoint
CREATE INDEX `conversation_messages_conv` ON `conversation_messages` (`conversation_id`,`id`,`state`,`user_id`);