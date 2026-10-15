CREATE TABLE IF NOT EXISTS site_visits (
  view_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visit_day DATE NOT NULL,
  visitor_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT NULL,
  page VARCHAR(60) NOT NULL,
  started_at DATETIME NOT NULL,
  last_seen DATETIME NOT NULL,
  visible TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (view_id,visit_day),
  INDEX idx_visits_started (started_at,visitor_key),
  INDEX idx_visits_online (visible,last_seen),
  INDEX idx_visits_visitor (visitor_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
