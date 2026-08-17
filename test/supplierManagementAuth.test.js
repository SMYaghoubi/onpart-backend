const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {isManagementRole,managementAccessStatus}=require('../lib/managementAccess');

test('supplier token is denied management APIs with 403',()=>{
  assert.equal(managementAccessStatus('supplier',null,false),403);
});

test('admin and partner are allowed while regular or missing management sessions are rejected',()=>{
  assert.equal(managementAccessStatus('admin','admin',true),200);
  assert.equal(managementAccessStatus('partner','partner',true),200);
  assert.equal(managementAccessStatus('user','user',true),403);
  assert.equal(managementAccessStatus(null,null,false),401);
  assert.equal(isManagementRole('admin'),true);
  assert.equal(isManagementRole('partner'),true);
  assert.equal(isManagementRole('supplier'),false);
});

test('adminAuth enforces supplier denial and stored admin or partner role',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','middleware','auth.js'),'utf8');
  const adminStart=source.indexOf('const adminAuth');
  const tokenDecision=source.indexOf('managementTokenStatus(decoded.role',adminStart);
  const userLookup=source.indexOf('getUser(decoded.id, { fresh: true })',adminStart);
  assert.ok(tokenDecision>adminStart&&tokenDecision<userLookup);
  assert.match(source.slice(adminStart),/managementStoredRoleStatus\(user\.role\)/);
  assert.match(source.slice(adminStart),/res\.status\(403\)/);
});

test('all supplier management scope and update endpoints retain adminAuth',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','routes','supplierPortal.js'),'utf8');
  for(const route of [
    "router.get('/admin/scope-options', adminAuth",
    "router.get('/admin/suppliers/:id/scopes', adminAuth",
    "router.put('/admin/suppliers/:id/scopes', adminAuth",
    "router.get('/admin/updates', adminAuth",
    "router.get('/admin/updates/:id', adminAuth",
    "router.patch('/admin/updates/:batchId/items/:itemId', adminAuth",
    "router.post('/admin/updates/:id/approve', adminAuth",
    "router.delete('/admin/updates/:id', adminAuth",
    "router.post('/admin/updates/:id/reject', adminAuth"
  ]) assert.ok(source.includes(route),route);
});