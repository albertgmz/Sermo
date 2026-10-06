-- Threads with a merge or split transfer in progress (or failed and awaiting a retry). Replies and
-- reorganization check this with one primary-key lookup.
CREATE TABLE thread_transfers (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  -- 'merge_target' | 'merge_source' | 'split_source' | 'split_target'
  role TEXT NOT NULL,
  -- The thread at the other end of the transfer.
  other_thread_id INTEGER NOT NULL,
  job_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failed_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX thread_transfers_thread ON thread_transfers(thread_id);
