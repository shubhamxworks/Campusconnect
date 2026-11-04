const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWebPushService } = require('../../../server/services/web-push.service');

test('requires a complete VAPID configuration', () => {
  assert.throws(
    () => createWebPushService({
      repository: {},
      env: { VAPID_PUBLIC_KEY: 'public' },
      sender: { setVapidDetails() {} },
    }),
    /must be configured together/,
  );
});

test('sends notifications and removes expired browser subscriptions', async () => {
  const subscriptions = [
    { endpoint: 'https://push.example/active', keys: { p256dh: 'key', auth: 'secret' } },
    { endpoint: 'https://push.example/expired', keys: { p256dh: 'key', auth: 'secret' } },
  ];
  const sent = [];
  const removed = [];
  let vapid;
  const service = createWebPushService({
    repository: {
      async listPushSubscriptions(userId) {
        assert.equal(userId, 3);
        return subscriptions;
      },
      async removePushSubscription(userId, endpoint) {
        removed.push({ userId, endpoint });
      },
    },
    env: {
      VAPID_PUBLIC_KEY: 'public',
      VAPID_PRIVATE_KEY: 'private',
      VAPID_SUBJECT: 'mailto:admin@example.edu',
    },
    sender: {
      setVapidDetails(...values) { vapid = values; },
      async sendNotification(subscription, payload) {
        sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
        if (subscription.endpoint.endsWith('/expired')) {
          const error = new Error('Subscription expired.');
          error.statusCode = 410;
          throw error;
        }
      },
    },
  });

  assert.equal(service.enabled, true);
  assert.equal(service.publicKey, 'public');
  assert.deepEqual(vapid, ['mailto:admin@example.edu', 'public', 'private']);
  await service.sendToUser(3, { title: 'Update', body: 'Details', url: '/notifications.html' });
  assert.equal(sent.length, 2);
  assert.deepEqual(removed, [{ userId: 3, endpoint: 'https://push.example/expired' }]);
});
