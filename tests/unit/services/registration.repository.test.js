const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMySqlRegistrationRepository } = require('../../../server/repositories/registration.repository');

function createRegistrationTestPool({ capacity = 1, registrationDeadline = '2027-01-01 00:00:00.000' } = {}) {
  const event = {
    event_id: 'test-event',
    title: 'Campus Build Night',
    capacity,
    registration_deadline: registrationDeadline,
  };
  const registrations = new Map();
  const notifications = [];
  const queries = [];
  let nextRegistrationId = 1;
  let commits = 0;
  let rollbacks = 0;

  const pool = {
    queries,
    registrations,
    notifications,
    get commits() {
      return commits;
    },
    get rollbacks() {
      return rollbacks;
    },
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('LEFT JOIN registrations')) {
        if (values[1] !== event.event_id) {
          return [[]];
        }
        const registration = registrations.get(`${values[1]}:${values[0]}`);
        return [[{
          event_id: event.event_id,
          registration_status: registration?.status ?? null,
          registered_at: registration?.registered_at ?? null,
        }]];
      }
      if (sql.includes('SELECT event_id FROM events')) {
        return values[0] === event.event_id ? [[{ event_id: event.event_id }]] : [[]];
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {
          commits += 1;
        },
        async rollback() {
          rollbacks += 1;
        },
        release() {},
        async execute(sql, values) {
          queries.push({ sql, values });
          if (sql.includes('FROM events')) {
            return values[0] === event.event_id ? [[event]] : [[]];
          }
          if (sql.includes('FROM registrations') && sql.includes('COUNT(*)')) {
            const count = [...registrations.entries()].filter(([key, registration]) =>
              key.startsWith(`${values[0]}:`) &&
              ['registered', 'attended'].includes(registration.status),
            ).length;
            return [[{ registered_count: count }]];
          }
          if (sql.includes("status = 'waitlisted'") && sql.includes('ORDER BY registered_at')) {
            const nextWaitlisted = [...registrations.entries()]
              .filter(([key, registration]) =>
                key.startsWith(`${values[0]}:`) && registration.status === 'waitlisted',
              )
              .sort(([, first], [, second]) =>
                first.registered_at.localeCompare(second.registered_at) ||
                first.registration_id - second.registration_id,
              )[0];
            return [nextWaitlisted
              ? [{
                registration_id: nextWaitlisted[1].registration_id,
                user_id: Number(nextWaitlisted[0].split(':')[1]),
              }]
              : []];
          }
          if (sql.includes('FROM registrations') && sql.includes('registration_id')) {
            const registration = registrations.get(`${values[0]}:${values[1]}`);
            return [registration ? [{ ...registration }] : []];
          }
          if (sql.startsWith('INSERT INTO registrations')) {
            const [eventId, userId, status] = values;
            registrations.set(`${eventId}:${userId}`, {
              registration_id: nextRegistrationId++,
              status,
              registered_at: '2026-10-01 12:00:00.000',
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('INSERT INTO notifications')) {
            const fixedType = sql.includes("'registration_cancelled'")
              ? 'registration_cancelled'
              : sql.includes("'waitlist_promoted'")
                ? 'waitlist_promoted'
                : null;
            notifications.push({
              user_id: values[0],
              event_id: values[1],
              notification_type: fixedType || values[2],
              title: fixedType === 'registration_cancelled'
                ? 'Registration cancelled'
                : fixedType === 'waitlist_promoted'
                  ? 'A place opened up'
                  : values[3],
              message: fixedType ? values[2] : values[4],
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('UPDATE registrations')) {
            if (sql.includes('SET status = ?,')) {
              const [status, registrationId] = values;
              for (const registration of registrations.values()) {
                if (registration.registration_id === registrationId) {
                  registration.status = status;
                  registration.registered_at = '2026-10-02 12:00:00.000';
                }
              }
            } else if (sql.includes("SET status = 'registered'")) {
              for (const registration of registrations.values()) {
                if (registration.registration_id === values[0]) {
                  registration.status = 'registered';
                  registration.registered_at = '2026-10-02 12:00:00.000';
                }
              }
            } else {
              for (const registration of registrations.values()) {
                if (registration.registration_id === values[0]) {
                  registration.status = 'cancelled';
                }
              }
            }
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
      };
    },
  };

  return pool;
}

test('registers up to capacity and places additional students on a waitlist', async () => {
  const pool = createRegistrationTestPool();
  const repository = createMySqlRegistrationRepository(pool, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
  });

  const first = await repository.register('test-event', 1);
  const second = await repository.register('test-event', 2);

  assert.equal(first.registration.status, 'registered');
  assert.equal(first.created, true);
  assert.equal(second.registration.status, 'waitlisted');
  assert.equal(second.created, true);
  assert.deepEqual(pool.notifications.map((notification) => notification.notification_type), [
    'registration_confirmed',
    'waitlisted',
  ]);
  assert.match(pool.notifications[0].message, /Campus Build Night/);

  const firstLock = pool.queries.find((query) => query.sql.includes('FROM events') && query.sql.includes('FOR UPDATE'));
  assert.ok(firstLock, 'registration should lock the event row before counting seats');
  const countQuery = pool.queries.find((query) => query.sql.includes('COUNT(*)'));
  assert.match(countQuery.sql, /status IN \('registered', 'attended'\)/);
});

test('delivers browser pushes only after the registration transaction commits', async () => {
  const pool = createRegistrationTestPool();
  const deliveries = [];
  const repository = createMySqlRegistrationRepository(pool, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    async sendPush(userId, notification) {
      deliveries.push({ userId, notification, commits: pool.commits });
    },
  });

  await repository.register('test-event', 4);

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].userId, 4);
  assert.equal(deliveries[0].commits, 1);
  assert.match(deliveries[0].notification.body, /Campus Build Night/);
});

