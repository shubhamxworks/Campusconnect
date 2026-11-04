const { mapEventRow } = require('./event.repository');

function createRegistrationError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toUtcDate(value) {
  if (value instanceof Date) {
    return value;
  }

  const dateValue = String(value).replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ? dateValue : `${dateValue}Z`);
}

function mapRegistration(row) {
  if (!row?.registration_status) {
    return null;
  }

  return {
    status: row.registration_status,
    registeredAt: row.registered_at
      ? toUtcDate(row.registered_at).toISOString()
      : null,
  };
}

function createMySqlRegistrationRepository(
  pool,
  { now = () => new Date(), sendPush = async () => {} } = {},
) {
  async function sendPushSafely(userId, notification) {
    try {
      await sendPush(userId, notification);
    } catch (error) {
      console.error('Browser push notification could not be delivered:', error);
    }
  }

  return {
    async listForUser(userId) {
      const [rows] = await pool.execute(
        `SELECT
          e.event_id,
          e.title,
          e.category,
          e.summary,
          e.description,
          e.starts_at,
          e.ends_at,
          e.registration_deadline,
          e.venue,
          e.format,
          e.organizer,
          e.capacity,
          e.tags,
          e.artwork,
          (
            SELECT COUNT(*)
            FROM registrations AS counted
            WHERE counted.event_id = e.event_id
              AND counted.status IN ('registered', 'attended')
          ) AS registered_count,
          r.status AS registration_status,
          r.registered_at
         FROM registrations AS r
         INNER JOIN events AS e ON e.event_id = r.event_id
         WHERE r.user_id = ? AND r.status IN ('registered', 'waitlisted', 'attended')
         ORDER BY e.starts_at ASC`,
        [userId],
      );

      return rows.map((row) => ({
        ...mapEventRow(row),
        registration: mapRegistration(row),
      }));
    },

    async eventExists(eventId) {
      const [rows] = await pool.execute(
        'SELECT event_id FROM events WHERE event_id = ? LIMIT 1',
        [eventId],
      );
      return rows.length > 0;
    },

    async get(eventId, userId) {
      const [rows] = await pool.execute(
        `SELECT
          e.event_id,
          r.status AS registration_status,
          r.registered_at
         FROM events AS e
         LEFT JOIN registrations AS r
           ON r.event_id = e.event_id AND r.user_id = ?
         WHERE e.event_id = ?
         LIMIT 1`,
        [userId, eventId],
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRegistration(rows[0]);
    },

    async register(eventId, userId) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [eventRows] = await connection.execute(
          `SELECT event_id, title, capacity, registration_deadline
           FROM events
           WHERE event_id = ?
           LIMIT 1
           FOR UPDATE`,
          [eventId],
        );
        if (eventRows.length === 0) {
          await connection.commit();
          return null;
        }

        const event = eventRows[0];
        if (toUtcDate(event.registration_deadline).getTime() <= now().getTime()) {
          throw createRegistrationError('Registration for this event has closed.', 409);
        }

        const [existingRows] = await connection.execute(
          `SELECT registration_id, status, registered_at
           FROM registrations
           WHERE event_id = ? AND user_id = ?
           LIMIT 1
           FOR UPDATE`,
          [eventId, userId],
        );
        const existing = existingRows[0];

        if (existing && existing.status !== 'cancelled') {
          await connection.commit();
          return {
            registration: {
              status: existing.status,
              registeredAt: existing.registered_at
                ? toUtcDate(existing.registered_at).toISOString()
                : null,
            },
            created: false,
          };
        }
        if (existing?.status === 'attended') {
          await connection.commit();
          return {
            registration: { status: 'attended', registeredAt: toUtcDate(existing.registered_at).toISOString() },
            created: false,
          };
        }

        const [countRows] = await connection.execute(
          `SELECT COUNT(*) AS registered_count
           FROM registrations
           WHERE event_id = ? AND status IN ('registered', 'attended')`,
          [eventId],
        );
        const registeredCount = Number(countRows[0].registered_count);
        const status = registeredCount < Number(event.capacity) ? 'registered' : 'waitlisted';

        if (existing) {
          await connection.execute(
            `UPDATE registrations
             SET status = ?, registered_at = CURRENT_TIMESTAMP
             WHERE registration_id = ?`,
            [status, existing.registration_id],
          );
        } else {
          await connection.execute(
            `INSERT INTO registrations (event_id, user_id, status)
             VALUES (?, ?, ?)`,
            [eventId, userId, status],
          );
        }

        const notification = status === 'registered'
          ? {
            type: 'registration_confirmed',
            title: 'Registration confirmed',
            message: `You are registered for ${event.title}.`,
          }
          : {
            type: 'waitlisted',
            title: 'Added to the waitlist',
            message: `${event.title} is full. You are on the waitlist and will be notified if a place opens.`,
          };
        await connection.execute(
          `INSERT INTO notifications (user_id, event_id, notification_type, title, message)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, eventId, notification.type, notification.title, notification.message],
        );

        await connection.commit();
        await sendPushSafely(userId, {
          title: notification.title,
          body: notification.message,
          url: `/event-details.html?id=${encodeURIComponent(eventId)}`,
        });
        return {
          registration: { status, registeredAt: now().toISOString() },
          created: true,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async cancel(eventId, userId) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [eventRows] = await connection.execute(
          'SELECT event_id, title FROM events WHERE event_id = ? LIMIT 1 FOR UPDATE',
          [eventId],
        );
        if (eventRows.length === 0) {
          await connection.commit();
          return null;
        }

        const [registrationRows] = await connection.execute(
          `SELECT registration_id, status
           FROM registrations
           WHERE event_id = ? AND user_id = ?
           LIMIT 1
           FOR UPDATE`,
          [eventId, userId],
        );
        const registration = registrationRows[0];

        if (!registration || registration.status === 'cancelled') {
          await connection.commit();
          return { registration: registration ? { status: 'cancelled' } : null, cancelled: false };
        }
        if (registration.status === 'attended') {
          throw createRegistrationError('An attended registration cannot be cancelled.', 409);
        }

        await connection.execute(
          `UPDATE registrations
           SET status = 'cancelled'
           WHERE registration_id = ?`,
          [registration.registration_id],
        );
        await connection.execute(
          `INSERT INTO notifications (user_id, event_id, notification_type, title, message)
           VALUES (?, ?, 'registration_cancelled', 'Registration cancelled', ?)`,
          [userId, eventId, `Your registration for ${eventRows[0].title} has been cancelled.`],
        );

        let promotedWaitlist = false;
        let promotedUserId = null;
        if (registration.status === 'registered') {
          const [waitlistRows] = await connection.execute(
            `SELECT registration_id, user_id
             FROM registrations
             WHERE event_id = ? AND status = 'waitlisted'
             ORDER BY registered_at ASC, registration_id ASC
             LIMIT 1
             FOR UPDATE`,
            [eventId],
          );
          const nextWaitlisted = waitlistRows[0];
          if (nextWaitlisted) {
            await connection.execute(
              `UPDATE registrations
               SET status = 'registered', registered_at = CURRENT_TIMESTAMP
               WHERE registration_id = ?`,
              [nextWaitlisted.registration_id],
            );
            await connection.execute(
              `INSERT INTO notifications (user_id, event_id, notification_type, title, message)
               VALUES (?, ?, 'waitlist_promoted', 'A place opened up', ?)`,
              [
                nextWaitlisted.user_id,
                eventId,
                `You have been moved from the waitlist to a confirmed place for ${eventRows[0].title}.`,
              ],
            );
            promotedWaitlist = true;
            promotedUserId = nextWaitlisted.user_id;
          }
        }

        await connection.commit();
        await sendPushSafely(userId, {
          title: 'Registration cancelled',
          body: `Your registration for ${eventRows[0].title} has been cancelled.`,
          url: `/event-details.html?id=${encodeURIComponent(eventId)}`,
        });
        if (promotedUserId) {
          await sendPushSafely(promotedUserId, {
            title: 'A place opened up',
            body: `You have been moved from the waitlist to a confirmed place for ${eventRows[0].title}.`,
            url: `/event-details.html?id=${encodeURIComponent(eventId)}`,
          });
        }
        return {
          registration: { status: 'cancelled' },
          cancelled: true,
          promotedWaitlist,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

module.exports = {
  createMySqlRegistrationRepository,
  createRegistrationError,
  mapRegistration,
};
