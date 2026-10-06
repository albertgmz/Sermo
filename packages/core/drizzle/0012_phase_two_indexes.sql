-- Phase two indexes: thread merges and splits find a thread's readers and notifications.
CREATE INDEX thread_reads_thread ON thread_reads(thread_id, user_id);
--> statement-breakpoint
CREATE INDEX notifications_thread ON notifications(thread_id, id) WHERE thread_id IS NOT NULL;
