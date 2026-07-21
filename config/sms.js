const axios = require('axios');
const db    = require('../config/database');

const SMS = {

  // ── Core: send via sms.ir verify endpoint (service line, bypasses blacklist)
  async sendVerify(phone, templateId, parameters, logMsg) {
    try {
      const res = await axios.post('https://api.sms.ir/v1/send/verify', {
        mobile: phone,
        templateId,
        parameters
      }, {
        headers: { 'x-api-key': process.env.SMS_API_KEY, 'Content-Type': 'application/json' }
      });

      console.log('SMS.ir VERIFY response for', phone, ':', JSON.stringify(res.data));
      const isSuccess = res.data?.status === 1 || res.data?.status === '1';

      await db.execute(
        'INSERT INTO sms_logs (phone, message, type, status) VALUES (?,?,?,?)',
        [phone, logMsg || `template:${templateId}`, 'auto', isSuccess ? 'sent' : 'failed']
      );

      if (!isSuccess) {
        console.error('SMS.ir VERIFY rejected for', phone, ':', res.data?.message);
      }
      return { success: isSuccess };
    } catch (err) {
      console.error('SMS VERIFY error for', phone, ':', err.response?.data ? JSON.stringify(err.response.data) : err.message);
      await db.execute(
        'INSERT INTO sms_logs (phone, message, type, status) VALUES (?,?,?,?)',
        [phone, logMsg || `template:${templateId}`, 'auto', 'failed']
      );
      return { success: false };
    }
  },

  // ── Core: send bulk (for manual/admin SMS only)
  async send(phone, message) {
    try {
      const res = await axios.post('https://api.sms.ir/v1/send/bulk', {
        lineNumber: process.env.SMS_LINE,
        MessageText: message,
        Mobiles: [phone],
      }, {
        headers: { 'X-API-KEY': process.env.SMS_API_KEY, 'Content-Type': 'application/json' }
      });

      console.log('SMS.ir BULK response for', phone, ':', JSON.stringify(res.data));
      const isSuccess = res.data?.status === 1 || res.data?.status === '1';

      await db.execute(
        'INSERT INTO sms_logs (phone, message, type, status) VALUES (?,?,?,?)',
        [phone, message, 'manual', isSuccess ? 'sent' : 'failed']
      );

      return { success: isSuccess };
    } catch (err) {
      console.error('SMS BULK error for', phone, ':', err.response?.data ? JSON.stringify(err.response.data) : err.message);
      await db.execute(
        'INSERT INTO sms_logs (phone, message, type, status) VALUES (?,?,?,?)',
        [phone, message, 'manual', 'failed']
      );
      return { success: false };
    }
  },

  // ── OTP (کد تایید ورود) ─ template: 958559
  async sendOTP(phone) {
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expires = new Date(Date.now() + 2 * 60 * 1000);
    await db.execute('INSERT INTO otps (phone, code, expires_at) VALUES (?,?,?)', [phone, code, expires]);
    await this.sendVerify(phone, 958559, [{ name: 'VERIFICATIONCODE', value: code }], `OTP: ${code}`);
    return code;
  },

  // ── Verify OTP
  async verifyOTP(phone, code) {
    const [rows] = await db.execute(
      'SELECT * FROM otps WHERE phone=? AND code=? AND used=0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
      [phone, code]
    );
    if (!rows.length) return false;
    await db.execute('UPDATE otps SET used=1 WHERE id=?', [rows[0].id]);
    return true;
  },

  // ── فراموشی رمز عبور ─ template: 731947
  async forgotPassword(phone, name, code) {
    return this.sendVerify(phone, 731947, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'VERIFICATIONCODE', value: String(code) }
    ], `فراموشی رمز: ${code}`);
  },

  // ── خوش‌آمدگویی ─ template: 477425
  async welcome(phone, name) {
    return this.sendVerify(phone, 477425, [
      { name: 'FULLNAME', value: name || 'کاربر' }
    ], 'خوش‌آمدگویی');
  },

  // ── در انتظار تایید حساب ─ template: 683845
  async accountPending(phone, name) {
    return this.sendVerify(phone, 683845, [
      { name: 'FULLNAME', value: name || 'کاربر' }
    ], 'در انتظار تایید حساب');
  },

  // ── تایید حساب کاربری ─ template: 290813
  async accountApproved(phone, name) {
    return this.sendVerify(phone, 290813, [
      { name: 'FULLNAME', value: name || 'کاربر' }
    ], 'تایید حساب');
  },

  // ── ثبت سفارش ─ template: 294288
  async orderConfirmed(phone, name, orderId) {
    return this.sendVerify(phone, 294288, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId) }
    ], `ثبت سفارش #${orderId}`);
  },

  // ── تایید سفارش توسط کارشناس ─ template: 957019
  async orderApproved(phone, name, orderId) {
    return this.sendVerify(phone, 957019, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId) }
    ], `تایید سفارش #${orderId}`);
  },

  // ── رد سفارش ─ template: 327126
  async orderRejected(phone, name, orderId) {
    return this.sendVerify(phone, 327126, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId) }
    ], `رد سفارش #${orderId}`);
  },

  // ── آماده‌سازی سفارش ─ template: 635083
  async orderPreparing(phone, name, orderId) {
    return this.sendVerify(phone, 635083, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId) }
    ], `آماده‌سازی سفارش #${orderId}`);
  },

  // ── ثبت فیش بانکی ─ template: 309930
  async paymentSubmitted(phone, name, orderId) {
    return this.sendVerify(phone, 309930, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId || '—') }
    ], `ثبت فیش سفارش #${orderId}`);
  },

  // ── تایید فیش بانکی ─ template: 803626
  async paymentConfirmed(phone, name, orderId) {
    return this.sendVerify(phone, 803626, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId || '—') }
    ], `تایید فیش سفارش #${orderId}`);
  },

  // ── رد فیش بانکی ─ template: 461020
  async paymentRejected(phone, name, orderId) {
    return this.sendVerify(phone, 461020, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId || '—') }
    ], `رد فیش سفارش #${orderId}`);
  },

  // ── ثبت درخواست تامین‌کننده ─ template: 757239
  async supplierRegistered(phone, name, trackId) {
    return this.sendVerify(phone, 757239, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(trackId) }
    ], `ثبت درخواست تامین‌کننده #${trackId}`);
  },

  // ── تایید درخواست تامین‌کننده ─ template: 836043
  async supplierApproved(phone, name, trackId) {
    return this.sendVerify(phone, 836043, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(trackId) }
    ], `تایید تامین‌کننده #${trackId}`);
  },

  // ── رد درخواست تامین‌کننده ─ template: 169108
  async supplierRejected(phone, name, trackId, reason) {
    return this.sendVerify(phone, 169108, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(trackId) },
      { name: 'TITLE', value: reason || 'مشخص نشده' }
    ], `رد تامین‌کننده #${trackId}`);
  },
  async notifyAdmin(settingKey, message) {
    try {
      const [[setting]] = await db.execute('SELECT value FROM settings WHERE `key`=?', [settingKey]);
      if (setting && setting.value === '0') return;
      const [admins] = await db.execute('SELECT phone FROM users WHERE role="admin" AND status="active"');
      for (const admin of admins) {
        await this.send(admin.phone, message);
      }
    } catch (err) {
      console.error('notifyAdmin error:', err.message);
    }
  },

  // ── ارسال با پیک/اسنپ/وانت ─ template: 832628
  async shippingDriver(phone, name, orderId, driverName, driverPhone, vehicle, plate, itemsCount, deliveryCode) {
    const vehicleFa = {motorbike:'موتورسیکلت', car:'خودرو سواری', van:'وانت', truck:'کامیونت', snap:'خودرو سواری'}[vehicle] || vehicle || '—';
    return this.sendVerify(phone, 832628, [
      { name: 'FULLNAME',     value: name || 'کاربر' },
      { name: 'ORDER_NUMBER', value: String(orderId) },
      { name: 'NAME',         value: driverName || '—' },
      { name: 'PHONE',        value: driverPhone || '—' },
      { name: 'TITLE',        value: vehicleFa },
      { name: 'PELAK',        value: plate || '—' },
      { name: 'ITEMS_COUNT',  value: String(itemsCount || 1) },
      { name: 'TOKEN',        value: String(deliveryCode) }
    ], `ارسال سفارش #${orderId}`);
  },

  // ── ارسال با پست/تیپاکس ─ template: 866653
  async shippingPost(phone, name, orderId, trackingCode, method) {
    const methodFa = method === 'tipax' ? 'تیپاکس' : 'پست';
    return this.sendVerify(phone, 866653, [
      { name: 'FULLNAME',      value: name || 'کاربر' },
      { name: 'ORDER_NUMBER',  value: String(orderId) },
      { name: 'SHIPPING_CODE', value: trackingCode || '—' },
      { name: 'TITLE',         value: methodFa }
    ], `ارسال پستی سفارش #${orderId}`);
  },



  // ── تحویل سفارش ─ template: 761075
  async orderDelivered(phone, name, deliveryCode) {
    return this.sendVerify(phone, 761075, [
      { name: 'FULLNAME', value: name || 'کاربر' },
      { name: 'CODE',     value: String(deliveryCode) }
    ], `تحویل سفارش — کد: ${deliveryCode}`);
  },

};

module.exports = SMS;
