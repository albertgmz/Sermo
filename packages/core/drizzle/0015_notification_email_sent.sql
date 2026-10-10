-- When the email for a notification was sent, so later merges into a grouped row do not email again.
ALTER TABLE notifications ADD COLUMN email_sent_at INTEGER;
