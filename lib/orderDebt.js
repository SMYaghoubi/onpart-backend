const { getCanonicalUserDebt, reconcileUserOrderDebts } = require('./debtReconciliation');

async function syncUserDebt(connection, userId) {
  await reconcileUserOrderDebts(connection, userId);
  const debt = await getCanonicalUserDebt(connection, userId);
  await connection.execute('UPDATE users SET debt=? WHERE id=?', [debt, userId]);
  return debt;
}

module.exports = { syncUserDebt };

