const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createNotificationRouter } = require('../../server/routes/notification.routes');
const { isSameOrigin } = require('../../server/routes/auth.routes');

let server;
let baseUrl;
const saved = [];
const removed = [];
const repository = {
  async savePushSubscription(userId, subscription) {
    saved.push({ userId, subscription });
  },
  async removePushSubscription(userId, endpoint) {
    removed.push({ userId, endpoint });
  },
};

function requireAuthenticated(request, response, next) {
  if (request.get('x-test-user') !== '7') {
    response.status(401).json({ error: 'Sign in is required.' });
    return;
  }
  request.authUser = { id: 7 };
  next();
}

function requireSameOrigin(request, response, next) {
  if (!isSameOrigin(request)) {
    response.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }
  next();
}

function requestHeaders(origin = baseUrl) {
  return {
    'Content-Type': 'application/json',
    Origin: origin,
    'x-test-user': '7',
  };
}

before(async () => {
  saved.length = 0;
  removed.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', createNotificationRouter({
    repository,
    pushService: { enabled: true, publicKey: 'public-key' },
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

test('exposes push configuration and requires an authenticated same-origin subscription', async () => {
  const config = await fetch(`${baseUrl}/api/notifications/push-config`);
  assert.deepEqual(await config.json(), { enabled: true, publicKey: 'public-key' });

  const anonymous = await fetch(`${baseUrl}/api/notifications/push-subscription`, {
    method: 'PUT',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);

  const crossOrigin = await fetch(`${baseUrl}/api/notifications/push-subscription`, {
    method: 'PUT',
    headers: requestHeaders('https://other.example'),
    body: JSON.stringify({}),
  });
  assert.equal(crossOrigin.status, 403);
});

test('stores valid push subscriptions and rejects arbitrary endpoint hosts', async () => {
  const invalid = await fetch(`${baseUrl}/api/notifications/push-subscription`, {
    method: 'PUT',
    headers: requestHeaders(),
    body: JSON.stringify({
      endpoint: 'https://127.0.0.1/metadata',
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    }),
  });
  assert.equal(invalid.status, 400);

  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/example-token',
    keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
  };
  const response = await fetch(`${baseUrl}/api/notifications/push-subscription`, {
    method: 'PUT',
    headers: requestHeaders(),
    body: JSON.stringify(subscription),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(saved, [{ userId: 7, subscription }]);

  const deleted = await fetch(`${baseUrl}/api/notifications/push-subscription`, {
    method: 'DELETE',
    headers: requestHeaders(),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  assert.equal(deleted.status, 204);
  assert.deepEqual(removed, [{ userId: 7, endpoint: subscription.endpoint }]);
});
