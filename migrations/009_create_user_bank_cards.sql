CREATE TABLE IF NOT EXISTS user_bank_cards (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  encrypted_number TEXT NOT NULL,
  number_iv VARCHAR(32) NOT NULL,
  number_tag VARCHAR(32) NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  last4 CHAR(4) NOT NULL,
  title VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_card_fingerprint (user_id,fingerprint),
  INDEX idx_user_cards_user (user_id,created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

SET @saved_card_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME='saved_card_id');
SET @saved_card_sql=IF(@saved_card_exists=0,'ALTER TABLE payments ADD COLUMN saved_card_id BIGINT NULL AFTER src_card','SELECT 1');
PREPARE saved_card_stmt FROM @saved_card_sql;
EXECUTE saved_card_stmt;
DEALLOCATE PREPARE saved_card_stmt;
