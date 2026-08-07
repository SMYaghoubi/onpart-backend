-- Run after 015. Preserve the vehicle label shown at the time of ordering.
SET @vehicle_snapshot_exists=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND COLUMN_NAME='car_name');
SET @vehicle_snapshot_sql=IF(@vehicle_snapshot_exists=0,'ALTER TABLE order_items ADD COLUMN car_name VARCHAR(100) NULL AFTER product_id','SELECT 1');
PREPARE vehicle_snapshot_stmt FROM @vehicle_snapshot_sql;
EXECUTE vehicle_snapshot_stmt;
DEALLOCATE PREPARE vehicle_snapshot_stmt;

UPDATE order_items oi
JOIN products p ON p.id=oi.product_id
SET oi.car_name=p.car
WHERE (oi.car_name IS NULL OR TRIM(oi.car_name)='')
  AND p.car IS NOT NULL AND TRIM(p.car)<>'';
