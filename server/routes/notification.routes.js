const express = require('express');

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function isValidPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const supportedPushHost = host === 'fcm.googleapis.com'
      || host.endsWith('.push.services.mozilla.com')
      || host === 'updates.push.services.mozilla.com'
      || host.endsWith('.notify.windows.com')
      || host === 'web.push.apple.com';
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
      && supportedPushHost;
  } catch {
    return false;
  }
}

function createNotificationRouter({
  repository,
  pushService,
  requireAuthenticated,
  requireSameOrigin,
}) {
  const router = express.Router();
  const requireRepository = (_request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Notifications require PostgreSQL to be configured.' });
      return;
    }
    next();
  };

  router.get('/push-config', (_request, response) => {
    response.json({
      enabled: Boolean(pushService?.enabled),
      publicKey: pushService?.publicKey || null,
    });
  });

  router.put(
    '/push-subscription',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      if (!pushService?.enabled) {
        response.status(503).json({ error: 'Browser push is not configured on this server.' });
        return;
      }
      const { endpoint, keys } = request.body || {};
      if (
        !isValidPushEndpoint(endpoint)
        || !keys
        || typeof keys.p256dh !== 'string'
        || !/^[A-Za-z0-9_-]{20,200}$/.test(keys.p256dh)
        || typeof keys.auth !== 'string'
        || !/^[A-Za-z0-9_-]{10,100}$/.test(keys.auth)
      ) {
        response.status(400).json({ error: 'A valid browser push subscription is required.' });
        return;
      }
      await repository.savePushSubscription(request.authUser.id, { endpoint, keys });
      response.sendStatus(204);
    }),
  );

  router.delete(
    '/push-subscription',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      const endpoint = request.body?.endpoint;
      if (!isValidPushEndpoint(endpoint)) {
        response.status(400).json({ error: 'A valid browser push endpoint is required.' });
        return;
      }
      await repository.removePushSubscription(request.authUser.id, endpoint);
      response.sendStatus(204);
    }),
  );

  router.get(
    '/',
    requireRepository,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      response.json(await repository.listForUser(request.authUser.id));
    }),
  );

  router.patch(
    '/read-all',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      const updatedCount = await repository.markAllRead(request.authUser.id);
      response.json({ updatedCount });
    }),
  );

  router.patch(
    '/:notificationId/read',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      if (!/^[1-9]\d*$/.test(request.params.notificationId)) {
        response.status(400).json({ error: 'Notification id must be a positive integer.' });
        return;
      }
      const notification = await repository.markRead(
        request.authUser.id,
        request.params.notificationId,
      );
      if (!notification) {
        response.status(404).json({ error: 'Notification not found.' });
        return;
      }
      response.json({ notification });
    }),
  );

  return router;
}

module.exports = { createNotificationRouter, isValidPushEndpoint };
