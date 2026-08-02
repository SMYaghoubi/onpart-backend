SET @sound_key_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_notifications'
    AND COLUMN_NAME = 'sound_key'
);

SET @sound_key_sql = IF(
  @sound_key_exists = 0,
  'ALTER TABLE user_notifications ADD COLUMN sound_key VARCHAR(50) NULL AFTER link',
  'SELECT 1'
);

PREPARE sound_key_statement FROM @sound_key_sql;
EXECUTE sound_key_statement;
DEALLOCATE PREPARE sound_key_statement;

