-- A push subscription is linked to the session that saved it and goes with it. Rows saved before
-- this keep a null session: they work until their push service refuses them.
ALTER TABLE `push_subscriptions` ADD `session_id` integer REFERENCES auth_session(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `push_subscriptions_session` ON `push_subscriptions` (`session_id`) WHERE session_id IS NOT NULL;
