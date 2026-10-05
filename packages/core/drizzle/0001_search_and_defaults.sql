-- Full-text search over post bodies, with each thread's title indexed on its first post.
-- Contentless with delete support: rowid = posts.id. Kept in sync by triggers on post_bodies
-- (bodies) and threads (titles).
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  title,
  body,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `post_bodies_search_insert` AFTER INSERT ON `post_bodies` BEGIN
  INSERT INTO search_fts (rowid, title, body) VALUES (
    new.post_id,
    COALESCE(
      (SELECT t.title FROM posts p JOIN threads t ON t.id = p.thread_id
        WHERE p.id = new.post_id AND t.first_post_id IS NULL),
      ''
    ),
    new.body_source
  );
END;
--> statement-breakpoint
CREATE TRIGGER `post_bodies_search_update` AFTER UPDATE OF body_source ON `post_bodies` BEGIN
  DELETE FROM search_fts WHERE rowid = old.post_id;
  INSERT INTO search_fts (rowid, title, body) VALUES (
    new.post_id,
    COALESCE(
      (SELECT t.title FROM posts p JOIN threads t ON t.id = p.thread_id
        WHERE p.id = new.post_id AND t.first_post_id = new.post_id),
      ''
    ),
    new.body_source
  );
END;
--> statement-breakpoint
CREATE TRIGGER `post_bodies_search_delete` AFTER DELETE ON `post_bodies` BEGIN
  DELETE FROM search_fts WHERE rowid = old.post_id;
END;
--> statement-breakpoint
CREATE TRIGGER `threads_search_title` AFTER UPDATE OF title ON `threads`
WHEN new.first_post_id IS NOT NULL BEGIN
  DELETE FROM search_fts WHERE rowid = new.first_post_id;
  INSERT INTO search_fts (rowid, title, body)
    SELECT post_id, new.title, body_source FROM post_bodies WHERE post_id = new.first_post_id;
END;
--> statement-breakpoint
INSERT INTO `groups` (id, title, is_admin, is_moderator, can_view_nodes, can_post, can_view_profiles, can_post_profile, can_start_conversations, can_react) VALUES
  (1, 'Guest',         0, 0, 1, 0, 1, 0, 0, 0),
  (2, 'Member',        0, 0, 1, 1, 1, 1, 1, 1),
  (3, 'Moderator',     0, 1, 1, 1, 1, 1, 1, 1),
  (4, 'Administrator', 1, 1, 1, 1, 1, 1, 1, 1);
--> statement-breakpoint
INSERT INTO `reaction_types` (id, title, emoji, score, position, is_active) VALUES
  (1, 'Like',  '👍', 1, 10, 1),
  (2, 'Love',  '❤️', 1, 20, 1),
  (3, 'Haha',  '😂', 1, 30, 1),
  (4, 'Wow',   '😮', 1, 40, 1),
  (5, 'Sad',   '😢', 0, 50, 1),
  (6, 'Angry', '😠', 0, 60, 1);
--> statement-breakpoint
INSERT INTO `cache_versions` (key, version) VALUES ('node_tree', 0), ('permissions', 0), ('reaction_types', 0);
