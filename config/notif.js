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

async function createNotifOnce(type, title, body, link, entityType, entityId, database = db) {
  const conn=await database.getConnection();let inserted=false;
  try {
    await conn.beginTransaction();
    const [existing]=await conn.execute(
      'SELECT id FROM notifications WHERE type=? AND entity_type=? AND entity_id=? AND title=? LIMIT 1 FOR UPDATE',
      [type,entityType,Number(entityId),title]
    );
    if(!existing.length){
      await conn.execute(
        'INSERT INTO notifications (type,title,body,link,entity_type,entity_id) VALUES (?,?,?,?,?,?)',
        [type,title,body||'',link||null,entityType,Number(entityId)]
      );
      inserted=true;
    }
    await conn.commit();
    if(inserted)broadcast('admin-notification',{changed:true,type});
    return inserted;
  } catch (err) {
    try{await conn.rollback()}catch(_){}
    console.error('createNotifOnce error:',err.message);
    return false;
  } finally { conn.release(); }
}

module.exports = { createNotif, createNotifOnce };
