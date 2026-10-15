CREATE TABLE `tag_aliases` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_aliases_name` ON `tag_aliases` (`name`);--> statement-breakpoint
CREATE INDEX `tag_aliases_tag` ON `tag_aliases` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`thread_count` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `thread_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`added_by` integer,
	`from_post` integer DEFAULT false NOT NULL,
	`sort_at` integer NOT NULL,
	`vis` integer DEFAULT 1 NOT NULL,
	`node_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_tags_thread_tag` ON `thread_tags` (`thread_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `thread_tags_hub` ON `thread_tags` (`tag_id`,`vis`,`sort_at`,`thread_id`);--> statement-breakpoint
CREATE INDEX `thread_tags_author` ON `thread_tags` (`tag_id`,`author_id`,`vis`,`sort_at`,`thread_id`);--> statement-breakpoint
CREATE INDEX `thread_tags_node` ON `thread_tags` (`tag_id`,`vis`,`node_id`,`from_post`);--> statement-breakpoint
ALTER TABLE `users` ADD `tag_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `thread_tags_added` AFTER INSERT ON `thread_tags` BEGIN
  UPDATE tags SET thread_count = thread_count + 1 WHERE id = new.tag_id;
  UPDATE users SET tag_count = tag_count + 1 WHERE id = new.added_by AND new.vis = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_tags_removed` AFTER DELETE ON `thread_tags` BEGIN
  UPDATE tags SET thread_count = thread_count - 1 WHERE id = old.tag_id;
  UPDATE users SET tag_count = tag_count - 1 WHERE id = old.added_by AND old.vis = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_tags_sort` AFTER UPDATE OF last_post_at, bumped_at ON `threads`
WHEN max(coalesce(old.last_post_at, 0), coalesce(old.bumped_at, 0)) IS NOT max(coalesce(new.last_post_at, 0), coalesce(new.bumped_at, 0)) BEGIN
  UPDATE thread_tags SET sort_at = max(coalesce(new.last_post_at, 0), coalesce(new.bumped_at, 0)) WHERE thread_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_tags_vis` AFTER UPDATE OF state, merged_into_id ON `threads`
WHEN (CASE WHEN old.merged_into_id IS NOT NULL THEN 3 WHEN old.state = 'visible' THEN 1 WHEN old.state = 'moderated' THEN 2 ELSE 3 END) IS NOT (CASE WHEN new.merged_into_id IS NOT NULL THEN 3 WHEN new.state = 'visible' THEN 1 WHEN new.state = 'moderated' THEN 2 ELSE 3 END) BEGIN
  UPDATE users SET tag_count = tag_count + (SELECT count(*) FROM thread_tags tt WHERE tt.thread_id = new.id AND tt.added_by = users.id) * ((CASE WHEN new.merged_into_id IS NOT NULL THEN 3 WHEN new.state = 'visible' THEN 1 WHEN new.state = 'moderated' THEN 2 ELSE 3 END) = 1) - (SELECT count(*) FROM thread_tags tt WHERE tt.thread_id = new.id AND tt.added_by = users.id) * ((CASE WHEN old.merged_into_id IS NOT NULL THEN 3 WHEN old.state = 'visible' THEN 1 WHEN old.state = 'moderated' THEN 2 ELSE 3 END) = 1)
    WHERE id IN (SELECT added_by FROM thread_tags WHERE thread_id = new.id AND added_by IS NOT NULL);
  UPDATE thread_tags SET vis = CASE WHEN new.merged_into_id IS NOT NULL THEN 3 WHEN new.state = 'visible' THEN 1 WHEN new.state = 'moderated' THEN 2 ELSE 3 END WHERE thread_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_tags_move` AFTER UPDATE OF node_id ON `threads` WHEN old.node_id IS NOT new.node_id BEGIN
  UPDATE thread_tags SET node_id = new.node_id WHERE thread_id = new.id;
END;
