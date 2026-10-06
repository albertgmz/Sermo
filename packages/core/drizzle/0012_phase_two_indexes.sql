-- Phase two indexes: thread merges and splits find a thread's readers and notifications.
CREATE INDEX thread_reads_thread ON thread_reads(thread_id, user_id);
--> statement-breakpoint
CREATE INDEX notifications_thread ON notifications(thread_id, id) WHERE thread_id IS NOT NULL;
--> statement-breakpoint
-- Newest-first follower, following and ignored lists.
CREATE INDEX user_follows_followed_recent ON user_follows(followed_id, id);
--> statement-breakpoint
CREATE INDEX user_follows_follower_recent ON user_follows(user_id, id);
--> statement-breakpoint
CREATE INDEX user_ignores_user_recent ON user_ignores(user_id, id);
