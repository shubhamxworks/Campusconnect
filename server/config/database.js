const mysql = require('mysql2/promise');

function getDatabaseConfig(env = process.env) {
  const required = ['MYSQL_USER', 'MYSQL_DATABASE'];
  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`MySQL mode requires these environment variables: ${missing.join(', ')}`);
  }

  const port = Number(env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT must be an integer between 1 and 65535.');
  }

  return {
    host: env.MYSQL_HOST || 'localhost',
    port,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE,
  };
}

function createDatabasePool(env = process.env) {
  return mysql.createPool({
    ...getDatabaseConfig(env),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z',
    dateStrings: true,
  });
}

module.exports = { createDatabasePool, getDatabaseConfig };
