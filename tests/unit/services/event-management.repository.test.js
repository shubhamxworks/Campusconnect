const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMySqlEventManagementRepository } = require('../../../server/repositories/event-management.repository');

function row(overrides = {}) {
  return {
    event_id: 'campus-build-123',
    title: 'Campus Build',
    category: 'Hackathon',
    summary: 'Build something useful.',
    description: 'A weekend campus hackathon.',
    starts_at: '2027-01-10 09:00:00.000',
    ends_at: '2027-01-10 18:00:00.000',
    registration_deadline: '2027-01-09 23:59:00.000',
    venue: 'Innovation Hall',
    format: 'In person',
    organizer: 'Builders Club',
    capacity: 80,
    tags: '["Teams","Prizes"]',
    artwork: '✦',
    registered_count: '4',
    ...overrides,
  };
}

test('lists only events owned by the requesting organizer', async () => {
  let call;
  const repository = createMySqlEventManagementRepository({
    async execute(sql, values) {
      call = { sql, values };
      return [[row()]];
    },
  });

  const events = await repository.listForOrganizer(24);
  assert.equal(events[0].id, 'campus-build-123');
  assert.equal(events[0].registeredCount, 4);
  assert.deepEqual(events[0].tags, ['Teams', 'Prizes']);
  assert.deepEqual(call.values, [24]);
  assert.match(call.sql, /e\.organizer_id = \?/);
});

test('creates an event transactionally with parameterized owner and event values', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {
      calls.push({ type: 'begin' });
    },
    async commit() {
      calls.push({ type: 'commit' });
    },
    async rollback() {
      calls.push({ type: 'rollback' });
    },
    release() {
      calls.push({ type: 'release' });
    },
    async execute(sql, values = []) {
      calls.push({ type: 'execute', sql, values });
      if (sql.startsWith('INSERT INTO events')) {
        return [{ insertId: 7 }];
      }
      if (sql.includes('FROM events')) {
        return [[row()]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const repository = createMySqlEventManagementRepository({
    async getConnection() {
      return connection;
    },
  });

  const event = await repository.create(24, {
    id: 'campus-build-123',
    title: 'Campus Build',
    category: 'Hackathon',
    summary: 'Build something useful.',
    description: 'A weekend campus hackathon.',
    startsAt: '2027-01-10T09:00:00.000Z',
    endsAt: '2027-01-10T18:00:00.000Z',
    registrationDeadline: '2027-01-09T23:59:00.000Z',
    venue: 'Innovation Hall',
    format: 'In person',
    organizer: 'Builders Club',
    capacity: 80,
    tags: ['Teams'],
    artwork: '✦',
  });

  assert.equal(event.id, 'campus-build-123');
  assert.equal(calls[0].type, 'begin');
  assert.equal(calls.at(-2).type, 'commit');
  assert.equal(calls.at(-1).type, 'release');
  const insert = calls.find((call) => call.sql?.startsWith('INSERT INTO events'));
  assert.equal(insert.values[0], 'campus-build-123');
  assert.equal(insert.values[1], 24);
  assert.equal(insert.values[6], '2027-01-10 09:00:00.000');
  assert.equal(insert.values[7], '2027-01-10 18:00:00.000');
  assert.equal(insert.values[8], '2027-01-09 23:59:00.000');
  assert.equal(insert.values[13], '["Teams"]');
  assert.equal(insert.sql.includes('24'), false);
});

test('updates only an event belonging to the organizer', async () => {
  const calls = [];
  const pool = {
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {
          calls.push({ type: 'commit' });
        },
        async rollback() {
          calls.push({ type: 'rollback' });
        },
        release() {
          calls.push({ type: 'release' });
        },
        async execute(sql, values) {
          calls.push({ sql, values });
          if (sql.includes('SELECT event_id, capacity')) {
            return [[{ event_id: 'campus-build-123', capacity: 80 }]];
          }
          if (sql.includes('SELECT COUNT(*) AS registered_count')) {
            return [[{ registered_count: 4 }]];
          }
          if (sql.startsWith('UPDATE events')) {
            return [{ affectedRows: 1 }];
          }
          return [[row({ title: 'Updated Campus Build' })]];
        },
      };
    },
  };
  const repository = createMySqlEventManagementRepository(pool);
  const updated = await repository.update(24, 'campus-build-123', {
    title: 'Updated Campus Build',
    category: 'Hackathon',
    summary: 'Updated summary.',
    description: 'Updated description.',
    startsAt: '2027-01-10T09:00:00.000Z',
    endsAt: '2027-01-10T18:00:00.000Z',
    registrationDeadline: '2027-01-09T23:59:00.000Z',
    venue: 'Innovation Hall',
    format: 'In person',
    organizer: 'Builders Club',
    capacity: 80,
    tags: ['Teams'],
    artwork: '✦',
  });
  assert.equal(updated.title, 'Updated Campus Build');
  const updateQuery = calls.find((call) => call.sql?.startsWith('UPDATE events'));
  assert.equal(updateQuery.values[4], '2027-01-10 09:00:00.000');
  assert.equal(updateQuery.values[5], '2027-01-10 18:00:00.000');
  assert.equal(updateQuery.values[6], '2027-01-09 23:59:00.000');
  assert.equal(updateQuery.values.at(-2), 'campus-build-123');
  assert.equal(updateQuery.values.at(-1), 24);
  assert.match(updateQuery.sql, /WHERE event_id = \? AND organizer_id = \?/);

  const notOwnedPool = {
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute() {
          return [[]];
        },
      };
    },
  };
  const notOwned = createMySqlEventManagementRepository(notOwnedPool);
  assert.equal(await notOwned.update(25, 'campus-build-123', {}), null);
});

