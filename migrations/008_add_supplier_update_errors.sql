CREATE TABLE IF NOT EXISTS supplier_update_errors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL,
  source_row INT NULL,
  raw_code VARCHAR(150) NULL,
  error_message VARCHAR(1000) NOT NULL,
  status ENUM('pending','resolved') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_supplier_update_error_batch (batch_id),
  FOREIGN KEY (batch_id) REFERENCES supplier_update_batches(id) ON DELETE CASCADE
);

SELECT 1;
