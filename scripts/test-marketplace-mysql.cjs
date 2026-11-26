// Disposable local MySQL only. Tests separately verify this server's identity before creating their schemas.
const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const mysql=require('mysql2/promise');
const binary=process.env.ONPART_TEST_MYSQL_BIN;
if(!binary||!path.isAbsolute(binary))throw Error('Set ONPART_TEST_MYSQL_BIN to an absolute local mysqld path. Production connection settings are never used.');
const run=(cmd,args,options={})=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit',...options});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error(cmd+' exited '+code)));});
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'onpart-market-mysql-'));
 const env={...process.env};if(process.env.ONPART_TEST_MYSQL_LIB_DIR)env.LD_LIBRARY_PATH=process.env.ONPART_TEST_MYSQL_LIB_DIR+(env.LD_LIBRARY_PATH?':'+env.LD_LIBRARY_PATH:'');
 const common=['--no-defaults','--basedir='+path.dirname(path.dirname(binary)),'--datadir='+directory,'--log-error='+path.join(directory,'mysql.log')];
 let server;
 try{
  await run(binary,[...common,'--initialize-insecure'],{env});
  server=spawn(binary,[...common,'--socket=','--pid-file='+path.join(directory,'mysql.pid'),'--port=33078','--bind-address=127.0.0.1','--server-id=760023','--mysqlx=OFF'],{env,stdio:'inherit'});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
   try{const c=await mysql.createConnection({host:'127.0.0.1',port:33078,user:'root',password:''});const [[row]]=await c.query('SELECT @@server_id id');await c.end();if(Number(row.id)!==760023)throw Error('Another server owns the disposable test port');ready=true;break;}
   catch(error){if(server.exitCode!=null)throw Error('Disposable MySQL startup failed');await new Promise(resolve=>setTimeout(resolve,500));}
  }
  if(!ready)throw Error('Disposable MySQL did not become ready');
  await run(process.execPath,['--test','test/marketplace.mysql.test.js','test/supplierOrders.mysql.test.js','test/brandCatalog.mysql.test.js'],{cwd:path.join(__dirname,'..'),env:{...env,ONPART_MARKET_TEST_MYSQL:'1',ONPART_ORDERS_TEST_MYSQL:'1',ONPART_BRAND_TEST_MYSQL:'1'}});
 }finally{
  if(server){server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!=null?resolve():server.once('exit',resolve));}
  await fs.rm(directory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
