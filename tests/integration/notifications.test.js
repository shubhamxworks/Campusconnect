const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createNotificationRouter } = require('../../server/routes/notification.routes');

let server;
let baseUrl;
const notifications = [
  {
    id: 1,
    userId: 7,
    eventId: 'event-one',
    type: 'registration_confirmed',
    title: 'Registration confirmed',
    message: 'You are registered for Build Night.',
    readAt: null,
    createdAt: '2026-10-30T12:00:00.000Z',
  },
  {
    id: 2,
    userId: 8,
    eventId: 'event-one',
    type: 'waitlisted',
    title: 'Added to the waitlist',
    message: 'Build Night is full.',
    readAt: null,
    createdAt: '2026-10-30T12:00:00.000Z',
  },
];

const repository = {
  async listForUser(userId) {
    const records = notifications
      .filter((notification) => notification.userId === userId)
      .sort((first, second) => second.id - first.id);
    return {
      notifications: records.map(({ userId: _userId, ...notification }) => notification),
      unreadCount: records.filter((notification) => !notification.readAt).length,
    };
  },
  async markRead(userId, notificationId) {
    const notification = notifications.find((item) =>
      item.userId === userId && item.id === Number(notificationId),
    );
    if (!notification) return null;
    notification.readAt ||= '2026-10-31T12:00:00.000Z';
    const { userId: _userId, ...result } = notification;
    return result;
  },
  async markAllRead(userId) {
    let updatedCount = 0;
    for (const notification of notifications) {
      if (notification.userId === userId && !notification.readAt) {
        notification.readAt = '2026-10-31T12:00:00.000Z';
        updatedCount += 1;
      }
    }
    return updatedCount;
  },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in to view your notifications.' });
    return;
  }
  request.authUser = { id: userId };
  next();
}

function requireSameOrigin(request, response, next) {
  if (!isSameOrigin(request)) {
    response.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }
  next();
}

function headers(userId, origin = baseUrl) {
  return {
    'x-test-user': String(userId),
    Origin: origin,
    'Content-Type': 'application/json',
  };
}

before(async () => {
  for (const notification of notifications) notification.readAt = null;
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', createNotificationRouter({
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

test('requires authentication and only lists the signed-in user notifications', async () => {
  const anonymous = await fetch(`${baseUrl}/api/notifications`);
  assert.equal(anonymous.status, 401);

  const response = await fetch(`${baseUrl}/api/notifications`, {
    headers: headers(7),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.unreadCount, 1);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].userId, undefined);
});

test('marks only owned notifications as read and supports mark-all', async () => {
  const forbidden = await fetch(`${baseUrl}/api/notifications/2/read`, {
    method: 'PATCH',
    headers: headers(7),
  });
  assert.equal(forbidden.status, 404);

  const invalid = await fetch(`${baseUrl}/api/notifications/0/read`, {
    method: 'PATCH',
    headers: headers(7),
  });
  assert.equal(invalid.status, 400);

  const crossOrigin = await fetch(`${baseUrl}/api/notifications/1/read`, {
    method: 'PATCH',
    headers: headers(7, 'https://other.example'),
  });
  assert.equal(crossOrigin.status, 403);

  const marked = await fetch(`${baseUrl}/api/notifications/1/read`, {
    method: 'PATCH',
    headers: headers(7),
  });
  assert.equal(marked.status, 200);
  assert.ok((await marked.json()).notification.readAt);

  const allRead = await fetch(`${baseUrl}/api/notifications/read-all`, {
    method: 'PATCH',
    headers: headers(7),
  });
  assert.equal((await allRead.json()).updatedCount, 0);

  const otherUserNotifications = await fetch(`${baseUrl}/api/notifications`, {
    headers: headers(8),
  });
  assert.equal((await otherUserNotifications.json()).unreadCount, 1);
});
