function parseBankAccounts(value){
  if(Array.isArray(value))return value;
  try{const parsed=JSON.parse(String(value||'[]'));return Array.isArray(parsed)?parsed:[]}catch(_){return []}
}
function isStoredLogoUrl(value){return /^\/uploads\/bank-logo-[A-Za-z0-9._%-]+$/.test(String(value||''))}
function normalizeBankAccountsForStorage(value){
  return parseBankAccounts(value).map(account=>({
    name:String(account.name||'').trim(),owner:String(account.owner||'').trim(),
    card:String(account.card||'').trim(),account:String(account.account||'').trim(),sheba:String(account.sheba||'').trim(),
    logo:isStoredLogoUrl(account.logo)?String(account.logo):''
  }))
}
function publicBankAccounts(value){return normalizeBankAccountsForStorage(value)}
module.exports={parseBankAccounts,isStoredLogoUrl,normalizeBankAccountsForStorage,publicBankAccounts};