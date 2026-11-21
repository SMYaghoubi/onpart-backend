function normalizeSupplierPhone(value) {
  return String(value || '').replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) & 15))
    .replace(/[\s-]/g, '');
}

const supplierPhoneSql = "REPLACE(REPLACE(TRIM(mobile),' ',''),'-','')";

async function registerSupplier(db, application) {
  const mobile = normalizeSupplierPhone(application.mobile);
  if (!/^09\d{9}$/.test(mobile)) throw Object.assign(new Error('شماره همراه نامعتبر است'), { status:400 });
  const conn = await db.getConnection();
  const lock = 'onpart:supplier:' + mobile;
  let locked = false;
  try {
    const [[result]] = await conn.execute('SELECT GET_LOCK(?,5) locked', [lock]);
    locked = Number(result.locked) === 1;
    if (!locked) throw Object.assign(new Error('درخواست هم‌زمان در حال بررسی است؛ دوباره تلاش کنید'), { status:409 });
    await conn.beginTransaction();
    const [existing] = await conn.execute(
      `SELECT id,status FROM suppliers WHERE ${supplierPhoneSql}=? FOR UPDATE`, [mobile]
    );
    if (existing.length) {
      throw Object.assign(new Error('برای این شماره درخواست همکاری ثبت شده است؛ از همان حساب استفاده یا با پشتیبانی پیگیری کنید'), { status:409 });
    }
    const [[linkedUser]] = await conn.execute(
      'SELECT u.id FROM users u WHERE TRIM(u.phone)=? AND NOT EXISTS(SELECT 1 FROM suppliers linked WHERE linked.user_id=u.id) LIMIT 1', [mobile]
    );
    const fields = ['company','type','name','mobile','city','province','address','email','phone','website',
      'reg_number','year','inventory','shipping','description','categories','brands'];
    const values = fields.map(field => field === 'mobile' ? mobile : application[field] || '');
    const [created] = await conn.execute(
      `INSERT INTO suppliers (user_id,${fields.join(',')},status) VALUES (${Array(19).fill('?').join(',')})`,
      [linkedUser?.id || null, ...values, 'pending']
    );
    await conn.commit();
    return { id:created.insertId, mobile };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (locked) await conn.execute('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    conn.release();
  }
}

module.exports = { normalizeSupplierPhone, supplierPhoneSql, registerSupplier };
