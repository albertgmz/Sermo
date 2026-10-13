-- An inventory row records what the member paid, so a rank upgrade credits what was paid and not
-- the item's price of the day.
ALTER TABLE `shop_inventory` ADD `paid_price` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The lookups below are by item and recipient: without this index each inventory row would read every
-- purchase of its item (quadratic for an item many members hold). It exists only for this migration.
CREATE INDEX `shop_purchases_paid_price_tmp` ON `shop_purchases` (`item_id`,`recipient_id`,`id`);--> statement-breakpoint
-- Existing rows: the price of the newest purchase that gave the member the item (a gift counts for
-- its recipient); a row no purchase links takes the item's current price.
UPDATE `shop_inventory` SET `paid_price` = COALESCE(
  (SELECT p.`price` FROM `shop_purchases` p WHERE p.`item_id` = `shop_inventory`.`item_id` AND p.`recipient_id` = `shop_inventory`.`user_id` ORDER BY p.`id` DESC LIMIT 1),
  (SELECT i.`price` FROM `shop_items` i WHERE i.`id` = `shop_inventory`.`item_id`),
  0);--> statement-breakpoint
-- A consumable row adds up every purchase of it.
UPDATE `shop_inventory` SET `paid_price` = COALESCE(
  (SELECT SUM(p.`price`) FROM `shop_purchases` p WHERE p.`item_id` = `shop_inventory`.`item_id` AND p.`recipient_id` = `shop_inventory`.`user_id`),
  `paid_price`)
WHERE `item_id` IN (SELECT `id` FROM `shop_items` WHERE `is_consumable` = 1);--> statement-breakpoint
DROP INDEX `shop_purchases_paid_price_tmp`;--> statement-breakpoint
-- A username change is spent in units, so it can only be sold as a consumable: take the others off sale.
UPDATE `shop_items` SET `is_active` = 0 WHERE `is_consumable` = 0 AND json_extract(`effect`, '$.type') = 'usernameChange';
