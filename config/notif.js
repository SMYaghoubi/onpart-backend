const db = require('../config/database');
const { broadcast } = require('../lib/liveEvents');

async function createNotif(type, title, body, link) {
  try {
    await db.execute(
      'INSERT INTO notifications (type, title, body, link) VALUES (?,?,?,?)',
      [type, title, body || '', link || null]
    );
    broadcast('admin-notification', { changed: true, type });
  } catch (err) {
    console.error('createNotif error:', err.message);
  }
}

module.exports = { createNotif };
