const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDigits, isValidCardNumber, protectCardNumber, revealCardNumber, publicCard } = require('../lib/bankCards');

test('normalizes Persian digits and validates a card with Luhn', () => {
  assert.equal(normalizeDigits('۶۲۷۴-۱۲۹۰-۰۰۰۰-۰۰۰۳'), '6274129000000003');
  assert.equal(isValidCardNumber('6274129000000003'), true);
  assert.equal(isValidCardNumber('1111111111111111'), false);
});

test('encrypts card and only returns a masked public value', () => {
  process.env.CARD_ENCRYPTION_KEY = 'test-only-card-encryption-secret';
  const protectedCard = protectCardNumber('6274129000000003');
  assert.equal(revealCardNumber({ encrypted_number:protectedCard.encryptedNumber,number_iv:protectedCard.iv,number_tag:protectedCard.tag }), '6274129000000003');
  const exposed = publicCard({ id:1,last4:protectedCard.last4,title:'اصلی' });
  assert.equal(exposed.masked_number, '****-****-****-0003');
  assert.equal(JSON.stringify(exposed).includes('62741290'), false);
});
