-- auth_apikey.reference_id holds the owner's user id as TEXT (the API key plugin compares it with
-- string ids), so it cannot carry a foreign key. Delete a user's keys when the user is deleted.
CREATE TRIGGER `auth_user_delete_apikeys` AFTER DELETE ON `auth_user` BEGIN
  DELETE FROM auth_apikey WHERE reference_id = CAST(old.id AS TEXT);
END;
