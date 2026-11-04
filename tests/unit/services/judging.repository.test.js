const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMySqlJudgingRepository } = require('../../../server/repositories/judging.repository');

function createPublishingPool({ alreadyPublished = false, evaluatedCount = 1 } = {}) {
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  const connection = {
    async beginTransaction() {},
    async commit() { commits += 1; },
    async rollback() { rollbacks += 1; },
    release() {},
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('SELECT event_id, title, results_published_at')) {
        return [[{
          event_id: 'event-one',
          title: 'Build Night',
          results_published_at: alreadyPublished ? '2026-10-30 10:00:00.000' : null,
        }]];
      }
      if (sql.includes('COUNT(DISTINCT s.submission_id)')) {
        return [[{ submission_count: 1, evaluated_submission_count: evaluatedCount }]];
      }
      if (sql.includes('UPDATE events')) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO notifications')) {
        return [{ affectedRows: 2 }];
      }
      if (sql.includes('SELECT user_id') && sql.includes('FROM registrations')) {
        return [[{ user_id: 2 }, { user_id: 3 }]];
      }
      if (sql.includes('FROM submissions AS s')) {
        return [[{
          team_name: 'Team Alpha',
          project_name: 'Campus Helper',
          average_score: '92.50',
          evaluation_count: '2',
        }]];
      }
      if (sql.includes('SELECT results_published_at FROM events')) {
        return [[{
          results_published_at: alreadyPublished
            ? '2026-10-30 10:00:00.000'
            : '2026-11-01 10:00:00.000',
        }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return {
    queries,
    connection,
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    async getConnection() { return connection; },
  };
}

test('publishes evaluated results and notifies event participants transactionally once', async () => {
  const pool = createPublishingPool();
  const pushNotifications = [];
  const repository = createMySqlJudgingRepository(pool, {
    async sendPush(userId, notification) {
      pushNotifications.push({ userId, notification });
    },
  });

  const published = await repository.setResultsPublished(1, 'event-one', true);

  assert.equal(published.eventTitle, 'Build Night');
  assert.equal(published.results[0].averageScore, 92.5);
  assert.equal(published.results[0].evaluationCount, 2);
  assert.equal(published.publishedAt, '2026-11-01T10:00:00.000Z');
  assert.equal(pool.commits, 1);
  assert.equal(pool.rollbacks, 0);
  assert.deepEqual(pushNotifications.map(({ userId }) => userId), [2, 3]);
  assert.match(pushNotifications[0].notification.url, /leaderboard\.html/);

  const notificationInsert = pool.queries.find((query) => query.sql.includes('INSERT INTO notifications'));
  assert.ok(notificationInsert);
  assert.match(notificationInsert.sql, /r\.status IN \('registered', 'attended'\)/);
  assert.deepEqual(notificationInsert.values, ['event-one']);
  assert.ok(
    pool.queries.findIndex((query) => query.sql.includes('UPDATE events'))
    < pool.queries.findIndex((query) => query.sql.includes('INSERT INTO notifications')),
  );
});

test('does not notify again for an already-published event', async () => {
  const pool = createPublishingPool({ alreadyPublished: true });
  const repository = createMySqlJudgingRepository(pool);

  await repository.setResultsPublished(1, 'event-one', true);

  assert.equal(pool.queries.some((query) => query.sql.includes('INSERT INTO notifications')), false);
  assert.equal(pool.commits, 1);
});

test('rolls back publication if a submission has no judge scores', async () => {
  const pool = createPublishingPool({ evaluatedCount: 0 });
  const repository = createMySqlJudgingRepository(pool);

  await assert.rejects(repository.setResultsPublished(1, 'event-one', true), {
    statusCode: 409,
  });
  assert.equal(pool.queries.some((query) => query.sql.includes('INSERT INTO notifications')), false);
  assert.equal(pool.commits, 0);
  assert.equal(pool.rollbacks, 1);
});
