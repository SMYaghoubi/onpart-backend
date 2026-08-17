const TRANSIENT_DB_CODES=new Set([
  'PROTOCOL_CONNECTION_LOST','ECONNRESET','ETIMEDOUT','EPIPE',
  'ER_SERVER_SHUTDOWN','ER_CON_COUNT_ERROR','ER_LOCK_WAIT_TIMEOUT'
]);

function isTransientDatabaseError(error){
  if(!error)return false;
  if(error.fatal||TRANSIENT_DB_CODES.has(error.code))return true;
  return /connection.*(?:closed|lost|reset)|server has gone away|read ECONNRESET|connect ETIMEDOUT/i.test(String(error.message||''));
}

const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function executeWithRetry(connection,sql,params=[],{attempts=3,baseDelayMs=120,waitFn=wait}={}){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await connection.execute(sql,params)}
    catch(error){
      lastError=error;
      if(attempt>=attempts||!isTransientDatabaseError(error))throw error;
      await waitFn(baseDelayMs*attempt);
    }
  }
  throw lastError;
}

module.exports={TRANSIENT_DB_CODES,isTransientDatabaseError,executeWithRetry};
