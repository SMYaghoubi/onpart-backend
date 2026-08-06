-- Run after 014. Idempotent allocation ledger for approved payments.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  order_id INT NOT NULL,
  amount BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_allocation_order (payment_id,order_id),
  KEY idx_payment_allocations_order (order_id),
  CONSTRAINT fk_payment_allocations_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_allocations_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve the original linked order first. Multiple payments for one order are
-- capped at that order's total and processed in review/creation order.
INSERT INTO payment_allocations (payment_id,order_id,amount)
SELECT ranked.id,ranked.order_id,
       LEAST(ranked.amount,GREATEST(ranked.order_total-ranked.previous_amount,0)) allocation_amount
FROM (
  SELECT p.id,p.order_id,p.amount,o.total order_total,
    COALESCE(SUM(p.amount) OVER (
      PARTITION BY p.order_id ORDER BY COALESCE(p.reviewed_at,p.created_at),p.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ),0) previous_amount
  FROM payments p JOIN orders o ON o.id=p.order_id AND o.user_id=p.user_id
  WHERE p.status='approved' AND p.order_id IS NOT NULL
    AND o.status IN ('pending_payment','preparing','shipping','delivered')
) ranked
WHERE LEAST(ranked.amount,GREATEST(ranked.order_total-ranked.previous_amount,0))>0
ON DUPLICATE KEY UPDATE amount=VALUES(amount);

-- Allocate every remaining approved balance FIFO across the user's remaining
-- payable orders. Interval intersection supports one payment covering many orders.
DROP TEMPORARY TABLE IF EXISTS migration_015_payment_remaining;
CREATE TEMPORARY TABLE migration_015_payment_remaining AS
SELECT p.id payment_id,p.user_id,
       GREATEST(p.amount-COALESCE(a.allocated_amount,0),0) remaining_amount,
       COALESCE(p.reviewed_at,p.created_at) paid_at
FROM payments p
LEFT JOIN (SELECT payment_id,SUM(amount) allocated_amount FROM payment_allocations GROUP BY payment_id) a ON a.payment_id=p.id
WHERE p.status='approved';

DROP TEMPORARY TABLE IF EXISTS migration_015_order_remaining;
CREATE TEMPORARY TABLE migration_015_order_remaining AS
SELECT o.id order_id,o.user_id,
       GREATEST(o.total-COALESCE(a.allocated_amount,0),0) remaining_amount,
       o.created_at
FROM orders o
LEFT JOIN (SELECT order_id,SUM(amount) allocated_amount FROM payment_allocations GROUP BY order_id) a ON a.order_id=o.id
WHERE o.status IN ('pending_payment','preparing','shipping','delivered');

INSERT INTO payment_allocations (payment_id,order_id,amount)
SELECT p.payment_id,o.order_id,
       GREATEST(LEAST(p.pay_end,o.order_end)-GREATEST(p.pay_start,o.order_start),0) allocation_amount
FROM (
  SELECT payment_id,user_id,remaining_amount,
    COALESCE(SUM(remaining_amount) OVER (PARTITION BY user_id ORDER BY paid_at,payment_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) pay_start,
    SUM(remaining_amount) OVER (PARTITION BY user_id ORDER BY paid_at,payment_id ROWS UNBOUNDED PRECEDING) pay_end
  FROM migration_015_payment_remaining WHERE remaining_amount>0
) p
JOIN (
  SELECT order_id,user_id,remaining_amount,
    COALESCE(SUM(remaining_amount) OVER (PARTITION BY user_id ORDER BY created_at,order_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) order_start,
    SUM(remaining_amount) OVER (PARTITION BY user_id ORDER BY created_at,order_id ROWS UNBOUNDED PRECEDING) order_end
  FROM migration_015_order_remaining WHERE remaining_amount>0
) o ON o.user_id=p.user_id AND p.pay_end>o.order_start AND o.order_end>p.pay_start
WHERE GREATEST(LEAST(p.pay_end,o.order_end)-GREATEST(p.pay_start,o.order_start),0)>0
ON DUPLICATE KEY UPDATE amount=VALUES(amount);

DROP TEMPORARY TABLE IF EXISTS migration_015_payment_remaining;
DROP TEMPORARY TABLE IF EXISTS migration_015_order_remaining;

-- Give legacy unlinked payments a primary order for old clients while the
-- allocation table remains the only financial source of truth.
UPDATE payments p
JOIN (SELECT payment_id,MIN(order_id) order_id FROM payment_allocations GROUP BY payment_id) a ON a.payment_id=p.id
SET p.order_id=a.order_id
WHERE p.order_id IS NULL;

UPDATE orders o
LEFT JOIN (SELECT order_id,SUM(amount) amount FROM payment_allocations GROUP BY order_id) a ON a.order_id=o.id
SET o.debt_remaining=CASE
  WHEN o.status IN ('pending_payment','preparing','shipping','delivered') THEN GREATEST(o.total-COALESCE(a.amount,0),0)
  ELSE 0 END;

UPDATE orders SET status='preparing' WHERE status='pending_payment' AND debt_remaining=0;

UPDATE users u
LEFT JOIN (SELECT user_id,SUM(debt_remaining) debt FROM orders GROUP BY user_id) d ON d.user_id=u.id
SET u.debt=GREATEST(COALESCE(d.debt,0),0);
