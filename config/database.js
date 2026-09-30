const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: ['DATE'],
});

// mysql2's timezone controls JS conversion, not the MySQL session timezone.
// Queue this first on every new connection so timestamps are UTC end to end.
// DATE fields (such as pay_date) stay calendar strings, without a time shift.
pool.on('connection', connection => {
  connection.query("SET time_zone = '+00:00'", error => {
    if(error){
      console.error('Database timezone initialization failed:', error.message);
      connection.destroy();
    }
  });
});

// Test connection
pool.getConnection()
  .then(conn => {
    console.log('✅ Database connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

module.exports = pool;
