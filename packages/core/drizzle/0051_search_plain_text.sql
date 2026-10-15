ALTER TABLE `post_bodies` ADD `body_text` text;
--> statement-breakpoint
DROP TRIGGER `post_bodies_search_insert`;
--> statement-breakpoint
DROP TRIGGER `post_bodies_search_update`;
--> statement-breakpoint
DROP TRIGGER `threads_search_title`;
--> statement-breakpoint
CREATE TRIGGER `post_bodies_search_insert` AFTER INSERT ON `post_bodies` BEGIN
  INSERT INTO search_fts (rowid, title, body) VALUES (
    new.post_id,
    COALESCE(
      (SELECT t.title FROM posts p JOIN threads t ON t.id = p.thread_id
        WHERE p.id = new.post_id AND t.first_post_id IS NULL),
      ''
    ),
    COALESCE(new.body_text, new.body_source)
  );
END;
--> statement-breakpoint
CREATE TRIGGER `post_bodies_search_update` AFTER UPDATE OF body_source, body_text ON `post_bodies` BEGIN
  DELETE FROM search_fts WHERE rowid = old.post_id;
  INSERT INTO search_fts (rowid, title, body) VALUES (
    new.post_id,
    COALESCE(
      (SELECT t.title FROM posts p JOIN threads t ON t.id = p.thread_id
        WHERE p.id = new.post_id AND t.first_post_id = new.post_id),
      ''
    ),
    COALESCE(new.body_text, new.body_source)
  );
END;
--> statement-breakpoint
CREATE TRIGGER `threads_search_title` AFTER UPDATE OF title ON `threads`
WHEN new.first_post_id IS NOT NULL BEGIN
  DELETE FROM search_fts WHERE rowid = new.first_post_id;
  INSERT INTO search_fts (rowid, title, body)
    SELECT post_id, new.title, COALESCE(body_text, body_source) FROM post_bodies WHERE post_id = new.first_post_id;
END;
