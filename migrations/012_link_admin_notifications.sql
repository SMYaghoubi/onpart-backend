SET @admin_notif_entity_type_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='entity_type');
SET @admin_notif_entity_type_sql=IF(@admin_notif_entity_type_exists=0,'ALTER TABLE notifications ADD COLUMN entity_type VARCHAR(40) NULL AFTER link','SELECT 1');
PREPARE admin_notif_entity_type_stmt FROM @admin_notif_entity_type_sql;
EXECUTE admin_notif_entity_type_stmt;
DEALLOCATE PREPARE admin_notif_entity_type_stmt;

SET @admin_notif_entity_id_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='entity_id');
SET @admin_notif_entity_id_sql=IF(@admin_notif_entity_id_exists=0,'ALTER TABLE notifications ADD COLUMN entity_id BIGINT NULL AFTER entity_type','SELECT 1');
PREPARE admin_notif_entity_id_stmt FROM @admin_notif_entity_id_sql;
EXECUTE admin_notif_entity_id_stmt;
DEALLOCATE PREPARE admin_notif_entity_id_stmt;

SET @admin_notif_resolved_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='resolved_at');
SET @admin_notif_resolved_sql=IF(@admin_notif_resolved_exists=0,'ALTER TABLE notifications ADD COLUMN resolved_at DATETIME NULL AFTER entity_id','SELECT 1');
PREPARE admin_notif_resolved_stmt FROM @admin_notif_resolved_sql;
EXECUTE admin_notif_resolved_stmt;
DEALLOCATE PREPARE admin_notif_resolved_stmt;

SET @admin_notif_entity_index_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND INDEX_NAME='idx_notifications_entity');
SET @admin_notif_entity_index_sql=IF(@admin_notif_entity_index_exists=0,'ALTER TABLE notifications ADD INDEX idx_notifications_entity (entity_type,entity_id,is_read)','SELECT 1');
PREPARE admin_notif_entity_index_stmt FROM @admin_notif_entity_index_sql;
EXECUTE admin_notif_entity_index_stmt;
DEALLOCATE PREPARE admin_notif_entity_index_stmt;
