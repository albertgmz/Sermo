-- Marking every notification read is constant time: it bumps the member's epoch. Unread rows of
-- older epochs count as read and are marked read in the background.
ALTER TABLE users ADD COLUMN notification_epoch INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP INDEX notifications_user_group;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_user_group ON notifications(user_id, epoch, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX notifications_user_unread_recent ON notifications(user_id, epoch, updated_at, id) WHERE read_at IS NULL;
--> statement-breakpoint
-- Recipient keysets: quoted authors of one item, earlier commenters of one profile post.
CREATE INDEX content_quotes_content_user ON content_quotes(content_type, content_id, quoted_user_id);
--> statement-breakpoint
CREATE INDEX profile_post_comments_post_user ON profile_post_comments(profile_post_id, user_id);
