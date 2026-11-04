const webPush = require('web-push');

function createWebPushService({ repository, env = process.env, sender = webPush }) {
  const config = {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || '',
  };
  const configuredValues = Object.values(config).filter(Boolean).length;
  if (configuredValues !== 0 && configuredValues !== Object.keys(config).length) {
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must be configured together.');
  }
  const enabled = configuredValues === Object.keys(config).length;

  if (enabled) sender.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  return {
    enabled,
    publicKey: enabled ? config.publicKey : null,

    async sendToUser(userId, notification) {
      if (!enabled) return;
      const subscriptions = await repository.listPushSubscriptions(userId);
      const results = await Promise.allSettled(subscriptions.map((subscription) =>
        sender.sendNotification(subscription, JSON.stringify(notification)),
      ));

      await Promise.all(results.map(async (result, index) => {
        if (result.status === 'fulfilled') return;
        const statusCode = result.reason?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await repository.removePushSubscription(userId, subscriptions[index].endpoint);
          return;
        }
        console.error('Browser push delivery failed:', result.reason);
      }));
    },
  };
}

module.exports = { createWebPushService };
