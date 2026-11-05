const { Pool } = require('pg');

function getDatabaseConfig(env = process.env) {
  const connectionString = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('PostgreSQL mode requires SUPABASE_DB_URL or DATABASE_URL.');
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }

  return {
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

function createDatabasePool(env = process.env) {
  return new CompatiblePool(new Pool(getDatabaseConfig(env)));
}

class CompatiblePool {
  constructor(pool) {
    this.pool = pool;
  }

  async execute(sql, values = []) {
    return normalizeResult(await this.pool.query(sql, values));
  }

  async getConnection() {
    const client = await this.pool.connect();
    return {
      execute: async (sql, values = []) => normalizeResult(await client.query(sql, values)),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    };
  }
}

function normalizeResult(result) {
  if (result.command === 'SELECT') {
    return [result.rows, result.fields];
  }
  const insertId = result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  return [{
    affectedRows: result.rowCount,
    ...(insertId === undefined ? {} : { insertId }),
    rows: result.rows,
  }, result.fields];
}

module.exports = {
  CompatiblePool,
  createDatabasePool,
  getDatabaseConfig,
  normalizeResult,
};
