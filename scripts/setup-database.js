require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { getDatabaseConfig } = require('../server/config/database');

async function setupDatabase() {
  if (process.env.EVENTS_DATA_SOURCE !== 'postgres') {
    throw new Error('Set EVENTS_DATA_SOURCE=postgres before running database setup.');
  }

  const client = new Client(getDatabaseConfig());
  await client.connect();
  try {
    const schema = await fs.readFile(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    const seed = await fs.readFile(path.join(__dirname, '..', 'database', 'seed.sql'), 'utf8');

    await client.query(schema);
    await client.query(seed);
    console.log('PostgreSQL schema and sample events are ready.');
  } finally {
    await client.end();
  }
}

setupDatabase().catch((error) => {
  console.error('Database setup failed:', error);
  process.exitCode = 1;
});
