const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getDatabaseConfig } = require('../../../server/config/database');
const {
  createEventRepository,
  createMySqlEventRepository,
  createSampleEventRepository,
  mapEventRow,
} = require('../../../server/repositories/event.repository');

test('requires a valid data source and complete MySQL configuration', () => {
  assert.throws(
    () => createEventRepository({ env: { EVENTS_DATA_SOURCE: 'unknown' } }),
    /EVENTS_DATA_SOURCE must be either "sample" or "mysql"/,
  );
  assert.throws(
    () => createEventRepository({ env: { EVENTS_DATA_SOURCE: 'mysql' } }),
    /MYSQL_USER, MYSQL_DATABASE/,
  );
});

test('validates MySQL connection settings and applies a local default port', () => {
  const config = getDatabaseConfig({
    MYSQL_USER: 'campusconnect',
    MYSQL_DATABASE: 'campusconnect',
  });

  assert.equal(config.host, 'localhost');
  assert.equal(config.port, 3306);
  assert.equal(config.password, '');
  assert.throws(
    () =>
      getDatabaseConfig({
        MYSQL_HOST: 'localhost',
        MYSQL_PORT: '70000',
        MYSQL_USER: 'campusconnect',
        MYSQL_DATABASE: 'campusconnect',
      }),
    /MYSQL_PORT must be an integer/,
  );
});

test('maps database event rows and UTC date values to the API shape', () => {
  const event = mapEventRow({
    event_id: 'sample-event',
    title: 'Sample event',
    category: 'Workshop',
    summary: 'A sample summary',
    description: 'A sample description',
    starts_at: '2026-11-21 04:30:00.000',
    ends_at: '2026-11-21 09:30:00.000',
    registration_deadline: '2026-11-19 18:29:00.000',
    venue: 'Campus',
    format: 'In person',
    organizer: 'Student Society',
    capacity: '40',
    registered_count: '3',
    tags: '["Hands-on","All levels"]',
    artwork: '✎',
  });

  assert.equal(event.id, 'sample-event');
  assert.equal(event.startsAt, '2026-11-21T04:30:00.000Z');
  assert.equal(event.endsAt, '2026-11-21T09:30:00.000Z');
  assert.equal(event.registrationDeadline, '2026-11-19T18:29:00.000Z');
  assert.equal(event.capacity, 40);
  assert.equal(event.registeredCount, 3);
  assert.deepEqual(event.tags, ['Hands-on', 'All levels']);
});

test('parameterizes MySQL search, category, and event id values', async () => {
  const calls = [];
  const pool = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('DISTINCT category')) {
        return [[{ category: 'Hackathon' }]];
      }
      if (sql.includes('WHERE e.event_id')) {
        return [[]];
      }
      return [[]];
    },
  };
  const repository = createMySqlEventRepository(pool);
  const listing = await repository.list({ query: "mentor' OR 1=1 --", category: 'Hackathon' });

  assert.deepEqual(listing, { events: [], total: 0, categories: ['Hackathon'] });
  assert.deepEqual(calls[0].values, ["Hackathon", "%mentor' or 1=1 --%"]);
  assert.match(calls[0].sql, /e\.category = \?/);
  assert.match(calls[0].sql, /LIKE \?/);
  assert.match(calls[0].sql, /COLLATE utf8mb4_0900_ai_ci/);

  await repository.findById("event' OR 1=1 --");
  assert.deepEqual(calls[2].values, ["event' OR 1=1 --"]);
  assert.match(calls[2].sql, /WHERE e\.event_id = \?/);
});

test('sample repository preserves current event discovery behavior', async () => {
  const repository = createSampleEventRepository();
  const listing = await repository.list({ query: 'mentor', category: 'Hackathon' });

  assert.equal(listing.total, 1);
  assert.equal(listing.events[0].id, 'campus-innovation-jam');
  assert.equal(await repository.findById('unknown-event'), null);
});
