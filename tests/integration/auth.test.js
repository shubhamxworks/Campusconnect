const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createAuthRouter } = require('../../server/routes/auth.routes');
const { hashPassword, verifyPassword } = require('../../server/utils/password');

const users = new Map();
const sessions = new Map();
let nextUserId = 1;
let server;
let baseUrl;
let auth;

const userRepository = {
  async findById(id) {
    const user = [...users.values()].find((item) => item.id === Number(id));
    if (!user) {
      return null;
    }
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
  },
  async updateDisplayName(id, displayName) {
    const user = [...users.values()].find((item) => item.id === Number(id));
    if (!user) {
      return null;
    }
    user.displayName = displayName;
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
  },
  async findByEmailForLogin(email) {
    return users.get(email) ?? null;
  },
  async createLocalUser({ email, displayName, passwordHash }) {
    if (users.has(email)) {
      const error = new Error('Duplicate email');
      error.code = '23505';
      throw error;
    }
    const user = {
      id: nextUserId++,
      email,
      displayName,
      role: 'student',
      passwordHash,
    };
    users.set(email, user);
    return { id: user.id, email, displayName, role: 'student' };
  },
};

const sessionPool = {
  async execute(sql, values) {
    if (sql.startsWith('INSERT INTO user_sessions')) {
      sessions.set(values[0], { session_data: values[2], expires_at: values[1] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT session_data')) {
      const row = sessions.get(values[0]);
      return [row ? [row] : []];
    }
    if (sql.startsWith('UPDATE user_sessions')) {
      const row = sessions.get(values[1]);
      if (row) {
        row.expires_at = values[0];
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('DELETE FROM user_sessions')) {
      sessions.delete(values[0]);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected session query: ${sql}`);
  },
};

before(async () => {
  users.clear();
  sessions.clear();
  nextUserId = 1;

  const app = express();
  app.use(express.json());
  auth = createAuthRouter({
    env: {
      EVENTS_DATA_SOURCE: 'postgres',
      DATABASE_URL: 'postgresql://test-user:test-password@localhost:5432/test-database',
      SESSION_SECRET: 'test-session-secret-with-more-than-thirty-two-characters',
    },
    pool: sessionPool,
    userRepository,
  });
  app.use(auth.middleware);
  app.use('/api/auth', auth.router);
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  auth.store.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function sameOriginHeaders() {
  return {
    Origin: baseUrl,
    'Content-Type': 'application/json',
  };
}

function sessionCookie(response) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('campusconnect.sid='));
  assert.ok(cookie, 'expected a session cookie');
  return cookie.split(';', 1)[0];
}

test('creates an account, stores only a password hash, and establishes a session', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: sameOriginHeaders(),
    body: JSON.stringify({
      displayName: '  Campus Student  ',
      email: 'STUDENT@example.edu',
      password: 'a-strong-local-password',
      role: 'admin',
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(result.user, {
    id: 1,
    email: 'student@example.edu',
    displayName: 'Campus Student',
    role: 'student',
  });
  assert.equal(JSON.stringify(result).includes('passwordHash'), false);

  const storedUser = users.get('student@example.edu');
  assert.notEqual(storedUser.passwordHash, 'a-strong-local-password');
  assert.equal(await verifyPassword('a-strong-local-password', storedUser.passwordHash), true);

  const cookie = sessionCookie(response);
  const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.deepEqual((await meResponse.json()).user, result.user);
});

test('rejects duplicate accounts, bad credentials, weak passwords, and cross-origin requests', async () => {
  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: sameOriginHeaders(),
    body: JSON.stringify({
      displayName: 'Another Student',
      email: 'student@example.edu',
      password: 'another-strong-password',
    }),
  });
  assert.equal(duplicate.status, 409);

  const weakPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: sameOriginHeaders(),
    body: JSON.stringify({
      displayName: 'Student',
      email: 'new@example.edu',
      password: 'short',
    }),
  });
  assert.equal(weakPassword.status, 400);

  const wrongOrigin = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { ...sameOriginHeaders(), Origin: 'https://other.example' },
    body: JSON.stringify({
      displayName: 'Student',
      email: 'new@example.edu',
      password: 'a-strong-local-password',
    }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(users.has('new@example.edu'), false);

  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: sameOriginHeaders(),
    body: JSON.stringify({ email: 'student@example.edu', password: 'incorrect-password' }),
  });
  assert.equal(badLogin.status, 401);
  assert.deepEqual(await badLogin.json(), { error: 'Email or password is incorrect.' });
});

test('signs in, verifies the session, and signs out', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: sameOriginHeaders(),
    body: JSON.stringify({
      email: 'STUDENT@example.edu',
      password: 'a-strong-local-password',
    }),
  });
  const result = await login.json();
  assert.equal(login.status, 200);
  assert.equal(result.user.email, 'student@example.edu');
  const cookie = sessionCookie(login);

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await meResponse.json()).user.id, result.user.id);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookie },
  });
  assert.equal(logout.status, 204);

  const afterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.deepEqual((await afterLogout.json()).user, null);
});

test('reads and updates the authenticated profile with validated display names', async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/auth/profile`, {
    method: 'PATCH',
    headers: sameOriginHeaders(),
    body: JSON.stringify({ displayName: 'Updated Student' }),
  });
  assert.equal(unauthenticated.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: sameOriginHeaders(),
    body: JSON.stringify({
      email: 'student@example.edu',
      password: 'a-strong-local-password',
    }),
  });
  const cookie = sessionCookie(login);

  const missingOrigin = await fetch(`${baseUrl}/api/auth/profile`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Updated Student' }),
  });
  assert.equal(missingOrigin.status, 403);

  for (const displayName of ['', '   ', 'x'.repeat(121), 42]) {
    const invalid = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: { ...sameOriginHeaders(), Cookie: cookie },
      body: JSON.stringify({ displayName }),
    });
    assert.equal(invalid.status, 400);
  }

  const update = await fetch(`${baseUrl}/api/auth/profile`, {
    method: 'PATCH',
    headers: { ...sameOriginHeaders(), Cookie: cookie },
    body: JSON.stringify({ displayName: '  Updated Student  ' }),
  });
  assert.equal(update.status, 200);
  assert.deepEqual((await update.json()).user, {
    id: 1,
    email: 'student@example.edu',
    displayName: 'Updated Student',
    role: 'student',
  });
  assert.equal(users.get('student@example.edu').displayName, 'Updated Student');
});
