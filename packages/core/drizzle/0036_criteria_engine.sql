ALTER TABLE `awards` ADD `rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `notices` ADD `rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `promotions` ADD `rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `shop_categories` ADD `rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `shop_items` ADD `rule` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL;--> statement-breakpoint
-- Promotions and awards: the old list of conditions, all of which must hold, becomes the rule.
UPDATE `promotions` SET `rule` = json_object('match', 'all', 'conditions', json(`criteria`));--> statement-breakpoint
UPDATE `awards` SET `rule` = json_object('match', 'all', 'conditions', json(`criteria`));--> statement-breakpoint
-- Notices: everyone is the empty rule, guests `is_guest`, members NOT a guest (`is_guest` 0), a
-- group `in_group`. A group notice with no group was shown to nobody: it is switched off.
UPDATE `notices` SET `rule` = CASE `audience`
  WHEN 'guests' THEN '{"match":"all","conditions":[{"criterion":"is_guest","value":1}]}'
  WHEN 'members' THEN '{"match":"all","conditions":[{"criterion":"is_guest","value":0}]}'
  WHEN 'group' THEN CASE WHEN `audience_group_id` IS NULL THEN `rule` ELSE
    json_object('match', 'all', 'conditions', json_array(json_object('criterion', 'in_group', 'ids', json_array(`audience_group_id`)))) END
  ELSE `rule` END,
  `active` = CASE WHEN `audience` = 'group' AND `audience_group_id` IS NULL THEN 0 ELSE `active` END;--> statement-breakpoint
ALTER TABLE `awards` DROP COLUMN `criteria`;--> statement-breakpoint
ALTER TABLE `notices` DROP COLUMN `audience`;--> statement-breakpoint
ALTER TABLE `notices` DROP COLUMN `audience_group_id`;--> statement-breakpoint
ALTER TABLE `promotions` DROP COLUMN `criteria`;
