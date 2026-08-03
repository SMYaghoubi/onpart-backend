CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  type ENUM('info','success','warning','error') NOT NULL DEFAULT 'info',
  link VARCHAR(500) NULL,
  sound_key VARCHAR(50) NULL,
  entity_type VARCHAR(40) NULL,
  entity_id BIGINT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_notifications_user (user_id, is_read, created_at),
  INDEX idx_user_notification_entity (user_id, entity_type, entity_id),
  CONSTRAINT fk_user_notifications_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
