SET @supplier_archived_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_update_batches' AND COLUMN_NAME='archived_at');
SET @supplier_archived_sql=IF(@supplier_archived_exists=0,'ALTER TABLE supplier_update_batches ADD COLUMN archived_at DATETIME NULL AFTER reviewed_at','SELECT 1');
PREPARE supplier_archived_stmt FROM @supplier_archived_sql;
EXECUTE supplier_archived_stmt;
DEALLOCATE PREPARE supplier_archived_stmt;

SET @supplier_archived_by_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_update_batches' AND COLUMN_NAME='archived_by');
SET @supplier_archived_by_sql=IF(@supplier_archived_by_exists=0,'ALTER TABLE supplier_update_batches ADD COLUMN archived_by INT NULL AFTER archived_at','SELECT 1');
PREPARE supplier_archived_by_stmt FROM @supplier_archived_by_sql;
EXECUTE supplier_archived_by_stmt;
DEALLOCATE PREPARE supplier_archived_by_stmt;

SET @supplier_archived_index_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_update_batches' AND INDEX_NAME='idx_supplier_batch_archived');
SET @supplier_archived_index_sql=IF(@supplier_archived_index_exists=0,'ALTER TABLE supplier_update_batches ADD INDEX idx_supplier_batch_archived (archived_at,status,id)','SELECT 1');
PREPARE supplier_archived_index_stmt FROM @supplier_archived_index_sql;
EXECUTE supplier_archived_index_stmt;
DEALLOCATE PREPARE supplier_archived_index_stmt;