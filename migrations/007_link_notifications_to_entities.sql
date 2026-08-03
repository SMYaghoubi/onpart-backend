SET @entity_type_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_notifications' AND COLUMN_NAME='entity_type'
);
SET @entity_type_sql = IF(
  @entity_type_exists=0,
  'ALTER TABLE user_notifications ADD COLUMN entity_type VARCHAR(40) NULL AFTER link',
  'SELECT 1'
);
PREPARE entity_type_statement FROM @entity_type_sql;
EXECUTE entity_type_statement;
DEALLOCATE PREPARE entity_type_statement;

SET @entity_id_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_notifications' AND COLUMN_NAME='entity_id'
);
SET @entity_id_sql = IF(
  @entity_id_exists=0,
  'ALTER TABLE user_notifications ADD COLUMN entity_id BIGINT NULL AFTER entity_type',
  'SELECT 1'
);
PREPARE entity_id_statement FROM @entity_id_sql;
EXECUTE entity_id_statement;
DEALLOCATE PREPARE entity_id_statement;

SET @entity_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_notifications' AND INDEX_NAME='idx_user_notification_entity'
);
SET @entity_index_sql = IF(
  @entity_index_exists=0,
  'ALTER TABLE user_notifications ADD INDEX idx_user_notification_entity (user_id,entity_type,entity_id)',
  'SELECT 1'
);
PREPARE entity_index_statement FROM @entity_index_sql;
EXECUTE entity_index_statement;
DEALLOCATE PREPARE entity_index_statement;
