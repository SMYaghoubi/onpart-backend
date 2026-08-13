-- =============================================
-- OnPart Database Schema
-- Run this file after creating MySQL database
-- =============================================

CREATE DATABASE IF NOT EXISTS onpart CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE onpart;

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100),
  phone       VARCHAR(20) NOT NULL UNIQUE,
  email       VARCHAR(150),
  password    VARCHAR(255),
  role        ENUM('user','partner','admin') DEFAULT 'user',
  status      ENUM('active','inactive','blocked','pending') DEFAULT 'active',
  welcomed    TINYINT DEFAULT 0,
  webauthn_enabled TINYINT DEFAULT 0,
  webauthn_challenge VARCHAR(255),
  shop_name   VARCHAR(200),
  national_code VARCHAR(20),
  phone_fixed VARCHAR(20),
  id_card_image VARCHAR(255),
  shop_image  VARCHAR(255),
  province    VARCHAR(100),
  city        VARCHAR(100),
  state       VARCHAR(100),
  address     TEXT,
  postal_code VARCHAR(20),
  credit_limit BIGINT DEFAULT 0,
  debt        BIGINT DEFAULT 0,
  referrer_id INT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  last_logout_at DATETIME NULL,
  INDEX idx_phone (phone),
  INDEX idx_role  (role),
  INDEX idx_status(status)
);

-- ── OTP ──
CREATE TABLE IF NOT EXISTS otps (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  phone      VARCHAR(20) NOT NULL,
  code       VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone (phone)
);

-- ── Products ──
CREATE TABLE IF NOT EXISTS products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  car         VARCHAR(100),
  brand       VARCHAR(100),
  category    VARCHAR(100),
  price       BIGINT NOT NULL DEFAULT 0,
  stock       INT DEFAULT 0,
  min_stock   INT DEFAULT 5,
  has_flow    TINYINT DEFAULT 0,
  status      ENUM('active','inactive') DEFAULT 'active',
  supplier_id INT,
  image       VARCHAR(255),
  note        TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code    (code),
  INDEX idx_brand   (brand),
  INDEX idx_car     (car),
  INDEX idx_category(category),
  FULLTEXT  ft_desc (description)
);

-- ── Orders ──
CREATE TABLE IF NOT EXISTS orders (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  total       BIGINT NOT NULL DEFAULT 0,
  debt_remaining BIGINT NOT NULL DEFAULT 0,
  discount_percent INT DEFAULT 0,
  status      ENUM('pending_expert','pending_customer','pending_payment','preparing','shipping','delivered','cancelled') DEFAULT 'pending_expert',
  note        TEXT,
  shipping_method   VARCHAR(50),
  shipping_tracking VARCHAR(100),
  shipping_driver_name VARCHAR(100),
  shipping_driver_phone VARCHAR(20),
  shipping_vehicle  VARCHAR(50),
  shipping_plate    VARCHAR(20),
  shipping_packages INT DEFAULT 1,
  delivery_code     VARCHAR(20),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_id(user_id),
  INDEX idx_status (status)
);

-- ── Order Items ──
CREATE TABLE IF NOT EXISTS order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  product_id INT NOT NULL,
  car_name   VARCHAR(100),
  quantity   INT NOT NULL DEFAULT 1,
  price      BIGINT NOT NULL,
  discount   INT DEFAULT 0,
  total      BIGINT NOT NULL,
  FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_order_id(order_id)
);

-- ── Invoices ──
CREATE TABLE IF NOT EXISTS invoices (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  user_id    INT NOT NULL,
  type       ENUM('pre','final') DEFAULT 'pre',
  subtotal   BIGINT NOT NULL,
  tax        BIGINT NOT NULL DEFAULT 0,
  total      BIGINT NOT NULL,
  status     ENUM('pending','paid','cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_user_id (user_id),
  INDEX idx_order_id(order_id)
);

-- ── Payments ──
CREATE TABLE IF NOT EXISTS payments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  order_id    INT,
  amount      BIGINT NOT NULL,
  bank        VARCHAR(100),
  track_number VARCHAR(100),
  receipt_file VARCHAR(255),
  pay_date    DATE,
  src_card    VARCHAR(25),
  dest_account VARCHAR(100),
  status      ENUM('pending','approved','rejected') DEFAULT 'pending',
  note        TEXT,
  reviewed_by INT,
  reviewed_at TIMESTAMP NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_id(user_id),
  INDEX idx_status (status)
);

