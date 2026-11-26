-- A public, stable seller code is distinct from internal IDs and per-product offer tokens.
-- Retain allocations after an account is deleted so another seller never receives its old code.
CREATE TABLE IF NOT EXISTS supplier_seller_codes (
 supplier_id INT NOT NULL PRIMARY KEY,
 seller_code CHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_supplier_seller_code (seller_code)
);
