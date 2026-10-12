-- Shop effects name catalog entries by id. Items stored with the old shapes are converted here.
-- A name colour reuses the `name` palette entry of the same colour (case-insensitive), or gets one.
INSERT INTO `palette_colors` (`kind`, `name`, `color`, `foreground`, `position`, `is_active`, `created_at`, `updated_at`)
SELECT 'name', c.color, c.color, NULL, b.base + c.n, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM (
  SELECT lower(json_extract(`effect`, '$.color')) AS color, ROW_NUMBER() OVER (ORDER BY MIN(`id`)) AS n
  FROM `shop_items`
  WHERE json_extract(`effect`, '$.type') = 'nameColor' AND json_extract(`effect`, '$.color') IS NOT NULL
  GROUP BY lower(json_extract(`effect`, '$.color'))
  HAVING NOT EXISTS (SELECT 1 FROM `palette_colors` p WHERE p.`kind` = 'name' AND lower(p.`color`) = lower(json_extract(`effect`, '$.color')))
) c,
(SELECT COALESCE(MAX(`position`), -1) AS base FROM `palette_colors` WHERE `kind` = 'name') b;--> statement-breakpoint
-- An item cannot be sold while its entry is inactive.
UPDATE `shop_items` SET `is_active` = 0
WHERE json_extract(`effect`, '$.type') = 'nameColor' AND json_extract(`effect`, '$.color') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `palette_colors` p WHERE p.`kind` = 'name' AND p.`is_active` = 1 AND lower(p.`color`) = lower(json_extract(`shop_items`.`effect`, '$.color')));--> statement-breakpoint
UPDATE `shop_items` SET `effect` = json_object('type', 'nameColor', 'colorId', (
  SELECT p.`id` FROM `palette_colors` p
  WHERE p.`kind` = 'name' AND lower(p.`color`) = lower(json_extract(`shop_items`.`effect`, '$.color'))
  ORDER BY p.`is_active` DESC, p.`id` LIMIT 1))
WHERE json_extract(`effect`, '$.type') = 'nameColor' AND json_extract(`effect`, '$.color') IS NOT NULL;--> statement-breakpoint
-- No picture stands behind a frame or cover key: each distinct key becomes an inactive entry without
-- a file, and the items that sell it are deactivated until an administrator gives the entry a picture.
INSERT INTO `catalog_images` (`kind`, `name`, `file_id`, `position`, `is_active`, `created_at`, `updated_at`)
SELECT 'frame', k.key, NULL, b.base + k.n, 0, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM (
  SELECT json_extract(`effect`, '$.frame') AS key, ROW_NUMBER() OVER (ORDER BY MIN(`id`)) AS n
  FROM `shop_items`
  WHERE json_extract(`effect`, '$.type') = 'frame' AND json_extract(`effect`, '$.frame') IS NOT NULL
  GROUP BY json_extract(`effect`, '$.frame')
) k,
(SELECT COALESCE(MAX(`position`), -1) AS base FROM `catalog_images` WHERE `kind` = 'frame') b;--> statement-breakpoint
UPDATE `shop_items` SET `is_active` = 0, `effect` = json_object('type', 'frame', 'frameId', (
  SELECT i.`id` FROM `catalog_images` i
  WHERE i.`kind` = 'frame' AND i.`file_id` IS NULL AND i.`name` = json_extract(`shop_items`.`effect`, '$.frame')
  ORDER BY i.`id` DESC LIMIT 1))
WHERE json_extract(`effect`, '$.type') = 'frame' AND json_extract(`effect`, '$.frame') IS NOT NULL;--> statement-breakpoint
INSERT INTO `catalog_images` (`kind`, `name`, `file_id`, `position`, `is_active`, `created_at`, `updated_at`)
SELECT 'thread_cover', k.key, NULL, b.base + k.n, 0, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM (
  SELECT json_extract(`effect`, '$.cover') AS key, ROW_NUMBER() OVER (ORDER BY MIN(`id`)) AS n
  FROM `shop_items`
  WHERE json_extract(`effect`, '$.type') = 'threadCover' AND json_extract(`effect`, '$.cover') IS NOT NULL
  GROUP BY json_extract(`effect`, '$.cover')
) k,
(SELECT COALESCE(MAX(`position`), -1) AS base FROM `catalog_images` WHERE `kind` = 'thread_cover') b;--> statement-breakpoint
UPDATE `shop_items` SET `is_active` = 0, `effect` = json_object('type', 'threadCover', 'coverId', (
  SELECT i.`id` FROM `catalog_images` i
  WHERE i.`kind` = 'thread_cover' AND i.`file_id` IS NULL AND i.`name` = json_extract(`shop_items`.`effect`, '$.cover')
  ORDER BY i.`id` DESC LIMIT 1))
WHERE json_extract(`effect`, '$.type') = 'threadCover' AND json_extract(`effect`, '$.cover') IS NOT NULL;
