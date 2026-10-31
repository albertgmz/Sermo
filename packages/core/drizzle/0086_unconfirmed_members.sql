-- A site that asks no email confirmation (`requireEmailConfirmation` stored as false) has no use
-- for the Unconfirmed group (5). Its members move to Member (2), except a member who still has to
-- choose a username (that choice moves them) and an erased account. A trigger on `users.group_id`
-- keeps each member's permission combination in step. A missing setting means true: nothing
-- changes then. No mail is sent.
UPDATE `users`
SET `group_id` = 2
WHERE `group_id` = 5
  AND `needs_username` = 0
  AND `erased_at` IS NULL
  AND EXISTS (
    SELECT 1 FROM `site_settings`
    WHERE `key` = 'configuration'
      AND json_valid(`value`)
      AND json_type(`value`, '$.requireEmailConfirmation') = 'false'
  );
