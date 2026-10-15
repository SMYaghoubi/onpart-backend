const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeVisit,dayBounds,createVisitorService}=require('../lib/siteVisitors');
const body={visitor_id:'12345678-1234-4234-8234-123456789012',view_id:'12345678-1234-4234-8234-123456789013',page:'/shop',visible:true};
test('tracking accepts only known page names, UUIDs and explicit visibility',()=>{
 assert.equal(normalizeVisit(body).page,'/shop');for(const patch of [{page:'/admin/'},{page:'/shop?token=secret'},{visitor_id:'x'},{visible:'true'}])assert.throws(()=>normalizeVisit({...body,...patch}),e=>e.status===400);
});
test('visitor days and online expiry follow Tehran midnight',()=>{
 const before=dayBounds(new Date('2026-10-14T20:29:59Z')),after=dayBounds(new Date('2026-10-14T20:30:00Z'));
 assert.equal(before.today.toISOString(),'2026-10-13T20:30:00.000Z');assert.equal(after.today.toISOString(),'2026-10-14T20:30:00.000Z');assert.equal(after.week.toISOString(),'2026-10-08T20:30:00.000Z');assert.equal(after.online.toISOString(),'2026-10-14T20:28:45.000Z');
});
test('heartbeats share a page-view key, hash browser ids, and create a fresh daily row after midnight',async()=>{
 const inserts=[];let now=new Date('2026-10-14T20:29:59Z'),schemas=0;const db={execute:async(sql,p)=>{if(sql.startsWith('INSERT'))inserts.push({sql,p});if(sql.startsWith('CREATE'))schemas++;return [{}];}};
 const service=createVisitorService(db,{secret:'fixture',clock:()=>now});await service.track(body,4);await service.track(body,4);now=new Date('2026-10-14T20:30:00Z');await service.track(body,4);
 assert.equal(schemas,1);assert.equal(inserts[0].p[0],inserts[1].p[0]);assert.notEqual(inserts[0].p[2],body.visitor_id);assert.equal(inserts[0].p[1],'2026-10-14');assert.equal(inserts[2].p[1],'2026-10-15');assert.match(inserts[0].sql,/ON DUPLICATE KEY UPDATE/);
});
test('summary uses distinct browsers and active visible rows, without returning ids or phone numbers',async()=>{
 const queries=[];const db={execute:async(sql)=>{queries.push(sql);if(sql.startsWith('CREATE'))return [{}];if(sql.includes('visitors_today'))return [[{visitors_today:2,pageviews_today:5,visitors_week:3}]];if(sql.includes('AS_NEVER'))throw Error();if(sql.startsWith('SELECT COUNT'))return [[{online:1}]];return [[{user_name:'Fixture',user_id:4,page:'/shop',last_seen:'2026-10-14 08:00:00'}]];}};
 const result=await createVisitorService(db,{secret:'fixture'}).summary();assert.equal(result.online,1);assert.equal(result.pageviews_today,5);assert.equal(result.visitors[0].page,'فروشگاه');assert.equal(result.visitors[0].user_id,undefined);assert.ok(queries.some(q=>q.includes('visible=1 AND last_seen>=?')));assert.ok(queries.some(q=>q.includes('COUNT(DISTINCT visitor_key)')));
});
