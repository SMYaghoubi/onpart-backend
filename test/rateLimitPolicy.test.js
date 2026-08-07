const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIdentifier, rateLimitKey, retryAfterSeconds } = require('../lib/rateLimitPolicy');

test('normalizes identifiers and stores only a hash key', () => {
  assert.equal(normalizeIdentifier(' ۰۹۱۲٣٤٥٦٧٨٩ '), '09123456789');
  const key = rateLimitKey('user', { ip: '10.0.0.2', body: { username: 'User@Test.ir' } });
  assert.equal(key.length, 64);
  assert.equal(key.includes('user@test.ir'), false);
});
test('user, admin and supplier buckets stay independent', () => {
  const request = { ip: '10.0.0.2', body: { username: '09120000000' } };
  assert.notEqual(rateLimitKey('admin', request), rateLimitKey('user', request));
  assert.notEqual(rateLimitKey('supplier', request), rateLimitKey('user', request));
  assert.notEqual(rateLimitKey('user', request), rateLimitKey('user', { ...request, body: { username: '09121111111' } }));
});
test('IP backstop ignores rotating identifiers', () => {
  assert.equal(
    rateLimitKey('admin:ip', { ip: '203.0.113.10', body: { username: 'a' } }, false),
    rateLimitKey('admin:ip', { ip: '203.0.113.10', body: { username: 'b' } }, false)
  );
});
test('retry delay uses reset time and safe fallback', () => {
  assert.ok(retryAfterSeconds({ rateLimit: { resetTime: new Date(Date.now() + 2200) } }, 900000) <= 3);
  assert.equal(retryAfterSeconds({}, 900000), 900);
});