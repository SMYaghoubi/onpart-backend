-- Idempotent data reconciliation; safe to rerun after migration 013.
-- Canonical debt = payable order total - all approved payments for that order.
UPDATE orders o
LEFT JOIN (
  SELECT order_id,SUM(amount) approved_amount
  FROM payments
  WHERE status='approved' AND order_id IS NOT NULL
  GROUP BY order_id
) p ON p.order_id=o.id
SET o.debt_remaining=CASE
  WHEN o.status IN ('pending_payment','preparing','shipping','delivered')
  THEN GREATEST(COALESCE(o.total,0)-COALESCE(p.approved_amount,0),0)
  ELSE 0
END;

UPDATE users u
LEFT JOIN (
  SELECT user_id,SUM(debt_remaining) debt
  FROM orders
  GROUP BY user_id
) d ON d.user_id=u.id
SET u.debt=GREATEST(COALESCE(d.debt,0),0);