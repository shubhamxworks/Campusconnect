const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createMyEventsRouter } = require('../../server/routes/my-events.routes');

let server;
let baseUrl;
const requestedUserIds = [];

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in to view your events.' });
    return;
  }
  request.authUser = { id: userId };
  next();
}

before(async () => {
  const app = express();
  app.use(
    '/api/my-events',
    createMyEventsRouter({
      repository: {
        async listForUser(userId) {
          requestedUserIds.push(userId);
          return [{
            id: 'test-event',
            registration: { status: 'waitlisted' },
          }];
        },
      },
      requireAuthenticated,
    }),
  );
  app.use(
    '/api/no-postgres',
    createMyEventsRouter({
      repository: null,
      requireAuthenticated,
    }),
  );
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

test('requires authentication and only returns the signed-in user’s events', async () => {
  const anonymous = await fetch(`${baseUrl}/api/my-events`);
  assert.equal(anonymous.status, 401);

  const response = await fetch(`${baseUrl}/api/my-events`, {
    headers: { 'x-test-user': '17' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    events: [{ id: 'test-event', registration: { status: 'waitlisted' } }],
  });
  assert.deepEqual(requestedUserIds, [17]);
});

test('reports when PostgreSQL-backed registrations are unavailable', async () => {
  const response = await fetch(`${baseUrl}/api/no-postgres`, {
    headers: { 'x-test-user': '17' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Your event registrations require PostgreSQL to be configured.',
  });
});
