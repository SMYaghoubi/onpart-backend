const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const PAGE_LABELS=Object.freeze({'/':'صفحه اصلی','/shop':'فروشگاه','/login':'ورود','/register':'ثبت‌نام','/orders':'سفارش‌ها','/payment':'ثبت فیش','/profile':'حساب کاربری','/edit-profile':'ویرایش حساب','/change-password':'تغییر رمز','/credit':'درخواست اعتبار','/reports':'گزارش‌ها','/cooperation':'همکاری'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalizeVisit(body={}){
  if(!UUID.test(body.visitor_id||'')||!UUID.test(body.view_id||'')||!Object.hasOwn(PAGE_LABELS,body.page)||typeof body.visible!=='boolean')throw Object.assign(new Error('اطلاعات بازدید معتبر نیست'),{status:400});
  return {visitorId:body.visitor_id.toLowerCase(),viewId:body.view_id.toLowerCase(),page:body.page,visible:body.visible?1:0};
}
function dayBounds(now=new Date()){
  const offset=210*60*1000,local=new Date(now.getTime()+offset);
  const start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-offset);
  return {today:start,week:new Date(start.getTime()-6*86400000),online:new Date(now.getTime()-75000),retention:new Date(start.getTime()-35*86400000)};
}
function createVisitorService(db,{secret,clock=()=>new Date()}={}){
  let ready=null,lastCleanup=0;
  function ensure(){
    if(!ready)ready=db.execute(fs.readFileSync(path.join(__dirname,'../migrations/021_create_site_visits.sql'),'utf8')).catch(error=>{ready=null;throw error;});
    return ready;
  }
  async function track(body,userId=null){
    const visit=normalizeVisit(body);
    if(!secret)throw new Error('Visitor hashing secret unavailable');
    const visitorKey=crypto.createHmac('sha256',secret).update(visit.visitorId).digest('hex');
    const now=clock();await ensure();
    await db.execute(`INSERT INTO site_visits (view_id,visit_day,visitor_key,user_id,page,started_at,last_seen,visible) VALUES (?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        last_seen=IF(visitor_key=VALUES(visitor_key),VALUES(last_seen),last_seen),
        visible=IF(visitor_key=VALUES(visitor_key),VALUES(visible),visible),
        user_id=IF(visitor_key=VALUES(visitor_key),VALUES(user_id),user_id)`,
      [visit.viewId,new Date(now.getTime()+210*60000).toISOString().slice(0,10),visitorKey,userId,visit.page,now,now,visit.visible]);
    if(now.getTime()-lastCleanup>3600000){
      lastCleanup=now.getTime();
      try{await db.execute('DELETE FROM site_visits WHERE started_at<?',[dayBounds(now).retention]);}
      catch(error){lastCleanup=0;console.error('Visit cleanup failed:',error.message);}
    }
  }
  async function summary(){
    await ensure();const now=clock(),bounds=dayBounds(now);
    const [[[counts]],[[live]], [visitors]]=await Promise.all([
      db.execute(`SELECT COUNT(DISTINCT CASE WHEN started_at>=? THEN visitor_key END) visitors_today,
        COUNT(CASE WHEN started_at>=? THEN 1 END) pageviews_today,
        COUNT(DISTINCT visitor_key) visitors_week, MIN(started_at) first_visit
        FROM site_visits WHERE started_at>=?`,[bounds.today,bounds.today,bounds.week]),
      db.execute('SELECT COUNT(DISTINCT visitor_key) online FROM site_visits WHERE visible=1 AND last_seen>=?',[bounds.online]),
      db.execute(`SELECT MAX(u.name) user_name,MAX(v.user_id) user_id,MAX(v.last_seen) last_seen,
        SUBSTRING_INDEX(GROUP_CONCAT(v.page ORDER BY v.last_seen DESC),',',1) page
        FROM site_visits v LEFT JOIN users u ON u.id=v.user_id
        WHERE v.visible=1 AND v.last_seen>=? GROUP BY v.visitor_key ORDER BY last_seen DESC LIMIT 100`,[bounds.online])
    ]);
    return {online:Number(live.online)||0,visitors_today:Number(counts.visitors_today)||0,pageviews_today:Number(counts.pageviews_today)||0,visitors_week:Number(counts.visitors_week)||0,updated_at:now.toISOString(),online_window_seconds:75,
      visitors:visitors.map(v=>({name:v.user_name||(v.user_id?'کاربر واردشده':'بازدیدکننده'),page:PAGE_LABELS[v.page]||'سایت',last_seen:v.last_seen}))};
  }
  return {track,summary};
}
module.exports={PAGE_LABELS,normalizeVisit,dayBounds,createVisitorService};
