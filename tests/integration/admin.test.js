const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createAdminRouter } = require('../../server/routes/admin.routes');

let server;
let baseUrl;
const users = [
  { id: 1, displayName: 'Admin One', email: 'admin@example.edu', role: 'admin' },
  { id: 2, displayName: 'Student One', email: 'student@example.edu', role: 'student' },
];
const auditLogs = [];
const repository = {
  async getSummary() {
    return {
      users: { total: 2, organizers: 0, judges: 0, admins: 1 },
      events: 0,
      registrations: { total: 0, registered: 0, waitlisted: 0, attended: 0 },
      judgeAssignments: 0,
    };
  },
  async listUsers({ query = '', role = '' } = {}) {
    return users.filter((user) =>
      (!role || user.role === role)
      && (!query || `${user.displayName} ${user.email}`.toLowerCase().includes(query.toLowerCase())),
    );
  },
  async updateUserRole(actorId, userId, role) {
    if (Number(actorId) === Number(userId)) {
      const error = new Error('You cannot change your own administrator role.');
      error.statusCode = 409;
      throw error;
    }
    const user = users.find((item) => item.id === Number(userId));
    if (!user) return null;
    const from = user.role;
    user.role = role;
    if (from !== role) auditLogs.push({ actorId, userId: user.id, from, to: role });
    return user;
  },
  async listEvents() { return []; },
  async listRegistrations() { return []; },
  async getReports() { return []; },
  async listAuditLogs() { return auditLogs; },
  async getSettings() { return { database: 'test', roles: [], supportedRoles: ['student', 'organizer', 'judge', 'admin'] }; },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in is required.' });
    return;
  }
  request.authUser = {
    id: userId,
    role: request.get('x-test-role') || 'student',
  };
  next();
}

function requireSameOrigin(request, response, next) {
  if (!isSameOrigin(request)) {
    response.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }
  next();
}

function headers(userId, role = 'admin', origin = baseUrl) {
  return {
    'x-test-user': String(userId),
    'x-test-role': role,
    Origin: origin,
    'Content-Type': 'application/json',
  };
}

before(async () => {
  users[0].role = 'admin';
  users[1].role = 'student';
  auditLogs.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRouter({
    repository,
    requireAuthenticated,
    requireSameOrigin,
  }));
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ error: error.message });
  });
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('requires administrator access on admin APIs', async () => {
  const anonymous = await fetch(`${baseUrl}/api/admin/summary`);
  assert.equal(anonymous.status, 401);

  const student = await fetch(`${baseUrl}/api/admin/summary`, {
    headers: headers(2, 'student'),
  });
  assert.equal(student.status, 403);

  const admin = await fetch(`${baseUrl}/api/admin/summary`, {
    headers: headers(1),
  });
  assert.equal(admin.status, 200);
  assert.equal((await admin.json()).summary.users.total, 2);
});

test('filters users, validates role updates, and requires same-origin mutations', async () => {
  const filtered = await fetch(`${baseUrl}/api/admin/users?role=student&q=Student`, {
    headers: headers(1),
  });
  assert.equal((await filtered.json()).users.length, 1);

  const invalidFilter = await fetch(`${baseUrl}/api/admin/users?role=superuser`, {
    headers: headers(1),
  });
  assert.equal(invalidFilter.status, 400);

  const invalidRole = await fetch(`${baseUrl}/api/admin/users/2/role`, {
    method: 'PATCH',
    headers: headers(1),
    body: JSON.stringify({ role: 'superuser' }),
  });
  assert.equal(invalidRole.status, 400);

  const crossOrigin = await fetch(`${baseUrl}/api/admin/users/2/role`, {
    method: 'PATCH',
    headers: headers(1, 'admin', 'https://other.example'),
    body: JSON.stringify({ role: 'organizer' }),
  });
  assert.equal(crossOrigin.status, 403);

  const changed = await fetch(`${baseUrl}/api/admin/users/2/role`, {
    method: 'PATCH',
    headers: headers(1),
    body: JSON.stringify({ role: 'organizer' }),
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).user.role, 'organizer');
  assert.equal(auditLogs.length, 1);

  const selfChange = await fetch(`${baseUrl}/api/admin/users/1/role`, {
    method: 'PATCH',
    headers: headers(1),
    body: JSON.stringify({ role: 'student' }),
  });
  assert.equal(selfChange.status, 409);
});
