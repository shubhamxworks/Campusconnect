const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getGoogleOAuthConfig } = require('../../../server/config/passport');
const { createAuthRouter } = require('../../../server/routes/auth.routes');
const { MySqlSessionStore } = require('../../../server/storage/mysql-session-store');
const { createUserRepository } = require('../../../server/repositories/user.repository');
const { hashPassword, verifyPassword } = require('../../../server/utils/password');

test('Google OAuth stays disabled until both credentials are configured', () => {
  assert.equal(getGoogleOAuthConfig({}), null);
  assert.throws(
    () => getGoogleOAuthConfig({ GOOGLE_CLIENT_ID: 'client-id' }),
    /requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/,
  );
  assert.throws(
    () => createAuthRouter({
      env: {
        EVENTS_DATA_SOURCE: 'mysql',
        MYSQL_USER: 'campusconnect',
        MYSQL_DATABASE: 'campusconnect',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        SESSION_SECRET: 'too-short',
      },
    }),
    /SESSION_SECRET must contain at least 32 characters/,
  );

  const config = getGoogleOAuthConfig({
    PORT: '3000',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: 'a'.repeat(48),
  });
  assert.equal(config.callbackURL, 'http://localhost:3000/api/auth/google/callback');
});

test('hashes passwords with unique salts and verifies only the matching password', async () => {
  const firstHash = await hashPassword('a-long-unique-password');
  const secondHash = await hashPassword('a-long-unique-password');

  assert.notEqual(firstHash, secondHash);
  assert.match(firstHash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('a-long-unique-password', firstHash), true);
  assert.equal(await verifyPassword('a-different-password', firstHash), false);
  assert.equal(await verifyPassword('a-long-unique-password', 'invalid-hash'), false);
  await assert.rejects(hashPassword('short'), /between 12 and 128 characters/);
});

test('requires a verified email before creating a Google-linked student account', async () => {
  let connectionRequested = false;
  const repository = createUserRepository({
    async getConnection() {
      connectionRequested = true;
    },
  });

  await assert.rejects(
    repository.findOrCreateFromGoogle({
      subject: 'google-subject',
      email: 'student@example.edu',
      displayName: 'Student',
      emailVerified: false,
    }),
    /verified Google email/,
  );
  assert.equal(connectionRequested, false);
});

test('stores, reads, and destroys sessions using parameterized MySQL queries', async () => {
  const rows = new Map();
  const calls = [];
  const pool = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('INSERT INTO user_sessions')) {
        rows.set(values[0], { session_data: values[2], expires_at: values[1] });
      } else if (sql.startsWith('SELECT session_data')) {
        const row = rows.get(values[0]);
        return [row ? [row] : []];
      } else if (sql.startsWith('DELETE FROM user_sessions')) {
        rows.delete(values[0]);
      }
      return [{ affectedRows: 1 }];
    },
  };
  const store = new MySqlSessionStore(pool, { pruneInterval: 60_000 });

  try {
    const data = { cookie: { maxAge: 60_000 }, passport: { user: 7 } };
    await new Promise((resolve, reject) => {
      store.set('session-id', data, (error) => (error ? reject(error) : resolve()));
    });

    const fetched = await new Promise((resolve, reject) => {
      store.get('session-id', (error, value) => (error ? reject(error) : resolve(value)));
    });
    assert.deepEqual(fetched, data);
    assert.match(calls[0].sql, /VALUES \(\?, \?, \?\)/);
    assert.deepEqual(calls[0].values.filter((value) => typeof value === 'string'), [
      'session-id',
      JSON.stringify(data),
    ]);

    await new Promise((resolve, reject) => {
      store.destroy('session-id', (error) => (error ? reject(error) : resolve()));
    });
    assert.equal(rows.has('session-id'), false);
  } finally {
    store.close();
  }
});
