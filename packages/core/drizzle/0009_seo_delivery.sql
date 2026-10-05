ALTER TABLE nodes ADD COLUMN content_updated_at INTEGER;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN content_updated_at INTEGER;
--> statement-breakpoint
UPDATE users SET content_updated_at = created_at;
--> statement-breakpoint

CREATE TABLE indexnow_pending (
  event_id INTEGER PRIMARY KEY REFERENCES domain_events(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX threads_public_feed ON threads(state, last_post_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX threads_node_feed ON threads(node_id, state, last_post_at DESC, id DESC);
