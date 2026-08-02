SET @debt_remaining_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'debt_remaining'
);

SET @debt_remaining_sql = IF(
  @debt_remaining_exists = 0,
  'ALTER TABLE orders ADD COLUMN debt_remaining BIGINT NOT NULL DEFAULT 0 AFTER total',
  'SELECT 1'
);

PREPARE debt_remaining_statement FROM @debt_remaining_sql;
EXECUTE debt_remaining_statement;
DEALLOCATE PREPARE debt_remaining_statement;

-- Existing unpaid, customer-approved orders are the valid source of debt.
UPDATE orders
SET debt_remaining = total
WHERE status = 'pending_payment' AND debt_remaining = 0;

-- Remove stale debt left by deleted/cancelled orders and synchronize every customer.
UPDATE users u
LEFT JOIN (
  SELECT user_id, COALESCE(SUM(debt_remaining), 0) AS calculated_debt
  FROM orders
  GROUP BY user_id
) d ON d.user_id = u.id
SET u.debt = COALESCE(d.calculated_debt, 0)
WHERE u.role = 'user';

