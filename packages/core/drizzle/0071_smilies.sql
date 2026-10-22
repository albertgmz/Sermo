CREATE TABLE `smilies` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`codes` text NOT NULL,
	`emoji` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- fcuba.net's smilies (XenForo's xf_smilie, ids and order kept), each drawn as the emoji XenForo
-- showed for it; `:like:` is added to Thumbs up. Bodies are not touched: codes are replaced where
-- the text is shown.
INSERT INTO `smilies` (`id`, `title`, `codes`, `emoji`, `position`) VALUES
  (4, 'Mad', '[":mad:",">:(",":@"]', '😡', 40),
  (5, 'Confused', '[":confused:"]', '😕', 50),
  (6, 'Cool', '[":cool:","8-)"]', '😎', 60),
  (9, 'Eek!', '[":eek:"]', '😱', 90),
  (10, 'Oops!', '[":oops:"]', '😳', 100),
  (11, 'Roll eyes', '[":rolleyes:"]', '🙄', 110),
  (13, 'Cautious', '[":cautious:"]', '😒', 130),
  (14, 'Censored', '[":censored:"]', '🤐', 140),
  (15, 'Crying', '[":cry:"]', '😢', 150),
  (16, 'Love', '[":love:"]', '😍', 160),
  (17, 'Laugh', '[":LOL:"]', '😆', 170),
  (18, 'ROFL', '[":ROFLMAO:"]', '🤣', 180),
  (19, 'Sick', '[":sick:"]', '🤢', 190),
  (20, 'Sleep', '[":sleep:"]', '😴', 200),
  (21, 'Sneaky', '[":sneaky:"]', '😏', 210),
  (22, 'Thumbs up', '["(y)",":like:"]', '👍️', 220),
  (23, 'Thumbs down', '["(n)"]', '👎️', 230),
  (24, 'Unsure', '[":unsure:"]', '🤔', 240),
  (25, 'Whistling', '[":whistle:"]', '😗', 250),
  (26, 'Coffee', '[":coffee:"]', '☕️', 260),
  (27, 'Giggle', '[":giggle:"]', '😊', 270),
  (28, 'Alien', '[":alien:"]', '👽️', 280),
  (29, 'Devil', '[":devilish:"]', '😈', 290),
  (30, 'Geek', '[":geek:"]', '🤓', 300),
  (31, 'Poop', '[":poop:"]', '💩', 310),
  (32, 'Ninja', '[":ninja:"]', '🥷', 320);
