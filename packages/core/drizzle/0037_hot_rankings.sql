-- The feed's Top ranking (kind feedTop) is replaced by Hot (kind hot); the job writes the new rows.
DELETE FROM `rankings` WHERE `kind` = 'feedTop';
