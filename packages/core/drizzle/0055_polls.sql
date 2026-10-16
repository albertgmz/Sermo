CREATE TABLE `poll_answers` (
	`id` integer PRIMARY KEY NOT NULL,
	`poll_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`image_file_id` integer,
	`is_correct` integer DEFAULT false NOT NULL,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`added_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `poll_answers_poll` ON `poll_answers` (`poll_id`,`question_id`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `poll_ballots` (
	`id` integer PRIMARY KEY NOT NULL,
	`poll_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`answered` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_ballots_member` ON `poll_ballots` (`poll_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `poll_questions` (
	`id` integer PRIMARY KEY NOT NULL,
	`poll_id` integer NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`image_file_id` integer,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `poll_questions_poll` ON `poll_questions` (`poll_id`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`id` integer PRIMARY KEY NOT NULL,
	`poll_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`answer_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answer_id`) REFERENCES `poll_answers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_votes_answer_member` ON `poll_votes` (`answer_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `poll_votes_member` ON `poll_votes` (`poll_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text DEFAULT 'poll' NOT NULL,
	`anonymous` integer DEFAULT false NOT NULL,
	`max_choices` integer DEFAULT 1 NOT NULL,
	`allow_custom` integer DEFAULT false NOT NULL,
	`allow_change` integer DEFAULT true NOT NULL,
	`results` text DEFAULT 'always' NOT NULL,
	`closes_at` integer,
	`closed_at` integer,
	`ballot_count` integer DEFAULT 0 NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `polls_thread` ON `polls` (`thread_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `poll_vote_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `poll_votes_added` AFTER INSERT ON `poll_votes` BEGIN
  UPDATE poll_answers SET vote_count = vote_count + 1 WHERE id = new.answer_id;
END;
--> statement-breakpoint
CREATE TRIGGER `poll_votes_removed` AFTER DELETE ON `poll_votes` BEGIN
  UPDATE poll_answers SET vote_count = vote_count - 1 WHERE id = old.answer_id;
END;
--> statement-breakpoint
CREATE TRIGGER `poll_ballots_added` AFTER INSERT ON `poll_ballots` BEGIN
  UPDATE polls SET ballot_count = ballot_count + 1 WHERE id = new.poll_id;
  UPDATE users SET poll_vote_count = poll_vote_count + 1 WHERE id = new.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER `poll_ballots_removed` AFTER DELETE ON `poll_ballots` BEGIN
  UPDATE polls SET ballot_count = ballot_count - 1 WHERE id = old.poll_id;
  UPDATE users SET poll_vote_count = poll_vote_count - 1 WHERE id = old.user_id;
END;
--> statement-breakpoint
DROP TRIGGER `post_bodies_search_update`;
--> statement-breakpoint
DROP TRIGGER `threads_search_title`;
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
    COALESCE(new.body_text, new.body_source) || COALESCE(
      (SELECT char(10) || pl.search_text FROM posts p JOIN threads t ON t.id = p.thread_id AND t.first_post_id = p.id
        JOIN polls pl ON pl.thread_id = t.id WHERE p.id = new.post_id AND pl.search_text != ''),
      ''
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER `threads_search_title` AFTER UPDATE OF title ON `threads`
WHEN new.first_post_id IS NOT NULL BEGIN
  DELETE FROM search_fts WHERE rowid = new.first_post_id;
  INSERT INTO search_fts (rowid, title, body)
    SELECT b.post_id, new.title, COALESCE(b.body_text, b.body_source) || COALESCE(
      (SELECT char(10) || pl.search_text FROM polls pl WHERE pl.thread_id = new.id AND pl.search_text != ''), '')
    FROM post_bodies b WHERE b.post_id = new.first_post_id;
END;
--> statement-breakpoint
CREATE TRIGGER `polls_search_added` AFTER INSERT ON `polls` WHEN new.search_text != '' BEGIN
  DELETE FROM search_fts WHERE rowid = (SELECT first_post_id FROM threads WHERE id = new.thread_id);
  INSERT INTO search_fts (rowid, title, body)
    SELECT b.post_id, t.title, COALESCE(b.body_text, b.body_source) || char(10) || new.search_text
    FROM threads t JOIN post_bodies b ON b.post_id = t.first_post_id WHERE t.id = new.thread_id;
END;
--> statement-breakpoint
CREATE TRIGGER `polls_search_changed` AFTER UPDATE OF search_text, thread_id ON `polls` BEGIN
  DELETE FROM search_fts WHERE rowid IN (SELECT first_post_id FROM threads WHERE id IN (old.thread_id, new.thread_id));
  INSERT INTO search_fts (rowid, title, body)
    SELECT b.post_id, t.title, COALESCE(b.body_text, b.body_source)
      || CASE WHEN t.id = new.thread_id AND new.search_text != '' THEN char(10) || new.search_text ELSE '' END
    FROM threads t JOIN post_bodies b ON b.post_id = t.first_post_id WHERE t.id IN (old.thread_id, new.thread_id);
END;
--> statement-breakpoint
CREATE TRIGGER `polls_search_removed` AFTER DELETE ON `polls` WHEN old.search_text != '' BEGIN
  DELETE FROM search_fts WHERE rowid = (SELECT first_post_id FROM threads WHERE id = old.thread_id);
  INSERT INTO search_fts (rowid, title, body)
    SELECT b.post_id, t.title, COALESCE(b.body_text, b.body_source)
    FROM threads t JOIN post_bodies b ON b.post_id = t.first_post_id WHERE t.id = old.thread_id;
END;
