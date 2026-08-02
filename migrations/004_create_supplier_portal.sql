SET @portal_enabled_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'portal_enabled'
);
SET @portal_enabled_sql = IF(
  @portal_enabled_exists = 0,
  'ALTER TABLE suppliers ADD COLUMN portal_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE portal_enabled_stmt FROM @portal_enabled_sql;
EXECUTE portal_enabled_stmt;
DEALLOCATE PREPARE portal_enabled_stmt;

SET @supplier_updated_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'updated_at'
);
SET @supplier_updated_sql = IF(
  @supplier_updated_exists = 0,
  'ALTER TABLE suppliers ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  'SELECT 1'
);
PREPARE supplier_updated_stmt FROM @supplier_updated_sql;
EXECUTE supplier_updated_stmt;
DEALLOCATE PREPARE supplier_updated_stmt;

CREATE TABLE IF NOT EXISTS supplier_product_scopes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  scope_type ENUM('brand','assigned_company') NOT NULL,
  scope_value VARCHAR(150) NOT NULL DEFAULT '',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_scope (supplier_id, scope_type, scope_value),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supplier_update_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  source ENUM('manual','excel') NOT NULL DEFAULT 'manual',
  original_filename VARCHAR(255) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  markup_percent DECIMAL(8,3) NULL,
  note VARCHAR(1000) NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  INDEX idx_supplier_batch_status (supplier_id,status,submitted_at),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supplier_update_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  supplier_price BIGINT NOT NULL,
  proposed_stock INT NULL,
  previous_price BIGINT NOT NULL DEFAULT 0,
  previous_stock INT NOT NULL DEFAULT 0,
  final_price BIGINT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  note VARCHAR(500) NULL,
  UNIQUE KEY uq_batch_product (batch_id,product_id),
  INDEX idx_supplier_update_product (product_id,status),
  FOREIGN KEY (batch_id) REFERENCES supplier_update_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);
