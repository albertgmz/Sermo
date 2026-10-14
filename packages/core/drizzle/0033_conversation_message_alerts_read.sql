-- New conversation messages no longer raise alerts (conversations have their own counter).
-- Unread alerts of that kind are marked read, not deleted. Only rows of the member's current
-- epoch count towards `unread_notification_count`, so only those lower it.
UPDATE `users` SET `unread_notification_count` = max(0, `unread_notification_count` - (
  SELECT count(*) FROM `notifications` n
  WHERE n.`user_id` = `users`.`id` AND n.`type` = 'conversation.message' AND n.`read_at` IS NULL AND n.`epoch` = `users`.`notification_epoch`
))
WHERE `id` IN (SELECT `user_id` FROM `notifications` WHERE `type` = 'conversation.message' AND `read_at` IS NULL);
--> statement-breakpoint
UPDATE `notifications` SET `read_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `type` = 'conversation.message' AND `read_at` IS NULL;
