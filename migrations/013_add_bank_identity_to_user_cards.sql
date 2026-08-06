SET @bank_code_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_bank_cards' AND COLUMN_NAME='bank_code');
SET @bank_code_sql=IF(@bank_code_exists=0,'ALTER TABLE user_bank_cards ADD COLUMN bank_code VARCHAR(40) NULL AFTER title','SELECT 1');
PREPARE bank_code_stmt FROM @bank_code_sql;
EXECUTE bank_code_stmt;
DEALLOCATE PREPARE bank_code_stmt;

SET @bank_name_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_bank_cards' AND COLUMN_NAME='bank_name');
SET @bank_name_sql=IF(@bank_name_exists=0,'ALTER TABLE user_bank_cards ADD COLUMN bank_name VARCHAR(100) NULL AFTER bank_code','SELECT 1');
PREPARE bank_name_stmt FROM @bank_name_sql;
EXECUTE bank_name_stmt;
DEALLOCATE PREPARE bank_name_stmt;