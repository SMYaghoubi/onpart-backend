const { broadcast } = require('./liveEvents');

async function resolveAdminNotification(connection, entityType, entityId, link) {
  if (!connection) return 0;
  const conditions = [];
  const params = [];
  if (entityType && entityId) { conditions.push('(entity_type=? AND entity_id=?)'); params.push(entityType, Number(entityId)); }
  if (link && entityId) { conditions.push('(entity_type IS NULL AND link=? AND (title LIKE ? OR body LIKE ?))'); params.push(link, '%#' + Number(entityId) + '%', '%#' + Number(entityId) + '%'); }
  if (!conditions.length) return 0;
  const [result] = await connection.execute('UPDATE notifications SET is_read=1,resolved_at=NOW() WHERE is_read=0 AND (' + conditions.join(' OR ') + ')', params);
  return Number(result.affectedRows) || 0;
}

function notifyAdminNotificationsChanged(data = {}) {
  broadcast('admin-notification', { changed: true, ...data });
}

module.exports = { resolveAdminNotification, notifyAdminNotificationsChanged };
