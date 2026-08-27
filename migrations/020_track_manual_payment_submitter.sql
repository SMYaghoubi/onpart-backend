-- Record whether a receipt was submitted by its customer or by management.
SET @payment_submitted_by_exists=(
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME='submitted_by'
);
SET @payment_submitted_by_sql=IF(
  @payment_submitted_by_exists=0,
  'ALTER TABLE payments ADD COLUMN submitted_by INT NULL AFTER description',
  'SELECT 1'
);
PREPARE payment_submitted_by_stmt FROM @payment_submitted_by_sql;
EXECUTE payment_submitted_by_stmt;
DEALLOCATE PREPARE payment_submitted_by_stmt;

SET @payment_submission_source_exists=(
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME='submission_source'
);
SET @payment_submission_source_sql=IF(
  @payment_submission_source_exists=0,
  'ALTER TABLE payments ADD COLUMN submission_source VARCHAR(20) NOT NULL DEFAULT ''user'' AFTER submitted_by',
  'SELECT 1'
);
PREPARE payment_submission_source_stmt FROM @payment_submission_source_sql;
EXECUTE payment_submission_source_stmt;
DEALLOCATE PREPARE payment_submission_source_stmt;

SET @payment_submitted_by_index_exists=(
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND INDEX_NAME='idx_payments_submitted_by'
);
SET @payment_submitted_by_index_sql=IF(
  @payment_submitted_by_index_exists=0,
  'ALTER TABLE payments ADD INDEX idx_payments_submitted_by (submitted_by)',
  'SELECT 1'
);
PREPARE payment_submitted_by_index_stmt FROM @payment_submitted_by_index_sql;
EXECUTE payment_submitted_by_index_stmt;
DEALLOCATE PREPARE payment_submitted_by_index_stmt;
