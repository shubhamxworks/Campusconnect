const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getDatabaseConfig } = require('../../../server/config/database');
const {
  createEventRepository,
  createMySqlEventRepository,
  createSampleEventRepository,
  mapEventRow,
} = require('../../../server/repositories/event.repository');

test('requires a valid data source and Supabase PostgreSQL connection URL', () => {
  assert.throws(
    () => createEventRepository({ env: { EVENTS_DATA_SOURCE: 'unknown' } }),
    /EVENTS_DATA_SOURCE must be either "sample" or "postgres"/,
  );
  assert.throws(
    () => createEventRepository({ env: { EVENTS_DATA_SOURCE: 'postgres' } }),
    /SUPABASE_DB_URL or DATABASE_URL/,
  );
});

test('validates Supabase PostgreSQL connection settings', () => {
  const config = getDatabaseConfig({
    DATABASE_URL: 'postgresql://campusconnect:secret@db.example.supabase.co:5432/postgres',
  });

  assert.equal(config.connectionString, 'postgresql://campusconnect:secret@db.example.supabase.co:5432/postgres');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.throws(
    () => getDatabaseConfig({ DATABASE_URL: 'https://example.com' }),
    /must use the postgres or postgresql protocol/,
  );
});

test('uses a supplied CA certificate while keeping TLS verification enabled', () => {
  const config = getDatabaseConfig({
    DATABASE_URL: 'postgresql://campusconnect:secret@db.example.supabase.co:5432/postgres?sslmode=require',
    DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\ntrusted-root\\n-----END CERTIFICATE-----',
  });

  assert.deepEqual(config.ssl, {
    ca: '-----BEGIN CERTIFICATE-----\ntrusted-root\n-----END CERTIFICATE-----',
    rejectUnauthorized: true,
  });
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
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

test('parameterizes PostgreSQL search, category, and event id values', async () => {
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
  assert.match(calls[0].sql, /e\.category = \$1/);
  assert.match(calls[0].sql, /LIKE \$2/);

  await repository.findById("event' OR 1=1 --");
  assert.deepEqual(calls[2].values, ["event' OR 1=1 --"]);
  assert.match(calls[2].sql, /WHERE e\.event_id = \$1/);
});

test('sample repository preserves current event discovery behavior', async () => {
  const repository = createSampleEventRepository();
  const listing = await repository.list({ query: 'mentor', category: 'Hackathon' });

  assert.equal(listing.total, 1);
  assert.equal(listing.events[0].id, 'campus-innovation-jam');
  assert.equal(await repository.findById('unknown-event'), null);
});
