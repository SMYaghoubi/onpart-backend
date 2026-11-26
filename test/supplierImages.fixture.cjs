const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
function load(file,mocks={}){
  const filename=path.join(__dirname,'..',file),module={exports:{}},native=createRequire(filename);
  new Function('require','module','exports','__filename','__dirname',fs.readFileSync(filename,'utf8'))(
    name=>Object.hasOwn(mocks,name)?mocks[name]:native(name),module,module.exports,filename,path.dirname(filename));
  return module.exports;
}
function database(){
  const state={suppliers:[{id:1,status:'approved',portal_enabled:1,company:'test one'},{id:2,status:'approved',portal_enabled:1,company:'test two'},{id:3,status:'pending',portal_enabled:0}],users:[{id:9,role:'admin',status:'active'},{id:8,role:'user',status:'active'}],products:[{id:10,code:'EX-10',description:'existing test',brand:'خاتم',price:70000,stock:1,status:'active',image:'/uploads/existing-photo.webp',supplier_price:60000,quantity:8,supplier_available:1}],photos:[],batches:[],newItems:[],items:[],keys:[]};
  const sqlLog=[];let failImageUpdate=false,failCommit=false;
  function executor(current){return async(sql,p=[])=>{
    const s=sql.replace(/\s+/g,' ').trim().toLowerCase();sqlLog.push({sql:s,params:p});
    const rows=v=>[structuredClone(v)];
    if(s.startsWith('select r.quantity from market_reservations'))return rows([]);
    if(s.startsWith('create table'))return [{affectedRows:0}];
    const photoFor=(batch,id,isNew=false)=>current.photos.find(x=>x.batch_id===Number(batch)&&(isNew?x.new_product_id===id:x.product_id===id&&x.new_product_id==null))?.id;
    const batchView=b=>({...b,company:current.suppliers.find(x=>x.id===b.supplier_id)?.company,submitted_at:'2026-11-22T10:00:00Z',item_count:current.items.filter(x=>x.batch_id===b.id).length+current.newItems.filter(x=>x.batch_id===b.id).length});
    if(s.startsWith('select p.id,coalesce(inv.manufacturer_code'))return rows(current.products.map(x=>({...x,available:x.supplier_available??x.stock>0})));
    if(s.startsWith('select n.id,n.batch_id'))return rows(current.newItems.filter(n=>current.batches.some(b=>b.id===n.batch_id&&b.supplier_id===p[0]&&b.status==='pending')).map(n=>({...n,image_id:photoFor(n.batch_id,n.id,true)})));
    if(s.startsWith('select b.id,b.status,b.source'))return rows(current.batches.filter(b=>b.supplier_id===p[0]).map(batchView));
    if(s.startsWith('select b.*,s.company,s.name,s.mobile'))return rows(current.batches.filter(b=>!p.length||b.status===p[0]).map(batchView));
    if(s.startsWith('select b.*,s.company,s.name from'))return rows(current.batches.filter(b=>b.id===Number(p[0])).map(batchView));
    if(s.startsWith('select id,status,submitted_at,reviewed_at,note from supplier_update_batches'))return rows(current.batches.filter(b=>b.id===Number(p[0])&&b.supplier_id===p[1]).map(batchView));
    if(s.startsWith('select coalesce(inv.manufacturer_code')||s.startsWith('select i.*,p.code,p.description'))return rows(current.items.filter(x=>x.batch_id===Number(p.at(-1))).map(x=>{const product=current.products.find(y=>y.id===x.product_id);return {...x,code:product.code,description:product.description,brand:product.brand,current_price:product.price,current_stock:product.stock,current_image:product.image,image_id:photoFor(x.batch_id,x.product_id)};}));
    if(s.startsWith('select n.code,n.description')||s.startsWith('select n.*,im.id image_id'))return rows(current.newItems.filter(x=>x.batch_id===Number(p[0])).map(x=>({...x,image_id:photoFor(x.batch_id,x.id,true)})));
    if(s.startsWith('select error_message from supplier_update_errors')||s.startsWith('select id,source_row,raw_code,error_message'))return rows([]);

    if(s.startsWith('select id,company,name,mobile,status,portal_enabled from suppliers'))return rows(current.suppliers.filter(x=>x.id===Number(p[0])));
    if(s.startsWith('select id,role,status from users'))return rows(current.users.filter(x=>x.id===Number(p[0])));
    if(s.startsWith('select id from suppliers where id='))return rows(current.suppliers.filter(x=>x.id===Number(p[0])));
    if(s.startsWith('select scope_value from supplier_product_scopes'))return rows([{scope_value:'خاتم'}]);
    if(s.startsWith('select batch_id,item_count from supplier_submission_keys'))return rows(current.keys.filter(x=>x.supplier_id===p[0]&&x.key===p[1]));
    if(s.startsWith('insert into supplier_submission_keys')){current.keys.push({supplier_id:p[0],key:p[1],batch_id:p[2],item_count:p[3]});return [{affectedRows:1}];}
    if(s.startsWith('select id from supplier_product_images')&&s.includes('created_at<'))return rows([]);
    if(s.startsWith('select count(*) count from supplier_product_images'))return rows([{count:current.photos.filter(x=>x.supplier_id===p[0]&&x.state==='draft').length}]);
    if(s.startsWith('insert into supplier_product_images')){current.photos.push({id:p[0],supplier_id:p[1],filename:p[2],state:'draft',batch_id:null,product_id:null,new_product_id:null});return [{affectedRows:1}];}
    if(s.startsWith('select im.id from supplier_product_images im join products'))return rows(current.photos.filter(x=>x.id===p[0]&&x.state==='approved'&&current.products.some(y=>y.id===x.product_id&&y.image===p[1]&&y.status==='active')));
    if(s.startsWith('select * from supplier_product_images where id='))return rows(current.photos.filter(x=>x.id===p[0]&&(!s.includes('supplier_id=?')||x.supplier_id===p[1])&&(!s.includes("state='draft'")||x.state==='draft')));
    if(s.startsWith('select id from supplier_product_images where id='))return rows(current.photos.filter(x=>x.id===p[0]&&x.supplier_id===p[1]&&x.state==='draft'));
    if(s.startsWith('delete from supplier_product_images')){current.photos=current.photos.filter(x=>!(x.id===p[0]&&x.supplier_id===p[1]&&x.state==='draft'));return [{affectedRows:1}];}
    if(s.startsWith("update supplier_product_images set state='pending'")){Object.assign(current.photos.find(x=>x.id===p[3]),{state:'pending',batch_id:p[0],product_id:p[1],new_product_id:p[2]});return [{affectedRows:1}];}
    if(s.startsWith("update supplier_product_images set state='approved'")){Object.assign(current.photos.find(x=>x.id===p[1]),{state:'approved',product_id:p[0]});return [{affectedRows:1}];}
    if(s.startsWith("update supplier_product_images set state='rejected'")){current.photos.filter(x=>x.batch_id===Number(p[0])&&x.state==='pending').forEach(x=>x.state='rejected');return [{affectedRows:1}];}
    if(s.startsWith('select im.*,n.product_id resolved_product_id'))return rows(current.photos.filter(x=>x.batch_id===p[0]&&x.supplier_id===p[1]&&x.state==='pending').map(x=>({...x,resolved_product_id:current.newItems.find(n=>n.id===x.new_product_id)?.product_id})));
    if(s.startsWith('select p.id,p.code,p.brand,p.price,p.stock'))return rows(current.products.filter(x=>p.slice(1).includes(x.id)));
    if(s.startsWith('insert into supplier_update_batches')){const id=current.batches.length+1;current.batches.push({id,supplier_id:p[0],source:p[1],status:'pending'});return [{insertId:id}];}
    if(s.startsWith('insert into supplier_update_items')){for(const r of p[0])current.items.push({id:current.items.length+1,batch_id:r[0],product_id:r[1],supplier_price:r[2],proposed_stock:r[3],previous_price:r[4],previous_stock:r[5],note:r[6],status:'pending'});return [{affectedRows:p[0].length}];}
    if(s.startsWith('insert into supplier_new_product_requests')){for(const r of p[0])current.newItems.push({id:current.newItems.length+1,batch_id:r[0],code:r[1],description:r[2],brand:r[3],supplier_price:r[4],quantity:r[5],available:r[6],product_id:null});return [{affectedRows:p[0].length}];}
    if(s.startsWith('select id,code,brand from supplier_new_product_requests')||s.startsWith('select * from supplier_new_product_requests'))return rows(current.newItems.filter(x=>x.batch_id===Number(p[0])));
    if(s.startsWith('select * from supplier_update_batches'))return rows(current.batches.filter(x=>x.id===Number(p[0])));
    if(s.startsWith('select i.*,p.brand,p.status'))return rows(current.items.filter(x=>x.batch_id===p[1]&&x.status==='pending').map(x=>{const product=current.products.find(y=>y.id===x.product_id);return {...x,brand:product.brand,product_status:product.status,current_price:product.price,quantity:product.quantity};}));
    if(s.startsWith('select count(*) count from supplier_update_errors'))return rows([{count:0}]);
    if(s.startsWith('select p.id,p.code,p.brand,p.status'))return rows(current.products.filter(x=>x.code.replace(/-/g,'').toLowerCase()===p[0]||x.manufacturer_code?.replace(/-/g,'').toLowerCase()===p[0]));
    if(s.startsWith('insert into products ')){const id=100+current.products.length;current.products.push({id,code:p[0],description:p[1],brand:p[2],price:0,stock:0,status:'active',image:null});return [{insertId:id}];}
    if(s.startsWith('update products set image=')){if(failImageUpdate)throw new Error('injected image write failure');current.products.find(x=>x.id===p[1]).image=p[0];return [{affectedRows:1}];}
    if(s.startsWith('update products set price=?,stock=?,supplier_id=')){Object.assign(current.products.find(x=>x.id===p[3]),{price:p[0],stock:p[1],supplier_id:p[2]});return [{affectedRows:1}];}
    if(s.startsWith('insert into supplier_inventory')){const x=current.products.find(x=>x.id===p[1]);if(p[2]!=null)x.quantity=p[2];if(p[3]!=null)x.supplier_price=p[3];if(p[4]!=null)x.supplier_available=p[4];if(p[5]!=null)x.manufacturer_code=p[5];return [{affectedRows:1}];}
    if(s.startsWith('update supplier_new_product_requests set product_id=')){current.newItems.find(x=>x.id===p[1]).product_id=p[0];return [{affectedRows:1}];}
    if(s.startsWith('update supplier_update_items set final_price=')){Object.assign(current.items.find(x=>x.id===p[1]),{final_price:p[0],status:'approved'});return [{affectedRows:1}];}
    if(s.startsWith('update supplier_update_batches set status="approved"')){Object.assign(current.batches.find(x=>x.id===p[3]),{status:'approved',markup_percent:p[0]});return [{affectedRows:1}];}
    if(s.startsWith('update supplier_update_batches set status="rejected"')){const x=current.batches.find(x=>x.id===Number(p[2])&&x.status==='pending');if(x)x.status='rejected';return [{affectedRows:x?1:0}];}
    if(s.startsWith('update supplier_update_items set status="rejected"')){current.items.filter(x=>x.batch_id===Number(p[0])).forEach(x=>x.status='rejected');return [{affectedRows:1}];}
    throw new Error('Unhandled fixture SQL: '+s);
  };}
  const db={execute:(...args)=>executor(state)(...args),query:(...args)=>executor(state)(...args),async getConnection(){
    let current=state;
    return {beginTransaction:async()=>{current=structuredClone(state);},execute:(...args)=>executor(current)(...args),query:(...args)=>executor(current)(...args),
      commit:async()=>{if(failCommit)throw new Error('injected commit failure');Object.assign(state,current);},
      rollback:async()=>{current=state;},release(){}};
  }};
  return {db,state,sqlLog,setFailImage:v=>failImageUpdate=v,setFailCommit:v=>failCommit=v};
}
module.exports={load,database};

