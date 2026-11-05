const { createHash } = require('node:crypto');

function toUtcIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const dateValue = String(value).replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ? dateValue : `${dateValue}Z`).toISOString();
}

function mapNotification(row) {
  return {
    id: Number(row.notification_id),
    eventId: row.event_id,
    type: row.notification_type,
    title: row.title,
    message: row.message,
    readAt: row.read_at ? toUtcIso(row.read_at) : null,
    createdAt: toUtcIso(row.created_at),
  };
}

function createMySqlNotificationRepository(pool) {
  return {
    async savePushSubscription(userId, subscription) {
      const endpointHash = createHash('sha256').update(subscription.endpoint).digest('hex');
      await pool.execute(
        `INSERT INTO web_push_subscriptions (
          user_id, endpoint_hash, endpoint, p256dh_key, auth_key
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (endpoint_hash) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          endpoint = EXCLUDED.endpoint,
          p256dh_key = EXCLUDED.p256dh_key,
          auth_key = EXCLUDED.auth_key`,
        [userId, endpointHash, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
      );
    },

    async removePushSubscription(userId, endpoint) {
      const endpointHash = createHash('sha256').update(endpoint).digest('hex');
      const [result] = await pool.execute(
        'DELETE FROM web_push_subscriptions WHERE user_id = $1 AND endpoint_hash = $2',
        [userId, endpointHash],
      );
      return result.affectedRows > 0;
    },

    async listPushSubscriptions(userId) {
      const [rows] = await pool.execute(
        `SELECT endpoint, p256dh_key, auth_key
         FROM web_push_subscriptions
         WHERE user_id = $1`,
        [userId],
      );
      return rows.map((row) => ({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh_key, auth: row.auth_key },
      }));
    },

    async listForUser(userId) {
      const [[rows], [counts]] = await Promise.all([
        pool.execute(
          `SELECT notification_id, event_id, notification_type, title, message, read_at, created_at
           FROM notifications
           WHERE user_id = $1
           ORDER BY created_at DESC, notification_id DESC
           LIMIT 100`,
          [userId],
        ),
        pool.execute(
          `SELECT COUNT(*) AS unread_count
           FROM notifications
           WHERE user_id = $1 AND read_at IS NULL`,
          [userId],
        ),
      ]);
      return {
        notifications: rows.map(mapNotification),
        unreadCount: Number(counts[0].unread_count),
      };
    },

    async markRead(userId, notificationId) {
      await pool.execute(
        `UPDATE notifications
         SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE notification_id = $1 AND user_id = $2`,
        [notificationId, userId],
      );
      const [rows] = await pool.execute(
        `SELECT notification_id, event_id, notification_type, title, message, read_at, created_at
         FROM notifications
         WHERE notification_id = $1 AND user_id = $2
         LIMIT 1`,
        [notificationId, userId],
      );
      return rows.length ? mapNotification(rows[0]) : null;
    },

    async markAllRead(userId) {
      const [result] = await pool.execute(
        `UPDATE notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return result.affectedRows;
    },
  };
}

module.exports = { createMySqlNotificationRepository, mapNotification };
