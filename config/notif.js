const db = require('../config/database');
const { broadcast } = require('../lib/liveEvents');

async function createNotif(type, title, body, link, entityType = null, entityId = null) {
  try {
    await db.execute(
      'INSERT INTO notifications (type, title, body, link, entity_type, entity_id) VALUES (?,?,?,?,?,?)',
      [type, title, body || '', link || null, entityType, entityId]
    );
    broadcast('admin-notification', { changed: true, type });
  } catch (err) {
    console.error('createNotif error:', err.message);
  }
}

module.exports = { createNotif };
