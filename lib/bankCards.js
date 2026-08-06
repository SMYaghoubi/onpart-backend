const crypto = require('crypto');

const IRANIAN_BANKS = Object.freeze({
  mellat: 'بانک ملت',
  melli: 'بانک ملی ایران',
  saderat: 'بانک صادرات ایران',
  tejarat: 'بانک تجارت',
  sepah: 'بانک سپه',
  refah: 'بانک رفاه کارگران',
  keshavarzi: 'بانک کشاورزی',
  maskan: 'بانک مسکن',
  tosee_saderat: 'بانک توسعه صادرات',
  post: 'پست بانک ایران',
  tosee_taavon: 'بانک توسعه تعاون',
  pasargad: 'بانک پاسارگاد',
  saman: 'بانک سامان',
  eghtesad_novin: 'بانک اقتصاد نوین',
  karafarin: 'بانک کارآفرین',
  parsian: 'بانک پارسیان',
  sina: 'بانک سینا',
  ayandeh: 'بانک آینده',
  shahr: 'بانک شهر',
  iran_zamin: 'بانک ایران زمین',
  sarmayeh: 'بانک سرمایه',
  dey: 'بانک دی',
  gardeshgari: 'بانک گردشگری',
  khavarmiyaneh: 'بانک خاورمیانه',
  mehr_iran: 'بانک قرض‌الحسنه مهر ایران',
  resalat: 'بانک قرض‌الحسنه رسالت'
});

function normalizeDigits(value) {
  return String(value || '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\D/g, '');
}

function isValidCardNumber(value) {
  const number = normalizeDigits(value);
  if (!/^\d{16}$/.test(number) || /^(\d)\1{15}$/.test(number)) return false;
  let sum = 0;
  for (let index = 0; index < 16; index++) {
    let digit = Number(number[index]);
    if (index % 2 === 0) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

function resolveIranianBank(value) {
  const bankCode = String(value || '').trim().toLowerCase();
  const bankName = IRANIAN_BANKS[bankCode];
  if (!bankName) throw new Error('بانک انتخاب‌شده معتبر نیست');
  return { bankCode, bankName };
}

function encryptionKey() {
  const secret = process.env.CARD_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('CARD_ENCRYPTION_KEY تنظیم نشده است');
  return crypto.createHash('sha256').update(secret).digest();
}

function protectCardNumber(value) {
  const number = normalizeDigits(value);
  if (!isValidCardNumber(number)) throw new Error('شماره کارت معتبر نیست');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(number, 'utf8'), cipher.final()]);
  return { encryptedNumber: encrypted.toString('base64'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), fingerprint: crypto.createHmac('sha256', encryptionKey()).update(number).digest('hex'), last4: number.slice(-4) };
}

function revealCardNumber(row) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.number_iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.number_tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(row.encrypted_number, 'base64')), decipher.final()]).toString('utf8');
}

function publicCard(row) {
  return { id: Number(row.id), title: row.title || '', bank_code: row.bank_code || '', bank_name: row.bank_name || '', last4: row.last4, masked_number: '****-****-****-' + row.last4, created_at: row.created_at };
}

module.exports = { IRANIAN_BANKS, normalizeDigits, isValidCardNumber, resolveIranianBank, protectCardNumber, revealCardNumber, publicCard };
