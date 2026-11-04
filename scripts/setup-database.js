require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { getDatabaseConfig } = require('../server/config/database');

async function setupDatabase() {
  if (process.env.EVENTS_DATA_SOURCE !== 'mysql') {
    throw new Error('Set EVENTS_DATA_SOURCE=mysql in .env before running database setup.');
  }

  const { host, port, user, password, database } = getDatabaseConfig();
  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  try {
    const schema = await fs.readFile(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    const seed = await fs.readFile(path.join(__dirname, '..', 'database', 'seed.sql'), 'utf8');

    await connection.query(schema);
    const [passwordHashColumns] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'`,
      [database],
    );
    if (passwordHashColumns.length === 0) {
      await connection.query(
        'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER display_name',
      );
    }

    const [organizerColumns] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'organizer_id'`,
      [database],
    );
    if (organizerColumns.length === 0) {
      await connection.query(
        'ALTER TABLE events ADD COLUMN organizer_id BIGINT UNSIGNED NULL AFTER event_id',
      );
      await connection.query(
        'ALTER TABLE events ADD KEY idx_events_organizer (organizer_id)',
      );
      await connection.query(
        'ALTER TABLE events ADD CONSTRAINT fk_events_organizer FOREIGN KEY (organizer_id) REFERENCES users (user_id) ON DELETE SET NULL',
      );
    }

    const [resultsPublishedColumns] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'results_published_at'`,
      [database],
    );
    if (resultsPublishedColumns.length === 0) {
      await connection.query(
        'ALTER TABLE events ADD COLUMN results_published_at DATETIME(3) NULL COMMENT \'UTC\' AFTER organizer_id',
      );
    }

    const [notificationTypeColumns] = await connection.execute(
      `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'notification_type'`,
      [database],
    );
    if (
      notificationTypeColumns.length > 0
      && !notificationTypeColumns[0].COLUMN_TYPE.includes("'results_published'")
    ) {
      await connection.query(
        `ALTER TABLE notifications
         MODIFY COLUMN notification_type ENUM(
           'registration_confirmed',
           'waitlisted',
           'registration_cancelled',
           'waitlist_promoted',
           'results_published'
         ) NOT NULL`,
      );
    }

    await connection.query(seed);
    console.log('Database schema and sample events are ready.');
  } finally {
    await connection.end();
  }
}

setupDatabase().catch((error) => {
  console.error('Database setup failed:', error);
  process.exitCode = 1;
});
