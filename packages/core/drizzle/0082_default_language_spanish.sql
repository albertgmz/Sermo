-- Spanish is the default language of the site. A stored configuration that holds the old default,
-- English, now holds Spanish. Only that one value changes, and only when it is `en`.
UPDATE `site_settings`
SET `value` = json_set(`value`, '$.defaultLanguage', 'es')
WHERE `key` = 'configuration'
  AND json_valid(`value`)
  AND json_extract(`value`, '$.defaultLanguage') = 'en';
