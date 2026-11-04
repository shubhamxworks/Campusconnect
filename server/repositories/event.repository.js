const sampleEvents = require('../data/events');

function searchSampleEvents(events, query, category) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return events
    .filter((event) => !category || event.category === category)
    .filter((event) => {
      if (!normalizedQuery) {
        return true;
      }

      const searchableText = [
        event.title,
        event.category,
        event.summary,
        event.description,
        event.venue,
        event.organizer,
        ...event.tags,
      ]
        .join(' ')
        .toLocaleLowerCase();

      return searchableText.includes(normalizedQuery);
    })
    .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt));
}

function mapDate(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const dateValue = String(value).replace(' ', 'T');
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue);
  return new Date(hasTimezone ? dateValue : `${dateValue}Z`).toISOString();
}

function mapEventRow(row) {
  const tags = Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags);

  return {
    id: row.event_id,
    title: row.title,
    category: row.category,
    summary: row.summary,
    description: row.description,
    startsAt: mapDate(row.starts_at),
    endsAt: mapDate(row.ends_at),
    registrationDeadline: mapDate(row.registration_deadline),
    venue: row.venue,
    format: row.format,
    organizer: row.organizer,
    capacity: Number(row.capacity),
    registeredCount: Number(row.registered_count),
    tags,
    artwork: row.artwork,
  };
}

function createSampleEventRepository(events = sampleEvents) {
  const categories = [...new Set(events.map((event) => event.category))].sort();

  return {
    source: 'sample',
    async list({ query = '', category = '' } = {}) {
      const filteredEvents = searchSampleEvents(events, query, category);
      return { events: filteredEvents, total: filteredEvents.length, categories };
    },
    async findById(id) {
      return events.find((event) => event.id === id) ?? null;
    },
    async checkHealth() {
      return true;
    },
  };
}

function createMySqlEventRepository(pool) {
  const eventSelect = `
    SELECT
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
        WHERE r.event_id = e.event_id
          AND r.status IN ('registered', 'attended')
      ) AS registered_count
    FROM events AS e`;

  return {
    source: 'mysql',
    async list({ query = '', category = '' } = {}) {
      const conditions = [];
      const values = [];

      if (category) {
        conditions.push('e.category = ?');
        values.push(category);
      }

      if (query) {
        conditions.push(`LOWER(CONCAT_WS(
          ' ',
          e.title,
          e.category,
          e.summary,
          e.description,
          e.venue,
          e.organizer,
          CAST(e.tags AS CHAR)
        )) COLLATE utf8mb4_0900_ai_ci LIKE ? COLLATE utf8mb4_0900_ai_ci`);
        values.push(`%${query.toLocaleLowerCase()}%`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows, categoryRows] = await Promise.all([
        pool.execute(
          `${eventSelect}
          ${whereClause}
          ORDER BY e.starts_at ASC`,
          values,
        ),
        pool.execute('SELECT DISTINCT category FROM events ORDER BY category ASC'),
      ]);
      const events = rows[0].map(mapEventRow);

      return {
        events,
        total: events.length,
        categories: categoryRows[0].map((row) => row.category),
      };
    },
    async findById(id) {
      const [rows] = await pool.execute(`${eventSelect} WHERE e.event_id = ? LIMIT 1`, [id]);
      return rows.length > 0 ? mapEventRow(rows[0]) : null;
    },
    async checkHealth() {
      await pool.execute('SELECT 1');
      return true;
    },
  };
}

function createEventRepository({ env = process.env, pool } = {}) {
  const source = env.EVENTS_DATA_SOURCE || 'sample';

  if (source === 'sample') {
    return createSampleEventRepository();
  }

  if (source !== 'mysql') {
    throw new Error('EVENTS_DATA_SOURCE must be either "sample" or "mysql".');
  }

  if (!pool) {
    const { createDatabasePool } = require('../config/database');
    pool = createDatabasePool(env);
  }

  return createMySqlEventRepository(pool);
}

module.exports = {
  createEventRepository,
  createMySqlEventRepository,
  createSampleEventRepository,
  mapEventRow,
};
