CREATE TABLE IF NOT EXISTS supplier_product_images (
  id CHAR(36) NOT NULL PRIMARY KEY,
  supplier_id INT NOT NULL,
  filename VARCHAR(100) NOT NULL UNIQUE,
  state ENUM('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft',
  batch_id BIGINT NULL,
  product_id INT NULL,
  new_product_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES supplier_update_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  FOREIGN KEY (new_product_id) REFERENCES supplier_new_product_requests(id) ON DELETE CASCADE,
  INDEX idx_supplier_images_owner (supplier_id,state,created_at),
  INDEX idx_supplier_images_batch (batch_id)
);

