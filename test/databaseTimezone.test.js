const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const mysql=require('mysql2');

test('each database connection initializes UTC before reading timestamps; DATE stays a calendar string', {timeout:10000}, async t=>{
  // Local MySQL protocol fixture: no production database or credentials used.
  const server=mysql.createServer(),sessions=[],connections=[];
  let pool;
  t.after(async()=>{
    if(pool)await pool.end();
    for(const connection of connections)connection.destroy();
    await new Promise(resolve=>server.close(resolve));
  });
  server.on('connection',connection=>{
    connections.push(connection);
    const commands=[];sessions.push(commands);
    connection.on('error',()=>{});
    connection.serverHandshake({protocolVersion:10,serverVersion:'8.0.0-test',connectionId:sessions.length,statusFlags:2,characterSet:45,capabilityFlags:33280,authCallback:(_data,done)=>{done(null);connection.sequenceId=0}});
    const query=sql=>{
      commands.push(sql);
      if(sql.startsWith('SET ')){connection.writeOk();connection.sequenceId=0;return;}
      const fields=[['created_at',mysql.Types.TIMESTAMP],['pay_date',mysql.Types.DATE]].map(([name,type])=>({catalog:'def',schema:'test',table:'fixture',orgTable:'fixture',name,orgName:name,columnType:type,characterSet:45,columnLength:20,flags:0,decimals:0}));
      connection.writeColumns(fields);
      connection.writeTextRow(['2026-09-27 08:05:00','2026-09-27']);
      connection.writeEof();
      connection.sequenceId=0;
    };
    connection.on('query',query);
    connection.on('stmt_prepare',query);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context={require,module:{exports:{}},console:{log(){},error(){}},process:{env:{DB_HOST:'127.0.0.1',DB_PORT:server._server.address().port,DB_USER:'test',DB_NAME:'test'}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../config/database'),'utf8'),context);
  pool=context.module.exports;
  const first=await pool.getConnection(),second=await pool.getConnection();
  for(const connection of [first,second]){
    const [[row]]=await connection.query('SELECT created_at,pay_date FROM fixture');
    assert.equal(row.created_at.toISOString(),'2026-09-27T08:05:00.000Z');
    assert.equal(row.pay_date,'2026-09-27');
    connection.release();
  }
  assert.ok(sessions.length>=2);
  for(const commands of sessions)assert.equal(commands[0],"SET time_zone = '+00:00'");
});
