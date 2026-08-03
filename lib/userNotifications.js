const db = require('../config/database');
const { broadcast } = require('./liveEvents');

async function createUserNotification(userId, title, body, type = 'info', link = '/orders.html', soundKey = null, entityType = null, entityId = null) {
  try {
    if (!userId) return;
    await db.execute(
      `INSERT INTO user_notifications
       (user_id,title,body,type,link,sound_key,entity_type,entity_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        userId,
        String(title).slice(0,180),
        String(body).slice(0,2000),
        type,
        link,
        soundKey ? String(soundKey).slice(0,50) : null,
        entityType ? String(entityType).slice(0,40) : null,
        Number.isInteger(Number(entityId)) && Number(entityId) > 0 ? Number(entityId) : null
      ]
    );
    broadcast('user-notification', { changed: true });
  } catch (err) {
    console.error('Create user notification failed:', err.message);
  }
}

async function deleteUserNotificationsForEntity(connection, userId, entityType, entityId, legacyLink = null) {
  if (!connection || !userId || !entityType || !entityId) return 0;
  const params = [userId, String(entityType), Number(entityId)];
  let legacy = '';
  if (legacyLink) {
    legacy = ' OR (entity_type IS NULL AND link=? AND (title LIKE ? OR body LIKE ?))';
    params.push(legacyLink, `%#${Number(entityId)}%`, `%#${Number(entityId)}%`);
  }
  const [result] = await connection.execute(
    `DELETE FROM user_notifications
     WHERE user_id=? AND ((entity_type=? AND entity_id=?)${legacy})`,
    params
  );
  return Number(result.affectedRows) || 0;
}

function broadcastUserNotificationsChanged() {
  broadcast('user-notification', { changed: true, deleted: true });
}

module.exports = { createUserNotification, deleteUserNotificationsForEntity, broadcastUserNotificationsChanged };
