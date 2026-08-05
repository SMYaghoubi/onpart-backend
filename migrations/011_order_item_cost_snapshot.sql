SET @cost_snapshot_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND COLUMN_NAME='cost_price');
SET @cost_snapshot_sql=IF(@cost_snapshot_exists=0,'ALTER TABLE order_items ADD COLUMN cost_price BIGINT NOT NULL DEFAULT 0 AFTER price','SELECT 1');
PREPARE cost_snapshot_stmt FROM @cost_snapshot_sql;
EXECUTE cost_snapshot_stmt;
DEALLOCATE PREPARE cost_snapshot_stmt;

UPDATE order_items oi
LEFT JOIN (
  SELECT sui.product_id,sui.supplier_price
  FROM supplier_update_items sui
  JOIN (SELECT product_id,MAX(id) id FROM supplier_update_items WHERE status='approved' GROUP BY product_id) latest ON latest.id=sui.id
) costs ON costs.product_id=oi.product_id
SET oi.cost_price=COALESCE(costs.supplier_price,oi.price)
WHERE oi.cost_price=0;

SET @orders_created_index_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_created_status');
SET @orders_created_index_sql=IF(@orders_created_index_exists=0,'ALTER TABLE orders ADD INDEX idx_orders_created_status (created_at,status)','SELECT 1');
PREPARE orders_created_index_stmt FROM @orders_created_index_sql;
EXECUTE orders_created_index_stmt;
DEALLOCATE PREPARE orders_created_index_stmt;

SET @payments_created_index_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND INDEX_NAME='idx_payments_created_status');
SET @payments_created_index_sql=IF(@payments_created_index_exists=0,'ALTER TABLE payments ADD INDEX idx_payments_created_status (created_at,status)','SELECT 1');
PREPARE payments_created_index_stmt FROM @payments_created_index_sql;
EXECUTE payments_created_index_stmt;
DEALLOCATE PREPARE payments_created_index_stmt;
