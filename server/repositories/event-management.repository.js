function toUtcIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const dateValue = String(value).replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ? dateValue : `${dateValue}Z`).toISOString();
}

function toPostgresUtcTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Event dates must be valid before they are stored.');
  }
  return date.toISOString();
}

function mapManagedEvent(row) {
  return {
    id: row.event_id,
    title: row.title,
    category: row.category,
    summary: row.summary,
    description: row.description,
    startsAt: toUtcIso(row.starts_at),
    endsAt: toUtcIso(row.ends_at),
    registrationDeadline: toUtcIso(row.registration_deadline),
    venue: row.venue,
    format: row.format,
    organizer: row.organizer,
    capacity: Number(row.capacity),
    tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags),
    artwork: row.artwork,
    registeredCount: Number(row.registered_count ?? 0),
  };
}

const eventSelect = `SELECT
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
    FROM registrations AS r
    WHERE r.event_id = e.event_id AND r.status IN ('registered', 'attended')
  ) AS registered_count
  FROM events AS e`;

function createMySqlEventManagementRepository(pool) {
  return {
    async listForOrganizer(organizerId) {
      const [rows] = await pool.execute(
        `${eventSelect}
         WHERE e.organizer_id = $1
         ORDER BY e.starts_at ASC`,
        [organizerId],
      );
      return rows.map(mapManagedEvent);
    },

    async listRegistrations(organizerId, eventId) {
      const [ownedEvents] = await pool.execute(
        'SELECT event_id FROM events WHERE event_id = $1 AND organizer_id = $2 LIMIT 1',
        [eventId, organizerId],
      );
      if (ownedEvents.length === 0) {
        return null;
      }

      const [rows] = await pool.execute(
        `SELECT
          r.registration_id,
          r.status,
          r.registered_at,
          u.display_name,
          u.email
         FROM registrations AS r
         INNER JOIN users AS u ON u.user_id = r.user_id
         WHERE r.event_id = $1
         ORDER BY
           CASE r.status
             WHEN 'registered' THEN 1
             WHEN 'waitlisted' THEN 2
             WHEN 'attended' THEN 3
             ELSE 4
           END,
           r.registered_at ASC,
           r.registration_id ASC`,
        [eventId],
      );
      return rows.map((row) => ({
        id: Number(row.registration_id),
        status: row.status,
        registeredAt: toUtcIso(row.registered_at),
        displayName: row.display_name,
        email: row.email,
      }));
    },

    async markAttended(organizerId, eventId, registrationId) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [events] = await connection.execute(
          'SELECT event_id FROM events WHERE event_id = $1 AND organizer_id = $2 LIMIT 1 FOR UPDATE',
          [eventId, organizerId],
        );
        if (events.length === 0) {
          await connection.commit();
          return null;
        }

        const [registrations] = await connection.execute(
          `SELECT registration_id, status, registered_at
           FROM registrations
           WHERE registration_id = $1 AND event_id = $2
           LIMIT 1 FOR UPDATE`,
          [registrationId, eventId],
        );
        const registration = registrations[0];
        if (!registration) {
          await connection.commit();
          return false;
        }
        if (registration.status === 'waitlisted' || registration.status === 'cancelled') {
          const error = new Error('Only registered attendees can be marked as attended.');
          error.statusCode = 409;
          throw error;
        }

        if (registration.status === 'registered') {
          await connection.execute(
            `UPDATE registrations
             SET status = 'attended'
             WHERE registration_id = $1 AND event_id = $2`,
            [registrationId, eventId],
          );
        }
        await connection.commit();
        return {
          id: Number(registration.registration_id),
          status: 'attended',
          registeredAt: toUtcIso(registration.registered_at),
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async create(organizerId, event) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `INSERT INTO events (
            event_id, organizer_id, title, category, summary, description,
            starts_at, ends_at, registration_deadline, venue, format,
            organizer, capacity, tags, artwork
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING event_id`,
          [
            event.id,
            organizerId,
            event.title,
            event.category,
            event.summary,
            event.description,
            toPostgresUtcTimestamp(event.startsAt),
            toPostgresUtcTimestamp(event.endsAt),
            toPostgresUtcTimestamp(event.registrationDeadline),
            event.venue,
            event.format,
            event.organizer,
            event.capacity,
            JSON.stringify(event.tags),
            event.artwork,
          ],
        );
        const [rows] = await connection.execute(`${eventSelect} WHERE e.event_id = $1 LIMIT 1`, [event.id]);
        await connection.commit();
        return mapManagedEvent(rows[0]);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async update(organizerId, eventId, event) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [ownedEvents] = await connection.execute(
          `SELECT event_id, capacity
           FROM events
           WHERE event_id = $1 AND organizer_id = $2
           LIMIT 1
           FOR UPDATE`,
          [eventId, organizerId],
        );
        if (ownedEvents.length === 0) {
          await connection.commit();
          return null;
        }

        const [registrationRows] = await connection.execute(
          `SELECT COUNT(*) AS registered_count
           FROM registrations
           WHERE event_id = $1 AND status IN ('registered', 'attended')`,
          [eventId],
        );
        if (event.capacity < Number(registrationRows[0].registered_count)) {
          const error = new Error('Capacity cannot be lower than the number of registered attendees.');
          error.statusCode = 409;
          throw error;
        }

        await connection.execute(
          `UPDATE events
           SET title = $1,
               category = $2,
               summary = $3,
               description = $4,
               starts_at = $5,
               ends_at = $6,
               registration_deadline = $7,
               venue = $8,
               format = $9,
               organizer = $10,
               capacity = $11,
               tags = $12,
               artwork = $13
           WHERE event_id = $14 AND organizer_id = $15`,
          [
            event.title,
            event.category,
            event.summary,
            event.description,
            toPostgresUtcTimestamp(event.startsAt),
            toPostgresUtcTimestamp(event.endsAt),
            toPostgresUtcTimestamp(event.registrationDeadline),
            event.venue,
            event.format,
            event.organizer,
            event.capacity,
            JSON.stringify(event.tags),
            event.artwork,
            eventId,
            organizerId,
          ],
        );
        const [rows] = await connection.execute(
          `${eventSelect} WHERE e.event_id = $1 AND e.organizer_id = $2 LIMIT 1`,
          [eventId, organizerId],
        );
        await connection.commit();
        return rows.length ? mapManagedEvent(rows[0]) : null;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

module.exports = { createMySqlEventManagementRepository, mapManagedEvent };
