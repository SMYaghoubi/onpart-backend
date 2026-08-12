-- Optional supplier capability relationship. Never changes users.role.
SET @supplier_user_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='suppliers' AND COLUMN_NAME='user_id');
SET @supplier_user_sql=IF(@supplier_user_exists=0,'ALTER TABLE suppliers ADD COLUMN user_id INT NULL AFTER id','SELECT 1');
PREPARE supplier_user_stmt FROM @supplier_user_sql;
EXECUTE supplier_user_stmt;
DEALLOCATE PREPARE supplier_user_stmt;

-- Backfill only exact, unambiguous phone matches. No management role is inferred.
UPDATE suppliers s
JOIN users u ON TRIM(u.phone)=TRIM(s.mobile)
JOIN (SELECT TRIM(phone) phone,COUNT(*) count FROM users GROUP BY TRIM(phone) HAVING COUNT(*)=1) unique_users ON unique_users.phone=TRIM(u.phone)
JOIN (SELECT TRIM(mobile) mobile,COUNT(*) count FROM suppliers GROUP BY TRIM(mobile) HAVING COUNT(*)=1) unique_suppliers ON unique_suppliers.mobile=TRIM(s.mobile)
SET s.user_id=u.id
WHERE s.user_id IS NULL;

SET @supplier_user_index_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='suppliers' AND COLUMN_NAME='user_id' AND NON_UNIQUE=0);
SET @supplier_user_index_sql=IF(@supplier_user_index_exists=0,'ALTER TABLE suppliers ADD UNIQUE KEY uq_suppliers_user (user_id)','SELECT 1');
PREPARE supplier_user_index_stmt FROM @supplier_user_index_sql;
EXECUTE supplier_user_index_stmt;
DEALLOCATE PREPARE supplier_user_index_stmt;

SET @supplier_user_fk_exists=(SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='suppliers' AND COLUMN_NAME='user_id' AND REFERENCED_TABLE_NAME='users' AND REFERENCED_COLUMN_NAME='id');
SET @supplier_user_fk_sql=IF(@supplier_user_fk_exists=0,'ALTER TABLE suppliers ADD CONSTRAINT fk_suppliers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL','SELECT 1');
PREPARE supplier_user_fk_stmt FROM @supplier_user_fk_sql;
EXECUTE supplier_user_fk_stmt;
DEALLOCATE PREPARE supplier_user_fk_stmt;
