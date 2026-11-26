-- No inferred historical prices, seller assignments or product merges.
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_inventory' AND COLUMN_NAME='final_price');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE supplier_inventory ADD COLUMN final_price BIGINT NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_inventory' AND COLUMN_NAME='offer_token');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE supplier_inventory ADD COLUMN offer_token CHAR(32) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_inventory' AND COLUMN_NAME='offer_version');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE supplier_inventory ADD COLUMN offer_version BIGINT NOT NULL DEFAULT 0','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_items' AND COLUMN_NAME='offer_token');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE cart_items ADD COLUMN offer_token CHAR(32) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_items' AND COLUMN_NAME='offer_version');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE cart_items ADD COLUMN offer_version BIGINT NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_items' AND COLUMN_NAME='quoted_price');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE cart_items ADD COLUMN quoted_price BIGINT NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND COLUMN_NAME='offer_token');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE order_items ADD COLUMN offer_token CHAR(32) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='fulfillment_policy');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE orders ADD COLUMN fulfillment_policy VARCHAR(64) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='hub_city');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE orders ADD COLUMN hub_city VARCHAR(64) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='request_key');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE orders ADD COLUMN request_key CHAR(36) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_inventory' AND INDEX_NAME='uq_market_offer');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE supplier_inventory ADD UNIQUE INDEX uq_market_offer (offer_token)','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
SET @market_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='uq_market_request');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE orders ADD UNIQUE INDEX uq_market_request (user_id,request_key)','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
CREATE TABLE IF NOT EXISTS market_reservations (
 order_item_id INT NOT NULL PRIMARY KEY,
 order_id INT NOT NULL,
 supplier_id INT NOT NULL,
 product_id INT NOT NULL,
 quantity INT UNSIGNED NOT NULL,
 state ENUM('reserved','consumed') NOT NULL DEFAULT 'reserved',
 received_by INT NULL,
 received_at DATETIME NULL,
 FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
 INDEX idx_market_reserved (supplier_id,product_id,state),
 INDEX idx_market_order (order_id)
);
SET @market_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='request_fingerprint');
SET @market_sql=IF(@market_exists=0,'ALTER TABLE orders ADD COLUMN request_fingerprint CHAR(64) NULL','SELECT 1');
PREPARE market_stmt FROM @market_sql;
EXECUTE market_stmt;
DEALLOCATE PREPARE market_stmt;
