-- Preserve the customer's receipt description separately from the finance review note.
SET @payment_description_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'description'
);

SET @payment_description_sql = IF(
  @payment_description_exists = 0,
  'ALTER TABLE payments ADD COLUMN description VARCHAR(1000) NULL AFTER dest_account',
  'SELECT 1'
);

PREPARE payment_description_stmt FROM @payment_description_sql;
EXECUTE payment_description_stmt;
DEALLOCATE PREPARE payment_description_stmt;