test('prevents an organizer lowering capacity below current registrations', async () => {
  const calls = [];
  const repository = createMySqlEventManagementRepository({
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {
          calls.push('rollback');
        },
        release() {},
        async execute(sql) {
          if (sql.includes('SELECT event_id, capacity')) {
            return [[{ event_id: 'campus-build-123', capacity: 80 }]];
          }
          if (sql.includes('SELECT COUNT(*) AS registered_count')) {
            return [[{ registered_count: 5 }]];
          }
          calls.push('unexpected update');
          return [{ affectedRows: 1 }];
        },
      };
    },
  });

  await assert.rejects(
    repository.update(24, 'campus-build-123', { capacity: 4 }),
    {
      statusCode: 409,
      message: 'Capacity cannot be lower than the number of registered attendees.',
    },
  );
  assert.deepEqual(calls, ['rollback']);
});

test('lists event registrations only after verifying event ownership', async () => {
  const calls = [];
  const repository = createMySqlEventManagementRepository({
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('SELECT event_id FROM events')) {
        return [[{ event_id: values[0] }]];
      }
      return [[{
        registration_id: 8,
        status: 'waitlisted',
        registered_at: '2026-11-01 10:00:00.000',
        display_name: 'Student One',
        email: 'student@example.edu',
      }]];
    },
  });

  const registrations = await repository.listRegistrations(24, 'campus-build-123');
  assert.deepEqual(registrations, [{
    id: 8,
    status: 'waitlisted',
    registeredAt: '2026-11-01T10:00:00.000Z',
    displayName: 'Student One',
    email: 'student@example.edu',
  }]);
  assert.deepEqual(calls[0].values, ['campus-build-123', 24]);
  assert.match(calls[0].sql, /organizer_id = \?/);

  const notOwned = createMySqlEventManagementRepository({
    async execute() {
      return [[]];
    },
  });
  assert.equal(await notOwned.listRegistrations(25, 'campus-build-123'), null);
});

test('marks only registered attendees as attended inside an owned-event transaction', async () => {
  const calls = [];
  const pool = {
    async getConnection() {
      return {
        async beginTransaction() {
          calls.push({ type: 'begin' });
        },
        async commit() {
          calls.push({ type: 'commit' });
        },
        async rollback() {
          calls.push({ type: 'rollback' });
        },
        release() {
          calls.push({ type: 'release' });
        },
        async execute(sql, values = []) {
          calls.push({ sql, values });
          if (sql.includes('SELECT event_id FROM events')) {
            return [[{ event_id: values[0] }]];
          }
          if (sql.includes('SELECT registration_id, status')) {
            return [[{
              registration_id: Number(values[0]),
              status: 'registered',
              registered_at: '2026-11-01 10:00:00.000',
            }]];
          }
          return [{ affectedRows: 1 }];
        },
      };
    },
  };
  const repository = createMySqlEventManagementRepository(pool);
  const result = await repository.markAttended(24, 'event-1', '8');
  assert.deepEqual(result, {
    id: 8,
    status: 'attended',
    registeredAt: '2026-11-01T10:00:00.000Z',
  });
  assert.equal(calls[0].type, 'begin');
  assert.equal(calls.at(-2).type, 'commit');
  assert.equal(calls.at(-1).type, 'release');
  assert.ok(calls.some((call) => call.sql?.includes("SET status = 'attended'")));

  const waitlisted = createMySqlEventManagementRepository({
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {
          calls.push({ type: 'waitlist-rollback' });
        },
        release() {},
        async execute(sql, values = []) {
          if (sql.includes('SELECT event_id FROM events')) {
            return [[{ event_id: values[0] }]];
          }
          return [[{
            registration_id: Number(values[0]),
            status: 'waitlisted',
            registered_at: '2026-11-01 10:00:00.000',
          }]];
        },
      };
    },
  });
  await assert.rejects(waitlisted.markAttended(24, 'event-1', '9'), {
    statusCode: 409,
    message: 'Only registered attendees can be marked as attended.',
  });
});