test('registration is idempotent and cancellation allows a student to re-register', async () => {
  const pool = createRegistrationTestPool();
  const repository = createMySqlRegistrationRepository(pool, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
  });

  await repository.register('test-event', 1);
  const repeated = await repository.register('test-event', 1);
  assert.equal(repeated.registration.status, 'registered');
  assert.equal(repeated.created, false);

  const cancelled = await repository.cancel('test-event', 1);
  assert.deepEqual(cancelled, {
    registration: { status: 'cancelled' },
    cancelled: true,
    promotedWaitlist: false,
  });

  const reactivated = await repository.register('test-event', 1);
  assert.equal(reactivated.registration.status, 'registered');
  assert.equal(reactivated.created, true);
  assert.deepEqual(pool.notifications.map((notification) => notification.notification_type), [
    'registration_confirmed',
    'registration_cancelled',
    'registration_confirmed',
  ]);
  assert.ok(pool.commits >= 4);
});

test('rejects closed events and safely returns missing events', async () => {
  const pool = createRegistrationTestPool({ registrationDeadline: '2026-10-01 00:00:00.000' });
  const repository = createMySqlRegistrationRepository(pool, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
  });

  await assert.rejects(repository.register('test-event', 1), {
    statusCode: 409,
    message: 'Registration for this event has closed.',
  });
  assert.equal(pool.rollbacks, 1);
  assert.equal(await repository.register('missing-event', 1), null);
});

test('returns a student registration status and an empty result for no registration', async () => {
  const pool = createRegistrationTestPool();
  const repository = createMySqlRegistrationRepository(pool);
  await repository.register('test-event', 1);

  assert.deepEqual(await repository.get('test-event', 1), {
    status: 'registered',
    registeredAt: '2026-10-01T12:00:00.000Z',
  });
  assert.equal(await repository.get('test-event', 2), null);
  assert.equal(await repository.get('missing-event', 1), null);
  assert.equal(await repository.eventExists('test-event'), true);
  assert.equal(await repository.eventExists('missing-event'), false);
});

test('promotes the earliest waitlisted student when a registered student cancels', async () => {
  const pool = createRegistrationTestPool({ capacity: 1 });
  const repository = createMySqlRegistrationRepository(pool, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
  });

  await repository.register('test-event', 1);
  await repository.register('test-event', 2);
  await repository.register('test-event', 3);

  const leftWaitlist = await repository.cancel('test-event', 2);
  assert.equal(leftWaitlist.promotedWaitlist, false);
  assert.equal(pool.registrations.get('test-event:3').status, 'waitlisted');

  const cancelled = await repository.cancel('test-event', 1);

  assert.deepEqual(cancelled, {
    registration: { status: 'cancelled' },
    cancelled: true,
    promotedWaitlist: true,
  });
  assert.equal(pool.registrations.get('test-event:2').status, 'cancelled');
  assert.equal(pool.registrations.get('test-event:3').status, 'registered');
  assert.ok(pool.notifications.some((notification) =>
    notification.user_id === 3 && notification.notification_type === 'waitlist_promoted',
  ));
  const promotionQuery = pool.queries.find((query) =>
    query.sql.includes("status = 'waitlisted'") && query.sql.includes('ORDER BY registered_at'),
  );
  assert.match(promotionQuery.sql, /ORDER BY registered_at ASC, registration_id ASC/);
  assert.match(promotionQuery.sql, /FOR UPDATE/);
});

test('lists a student’s active registrations with event details and registration status', async () => {
  const queries = [];
  const pool = {
    async execute(sql, values) {
      queries.push({ sql, values });
      return [[{
        event_id: 'test-event',
        title: 'Campus Showcase',
        category: 'Competition',
        summary: 'Present a project.',
        description: 'Showcase student projects.',
        starts_at: '2026-12-01 10:00:00.000',
        ends_at: '2026-12-01 12:00:00.000',
        registration_deadline: '2026-11-30 23:59:00.000',
        venue: 'Student Center',
        format: 'In person',
        organizer: 'CampusConnect',
        capacity: 80,
        tags: '["projects"]',
        artwork: '✦',
        registered_count: '12',
        registration_status: 'waitlisted',
        registered_at: '2026-10-30 09:00:00.000',
      }]];
    },
  };
  const repository = createMySqlRegistrationRepository(pool);

  const events = await repository.listForUser(42);

  assert.deepEqual(events, [{
    id: 'test-event',
    title: 'Campus Showcase',
    category: 'Competition',
    summary: 'Present a project.',
    description: 'Showcase student projects.',
    startsAt: '2026-12-01T10:00:00.000Z',
    endsAt: '2026-12-01T12:00:00.000Z',
    registrationDeadline: '2026-11-30T23:59:00.000Z',
    venue: 'Student Center',
    format: 'In person',
    organizer: 'CampusConnect',
    capacity: 80,
    registeredCount: 12,
    tags: ['projects'],
    artwork: '✦',
    registration: {
      status: 'waitlisted',
      registeredAt: '2026-10-30T09:00:00.000Z',
    },
  }]);
  assert.deepEqual(queries[0].values, [42]);
  assert.match(queries[0].sql, /r\.status IN \('registered', 'waitlisted', 'attended'\)/);
  assert.match(queries[0].sql, /ORDER BY e\.starts_at ASC/);
});
