const db = require('../config/database');
const { broadcast } = require('./liveEvents');

async function createUserNotification(userId, title, body, type = 'info', link = '/orders.html') {
  try {
    if (!userId) return;
    await db.execute(
      'INSERT INTO user_notifications (user_id,title,body,type,link) VALUES (?,?,?,?,?)',
      [userId, String(title).slice(0,180), String(body).slice(0,2000), type, link]
    );
    broadcast('user-notification', { changed: true });
  } catch (err) {
    console.error('Create user notification failed:', err.message);
  }
}

module.exports = { createUserNotification };