-- ── Credit Requests ──
CREATE TABLE IF NOT EXISTS credit_requests (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  amount         BIGINT NOT NULL,
  guarantee_type ENUM('cheque','promissory','guarantor','property'),
  guarantee_detail TEXT,
  full_name      VARCHAR(200),
  mobile         VARCHAR(20),
  national_code  VARCHAR(20),
  job            VARCHAR(100),
  province       VARCHAR(100),
  city           VARCHAR(100),
  address        TEXT,
  id_card_file   VARCHAR(255),
  guarantee_file VARCHAR(255),
  job_file       VARCHAR(255),
  other_file     VARCHAR(255),
  score          INT DEFAULT 0,
  status         ENUM('pending','approved','rejected') DEFAULT 'pending',
  approved_amount BIGINT DEFAULT 0,
  note           TEXT,
  reviewed_by    INT,
  reviewed_at    TIMESTAMP NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_id(user_id),
  INDEX idx_status (status)
);

-- ── User Announcements (shop notifications) ──
CREATE TABLE IF NOT EXISTS announcements (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  type       ENUM('info','warning','success','promo') DEFAULT 'info',
  is_active  TINYINT DEFAULT 1,
  expires_at TIMESTAMP NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active),
  INDEX idx_expires (expires_at)
);

-- ── Notifications ──
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  link       VARCHAR(200),
  is_read    TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_is_read (is_read),
  INDEX idx_created (created_at)
);
CREATE TABLE IF NOT EXISTS partnership_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT,
  name         VARCHAR(100),
  phone        VARCHAR(20),
  company      VARCHAR(150),
  business_type VARCHAR(100),
  city         VARCHAR(100),
  state        VARCHAR(100),
  address      TEXT,
  experience   INT,
  referrer     VARCHAR(100),
  note         TEXT,
  status       ENUM('pending','approved','rejected') DEFAULT 'pending',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status(status)
);

-- ── SMS Logs ──
CREATE TABLE IF NOT EXISTS sms_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  phone       VARCHAR(20),
  message     TEXT,
  type        VARCHAR(50),
  status      ENUM('sent','failed') DEFAULT 'sent',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone(phone)
);

-- ── Settings ──
CREATE TABLE IF NOT EXISTS settings (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  value LONGTEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default settings
INSERT IGNORE INTO settings (`key`, value) VALUES
('site_name',   'آن‌پارت'),
('site_phone',  '02165280448'),
('site_whatsapp','02165280448'),
('site_instagram','onpart.ir'),
('tax_rate',    '9'),
('min_order',   '500000'),
('bank_mellat', '6104-XXXX-XXXX-XXXX'),
('bank_melli',  '6037-XXXX-XXXX-XXXX'),
('sms_api_key', ''),
('sms_line',    '');

-- Default admin user (password: admin123)
INSERT IGNORE INTO users (name, phone, password, role, status) VALUES
('مدیر سیستم', '09000000000', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 'active');

-- ── Suppliers ──
CREATE TABLE IF NOT EXISTS suppliers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  company     VARCHAR(200) NOT NULL,
  type        VARCHAR(100),
  name        VARCHAR(200) NOT NULL,
  mobile      VARCHAR(20) NOT NULL,
  city        VARCHAR(100),
  province    VARCHAR(100),
  address     TEXT,
  email       VARCHAR(200),
  phone       VARCHAR(20),
  website     VARCHAR(200),
  reg_number  VARCHAR(50),
  year        VARCHAR(10),
  inventory   VARCHAR(100),
  shipping    VARCHAR(100),
  description TEXT,
  categories  TEXT,
  brands      TEXT,
  status      ENUM('pending','reviewed','approved','rejected') DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_suppliers_user (user_id),
  CONSTRAINT fk_suppliers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ── WebAuthn Credentials ──
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  credential_id TEXT NOT NULL,
  public_key    TEXT NOT NULL,
  device_name   VARCHAR(100) DEFAULT 'دستگاه من',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
