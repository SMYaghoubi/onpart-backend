CREATE TABLE IF NOT EXISTS supplier_inventory (
  supplier_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT UNSIGNED NULL,
  available TINYINT NULL,
  supplier_price BIGINT NULL,
  manufacturer_code VARCHAR(50) NULL,
  PRIMARY KEY (supplier_id, product_id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_update_quantities (
  item_id BIGINT NOT NULL PRIMARY KEY,
  quantity INT UNSIGNED NOT NULL,
  FOREIGN KEY (item_id) REFERENCES supplier_update_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_new_product_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL,
  code VARCHAR(50) NOT NULL,
  description VARCHAR(255) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  supplier_price BIGINT NOT NULL,
  quantity INT UNSIGNED NULL,
  available TINYINT NOT NULL,
  product_id INT NULL,
  FOREIGN KEY (batch_id) REFERENCES supplier_update_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_supplier_new_batch (batch_id)
);

CREATE TABLE IF NOT EXISTS supplier_submission_keys (
  supplier_id INT NOT NULL,
  request_key CHAR(36) NOT NULL,
  batch_id BIGINT NOT NULL,
  item_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (supplier_id, request_key),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES supplier_update_batches(id) ON DELETE CASCADE
);
