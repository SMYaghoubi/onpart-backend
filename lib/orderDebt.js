async function syncUserDebt(connection, userId) {
  const [[row]] = await connection.execute(
    'SELECT COALESCE(SUM(debt_remaining),0) debt FROM orders WHERE user_id=?',
    [userId]
  );
  const debt = Math.max(0, Number(row && row.debt) || 0);
  await connection.execute('UPDATE users SET debt=? WHERE id=?', [debt, userId]);
  return debt;
}

module.exports = { syncUserDebt };

