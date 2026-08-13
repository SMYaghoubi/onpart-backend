-- Track successful management sign-in and explicit sign-out in UTC.
SET @last_login_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_login_at');
SET @last_login_sql=IF(@last_login_exists=0,'ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER updated_at','SELECT 1');
PREPARE last_login_stmt FROM @last_login_sql;
EXECUTE last_login_stmt;
DEALLOCATE PREPARE last_login_stmt;

SET @last_logout_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_logout_at');
SET @last_logout_sql=IF(@last_logout_exists=0,'ALTER TABLE users ADD COLUMN last_logout_at DATETIME NULL AFTER last_login_at','SELECT 1');
PREPARE last_logout_stmt FROM @last_logout_sql;
EXECUTE last_logout_stmt;
DEALLOCATE PREPARE last_logout_stmt;
