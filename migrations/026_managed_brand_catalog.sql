CREATE TABLE IF NOT EXISTS brand_catalog (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(150) NOT NULL,
 normalized_key VARCHAR(190) COLLATE utf8mb4_bin NOT NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 logo_id CHAR(36) NULL,
 featured TINYINT(1) NOT NULL DEFAULT 0,
 created_by INT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_brand_catalog_key (normalized_key)
);
CREATE TABLE IF NOT EXISTS brand_catalog_seed_state (id TINYINT NOT NULL PRIMARY KEY, seeded TINYINT NOT NULL DEFAULT 0);
INSERT IGNORE INTO brand_catalog_seed_state (id,seeded) VALUES (1,0);
CREATE TABLE IF NOT EXISTS supplier_brand_requests (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 supplier_id INT NOT NULL,
 request_key CHAR(36) NOT NULL,
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 note VARCHAR(1000) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at DATETIME NULL,
 reviewed_by INT NULL,
 UNIQUE KEY uq_supplier_brand_request_key (supplier_id,request_key),
 INDEX idx_supplier_brand_requests (supplier_id,status,id)
);
CREATE TABLE IF NOT EXISTS supplier_brand_request_items (
 request_id INT NOT NULL,
 brand_id INT NOT NULL,
 PRIMARY KEY (request_id,brand_id),
 FOREIGN KEY (request_id) REFERENCES supplier_brand_requests(id) ON DELETE CASCADE,
 FOREIGN KEY (brand_id) REFERENCES brand_catalog(id) ON DELETE RESTRICT
);
